package sip

import (
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync"
	"time"
)

type CallState int

const (
	CallStateIdle CallState = iota
	CallStateInviting
	CallStateRinging
	CallStateActive
	CallStateBye
)

type Call struct {
	ID        string
	RemoteURI string
	LocalURI  string
	State     CallState
	RemoteTag string
	LocalTag  string
	Branch    string
	CSeq      uint32
	RTPPort   int
	OnAudio   func([]byte) // PCM or G.711 audio
	OnState   func(CallState)
}

type UA struct {
	config  Config
	transport *Transport
	log     *slog.Logger
	calls   map[string]*Call
	mu      sync.RWMutex
	localIP string
	onInbound func(peer string, answer func(offer []byte) []byte)
}

type Config struct {
	AsteriskAddr string // "192.168.1.100:5060"
	Extension    string // "100"
	Password     string
	Domain       string // SIP domain
	UserAgent    string
	Transport    string // "udp"
	ListenAddr   string // ":0" (auto port)
}

func NewUA(config Config, log *slog.Logger) *UA {
	if config.UserAgent == "" {
		config.UserAgent = "WaCalls-SIP/1.0"
	}
	if config.Domain == "" {
		config.Domain = config.AsteriskAddr
	}
	if config.ListenAddr == "" {
		config.ListenAddr = ":0"
	}
	return &UA{
		config: config,
		log:    log,
		calls:  make(map[string]*Call),
	}
}

func (u *UA) Start() error {
	tp, err := NewTransport(u.config.ListenAddr)
	if err != nil {
		return fmt.Errorf("SIP transport: %w", err)
	}
	u.transport = tp
	u.localIP = u.extractLocalIP()
	tp.Start(u.handleMessage)
	u.log.Info("SIP UA started", "listen", tp.LocalAddr(), "ext", u.config.Extension)
	return u.register()
}

func (u *UA) Stop() {
	if u.transport != nil {
		u.transport.Stop()
	}
}

func (u *UA) extractLocalIP() string {
	conn, err := net.Dial("udp", u.config.AsteriskAddr)
	if err != nil {
		return "127.0.0.1"
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}

func (u *UA) generateTag() string {
	return fmt.Sprintf("%08x", time.Now().UnixNano())
}

func (u *UA) register() error {
	branch := GenerateBranch()
	req := NewRequest(MethodRegister, fmt.Sprintf("sip:%s", u.config.AsteriskAddr), branch)
	req.SetHeader("Via", fmt.Sprintf("SIP/2.0/UDP %s;branch=%s", u.transport.LocalAddr(), branch))
	req.SetHeader("From", fmt.Sprintf("<sip:%s@%s>;tag=%s", u.config.Extension, u.config.Domain, u.generateTag()))
	req.SetHeader("To", fmt.Sprintf("<sip:%s@%s>", u.config.Extension, u.config.Domain))
	req.SetHeader("Call-ID", req.CallID)
	req.SetHeader("CSeq", fmt.Sprintf("%d REGISTER", req.CSeq))
	req.SetHeader("Contact", fmt.Sprintf("<sip:%s@%s>", u.config.Extension, u.transport.LocalAddr()))
	req.SetHeader("Expires", "3600")
	req.SetHeader("Max-Forwards", "70")
	req.SetHeader("User-Agent", u.config.UserAgent)
	req.SetHeader("Allow", "INVITE, ACK, CANCEL, BYE, OPTIONS")
	req.SetHeader("Content-Length", "0")

	u.log.Info("SIP REGISTER", "uri", req.URI, "ext", u.config.Extension)
	return u.transport.Send(u.config.AsteriskAddr, req)
}

func (u *UA) handleRegisterResponse(msg *Message) {
	if msg.Status == 200 {
		u.log.Info("SIP REGISTER OK")
	} else {
		u.log.Warn("SIP REGISTER failed", "status", msg.Status, "reason", msg.Reason)
	}
}

func (u *UA) MakeCall(peerURI string) (string, error) {
	branch := GenerateBranch()
	callID := generateCallID()
	rtpPort, err := u.allocateRTPPort()
	if err != nil {
		return "", fmt.Errorf("allocate RTP: %w", err)
	}

	call := &Call{
		ID:        callID,
		RemoteURI: peerURI,
		LocalURI:  fmt.Sprintf("sip:%s@%s", u.config.Extension, u.config.Domain),
		State:     CallStateInviting,
		Branch:    branch,
		CSeq:      1,
		RTPPort:   rtpPort,
	}

	u.mu.Lock()
	u.calls[callID] = call
	u.mu.Unlock()

	sdp := u.buildSDP(rtpPort)
	req := NewRequest(MethodInvite, fmt.Sprintf("sip:%s", peerURI), branch)
	req.CallID = callID
	req.SetHeader("Via", fmt.Sprintf("SIP/2.0/UDP %s;branch=%s", u.transport.LocalAddr(), branch))
	req.SetHeader("From", fmt.Sprintf("<sip:%s@%s>;tag=%s", u.config.Extension, u.config.Domain, u.generateTag()))
	req.SetHeader("To", fmt.Sprintf("<sip:%s>", peerURI))
	req.SetHeader("Call-ID", callID)
	req.SetHeader("CSeq", fmt.Sprintf("%d INVITE", call.CSeq))
	req.SetHeader("Contact", fmt.Sprintf("<sip:%s@%s>", u.config.Extension, u.transport.LocalAddr()))
	req.SetHeader("Max-Forwards", "70")
	req.SetHeader("User-Agent", u.config.UserAgent)
	req.SetHeader("Content-Type", "application/sdp")
	req.SetHeader("Content-Length", fmt.Sprintf("%d", len(sdp)))
	req.Body = sdp

	u.log.Info("SIP INVITE", "to", peerURI)
	return callID, u.transport.Send(u.config.AsteriskAddr, req)
}

func (u *UA) Hangup(callID string) error {
	u.mu.RLock()
	call, ok := u.calls[callID]
	u.mu.RUnlock()
	if !ok {
		return fmt.Errorf("call %s not found", callID)
	}

	branch := GenerateBranch()
	req := NewRequest(MethodBye, call.RemoteURI, branch)
	req.CallID = callID
	req.SetHeader("Via", fmt.Sprintf("SIP/2.0/UDP %s;branch=%s", u.transport.LocalAddr(), branch))
	req.SetHeader("From", fmt.Sprintf("<sip:%s@%s>;tag=%s", u.config.Extension, u.config.Domain, call.LocalTag))
	req.SetHeader("To", fmt.Sprintf("<sip:%s>;tag=%s", call.RemoteURI, call.RemoteTag))
	req.SetHeader("Call-ID", callID)
	req.SetHeader("CSeq", fmt.Sprintf("%d BYE", call.CSeq+1))
	req.SetHeader("Max-Forwards", "70")
	req.SetHeader("User-Agent", u.config.UserAgent)
	req.SetHeader("Content-Length", "0")

	u.mu.Lock()
	call.State = CallStateBye
	u.mu.Unlock()

	if call.OnState != nil {
		go call.OnState(CallStateBye)
	}

	u.log.Info("SIP BYE", "call_id", callID)
	return u.transport.Send(u.config.AsteriskAddr, req)
}

func (u *UA) handleMessage(msg *Message, addr *net.UDPAddr) {
	if msg.IsServer {
		u.handleResponse(msg)
	} else {
		u.handleRequest(msg, addr)
	}
}

func (u *UA) handleResponse(msg *Message) {
	switch {
	case strings.Contains(msg.GetHeader("cseq"), "REGISTER"):
		u.handleRegisterResponse(msg)
	case strings.Contains(msg.GetHeader("cseq"), "INVITE"):
		u.handleInviteResponse(msg)
	case strings.Contains(msg.GetHeader("cseq"), "BYE"):
		u.log.Info("SIP BYE response", "status", msg.Status)
	}
}

func (u *UA) handleInviteResponse(msg *Message) {
	callID := msg.CallID
	u.mu.RLock()
	call, ok := u.calls[callID]
	u.mu.RUnlock()
	if !ok {
		return
	}

	switch {
	case msg.Status == 100:
		u.log.Info("SIP 100 Trying", "call_id", callID)
	case msg.Status == 180 || msg.Status == 183:
		call.State = CallStateRinging
		if call.OnState != nil {
			go call.OnState(CallStateRinging)
		}
		u.log.Info("SIP Ringing", "call_id", callID, "status", msg.Status)
	case msg.Status >= 200 && msg.Status < 300:
		call.State = CallStateActive
		if tag := msg.GetHeader("to"); tag != "" {
			if idx := strings.Index(tag, "tag="); idx > 0 {
				call.RemoteTag = tag[idx+4:]
			}
		}
		ack := NewRequest(MethodAck, call.RemoteURI, call.Branch)
		ack.CallID = callID
		ack.SetHeader("Via", fmt.Sprintf("SIP/2.0/UDP %s;branch=%s", u.transport.LocalAddr(), call.Branch))
		ack.SetHeader("From", fmt.Sprintf("<sip:%s@%s>;tag=%s", u.config.Extension, u.config.Domain, call.LocalTag))
		ack.SetHeader("To", fmt.Sprintf("<sip:%s>;tag=%s", call.RemoteURI, call.RemoteTag))
		ack.SetHeader("Call-ID", callID)
		ack.SetHeader("CSeq", fmt.Sprintf("%d ACK", call.CSeq))
		ack.SetHeader("Content-Length", "0")
		u.transport.Send(u.config.AsteriskAddr, ack)

		if call.OnState != nil {
			go call.OnState(CallStateActive)
		}
		u.log.Info("SIP Call ACTIVE", "call_id", callID)
	case msg.Status >= 300:
		call.State = CallStateBye
		if call.OnState != nil {
			go call.OnState(CallStateBye)
		}
		u.log.Warn("SIP Call rejected", "call_id", callID, "status", msg.Status)
		delete(u.calls, callID)
	}
}

func (u *UA) handleRequest(msg *Message, addr *net.UDPAddr) {
	switch msg.Method {
	case MethodInvite:
		u.handleInboundInvite(msg, addr)
	case MethodBye:
		u.handleInboundBye(msg)
	case MethodOptions:
		u.handleOptions(msg, addr)
	}
}

func (u *UA) handleInboundInvite(msg *Message, addr *net.UDPAddr) {
	callID := msg.CallID
	from := msg.GetHeader("from")
	peer := ""
	if idx := strings.Index(from, "sip:"); idx > 0 {
		peer = from[idx:]
		if end := strings.Index(peer, ">"); end > 0 {
			peer = peer[:end]
		}
	}

	branch := GenerateBranch()
	call := &Call{
		ID:        callID,
		RemoteURI: peer,
		LocalURI:  fmt.Sprintf("sip:%s@%s", u.config.Extension, u.config.Domain),
		State:     CallStateRinging,
		Branch:    branch,
		CSeq:      msg.CSeq,
	}

	if tag := msg.GetHeader("from"); tag != "" {
		if idx := strings.Index(tag, "tag="); idx > 0 {
			call.RemoteTag = tag[idx+4:]
		}
	}
	call.LocalTag = u.generateTag()

	u.mu.Lock()
	u.calls[callID] = call
	u.mu.Unlock()

	u.log.Info("SIP INBOUND INVITE", "from", peer, "call_id", callID)

	// Send 180 Ringing
	ringing := NewResponse(180, "Ringing", msg)
	ringing.SetHeader("Via", msg.GetHeader("via"))
	ringing.SetHeader("From", msg.GetHeader("from"))
	ringing.SetHeader("To", fmt.Sprintf("<%s>;tag=%s", msg.GetHeader("to"), call.LocalTag))
	ringing.SetHeader("Call-ID", callID)
	ringing.SetHeader("CSeq", fmt.Sprintf("%d INVITE", msg.CSeq))
	ringing.SetHeader("Content-Length", "0")
	u.transport.Send(u.config.AsteriskAddr, ringing)

	// Auto-answer with 200 OK
	rtpPort, _ := u.allocateRTPPort()
	sdp := u.buildSDP(rtpPort)
	ok200 := NewResponse(200, "OK", msg)
	ok200.SetHeader("Via", msg.GetHeader("via"))
	ok200.SetHeader("From", msg.GetHeader("from"))
	ok200.SetHeader("To", fmt.Sprintf("<%s>;tag=%s", msg.GetHeader("to"), call.LocalTag))
	ok200.SetHeader("Call-ID", callID)
	ok200.SetHeader("CSeq", fmt.Sprintf("%d INVITE", msg.CSeq))
	ok200.SetHeader("Contact", fmt.Sprintf("<sip:%s@%s>", u.config.Extension, u.transport.LocalAddr()))
	ok200.SetHeader("Content-Type", "application/sdp")
	ok200.SetHeader("Content-Length", fmt.Sprintf("%d", len(sdp)))
	ok200.Body = sdp
	u.transport.Send(u.config.AsteriskAddr, ok200)

	call.State = CallStateActive
	if call.OnState != nil {
		go call.OnState(CallStateActive)
	}

	if u.onInbound != nil {
		go u.onInbound(peer, nil)
	}
}

func (u *UA) handleInboundBye(msg *Message) {
	callID := msg.CallID
	u.mu.Lock()
	if call, ok := u.calls[callID]; ok {
		call.State = CallStateBye
		if call.OnState != nil {
			go call.OnState(CallStateBye)
		}
		delete(u.calls, callID)
	}
	u.mu.Unlock()

	resp := NewResponse(200, "OK", msg)
	resp.SetHeader("Via", msg.GetHeader("via"))
	resp.SetHeader("From", msg.GetHeader("from"))
	resp.SetHeader("To", msg.GetHeader("to"))
	resp.SetHeader("Call-ID", callID)
	resp.SetHeader("CSeq", fmt.Sprintf("%d BYE", msg.CSeq))
	resp.SetHeader("Content-Length", "0")
	u.transport.Send(u.config.AsteriskAddr, resp)
	u.log.Info("SIP BYE received", "call_id", callID)
}

func (u *UA) handleOptions(msg *Message, addr *net.UDPAddr) {
	resp := NewResponse(200, "OK", msg)
	resp.SetHeader("Via", msg.GetHeader("via"))
	resp.SetHeader("From", msg.GetHeader("from"))
	resp.SetHeader("To", msg.GetHeader("to"))
	resp.SetHeader("Call-ID", msg.CallID)
	resp.SetHeader("CSeq", fmt.Sprintf("%d OPTIONS", msg.CSeq))
	resp.SetHeader("Allow", "INVITE, ACK, CANCEL, BYE, OPTIONS")
	resp.SetHeader("Content-Length", "0")
	u.transport.Send(u.config.AsteriskAddr, resp)
}

func (u *UA) buildSDP(port int) string {
	return fmt.Sprintf(`v=0
o=wa 0 0 IN IP4 %s
s=WaCalls SIP Bridge
c=IN IP4 %s
t=0 0
m=audio %d RTP/AVP 0 8 101
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=ptime:20
a=sendrecv
`, u.localIP, u.localIP, port)
}

func (u *UA) allocateRTPPort() (int, error) {
	addr, err := net.ResolveUDPAddr("udp", ":0")
	if err != nil {
		return 0, err
	}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		return 0, err
	}
	port := conn.LocalAddr().(*net.UDPAddr).Port
	conn.Close()
	return port, nil
}

func (u *UA) OnInbound(handler func(peer string, answer func(offer []byte) []byte)) {
	u.onInbound = handler
}

func (u *UA) GetCall(callID string) (*Call, bool) {
	u.mu.RLock()
	defer u.mu.RUnlock()
	c, ok := u.calls[callID]
	return c, ok
}

func (u *UA) ListCalls() []*Call {
	u.mu.RLock()
	defer u.mu.RUnlock()
	out := make([]*Call, 0, len(u.calls))
	for _, c := range u.calls {
		out = append(out, c)
	}
	return out
}

func (u *UA) Config() Config {
	return u.config
}
