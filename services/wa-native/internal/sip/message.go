package sip

import (
	"fmt"
	"net"
	"strings"
	"sync/atomic"
)

type Method string

const (
	MethodRegister Method = "REGISTER"
	MethodInvite   Method = "INVITE"
	MethodAck      Method = "ACK"
	MethodBye      Method = "BYE"
	MethodCancel   Method = "CANCEL"
	MethodOptions  Method = "OPTIONS"
)

type Message struct {
	Method    Method
	URI      string
	Status   int
	Reason   string
	Headers  map[string][]string
	Body     string
	IsServer bool
	BranchID string
	CallID   string
	CSeq     uint32
}

func NewRequest(method Method, uri string, branchID string) *Message {
	return &Message{
		Method:    method,
		URI:      uri,
		Headers:  make(map[string][]string),
		BranchID: branchID,
		CallID:   generateCallID(),
		CSeq:     atomic.AddUint32(&cseqCounter, 1),
	}
}

func NewResponse(status int, reason string, req *Message) *Message {
	return &Message{
		Status:   status,
		Reason:   reason,
		Headers:  make(map[string][]string),
		BranchID: req.BranchID,
		CallID:   req.CallID,
		CSeq:     req.CSeq,
		IsServer: true,
	}
}

var cseqCounter uint32

func (m *Message) SetHeader(name, value string) {
	m.Headers[strings.ToLower(name)] = append(m.Headers[strings.ToLower(name)], value)
}

func (m *Message) GetHeader(name string) string {
	if vals, ok := m.Headers[strings.ToLower(name)]; ok && len(vals) > 0 {
		return vals[0]
	}
	return ""
}

func (m *Message) Serialize() []byte {
	var sb strings.Builder
	if m.IsServer {
		sb.WriteString(fmt.Sprintf("SIP/2.0 %d %s\r\n", m.Status, m.Reason))
	} else {
		sb.WriteString(fmt.Sprintf("%s %s SIP/2.0\r\n", m.Method, m.URI))
	}
	for k, vals := range m.Headers {
		for _, v := range vals {
			sb.WriteString(fmt.Sprintf("%s: %s\r\n", k, v))
		}
	}
	sb.WriteString("\r\n")
	if m.Body != "" {
		sb.WriteString(m.Body)
	}
	return []byte(sb.String())
}

func Parse(data []byte) *Message {
	s := string(data)
	lines := strings.Split(s, "\r\n")
	if len(lines) < 1 {
		return nil
	}
	msg := &Message{Headers: make(map[string][]string)}
	firstLine := lines[0]
	if strings.HasPrefix(firstLine, "SIP/2.0") {
		msg.IsServer = true
		fmt.Sscanf(firstLine, "SIP/2.0 %d %s", &msg.Status, &msg.Reason)
	} else {
		parts := strings.SplitN(firstLine, " ", 3)
		if len(parts) >= 2 {
			msg.Method = Method(parts[0])
			msg.URI = parts[1]
		}
	}
	bodyStart := false
	for _, line := range lines[1:] {
		if bodyStart {
			msg.Body += line + "\r\n"
			continue
		}
		if line == "" {
			bodyStart = true
			continue
		}
		if idx := strings.Index(line, ":"); idx > 0 {
			key := strings.TrimSpace(line[:idx])
			val := strings.TrimSpace(line[idx+1:])
			msg.Headers[strings.ToLower(key)] = append(msg.Headers[strings.ToLower(key)], val)
		}
	}
	msg.Body = strings.TrimRight(msg.Body, "\r\n")
	if branch := msg.GetHeader("via"); branch != "" {
		parts := strings.Split(branch, ";branch=")
		if len(parts) > 1 {
			msg.BranchID = strings.Split(parts[1], ";")[0]
		}
	}
	msg.CallID = msg.GetHeader("call-id")
	if cseq := msg.GetHeader("cseq"); cseq != "" {
		fmt.Sscanf(cseq, "%d", &msg.CSeq)
	}
	return msg
}

type Transport struct {
	conn    *net.UDPConn
	addr    string
	handler func(msg *Message, addr *net.UDPAddr)
	stopCh  chan struct{}
}

func NewTransport(listenAddr string) (*Transport, error) {
	udpAddr, err := net.ResolveUDPAddr("udp", listenAddr)
	if err != nil {
		return nil, fmt.Errorf("resolve SIP listen addr: %w", err)
	}
	conn, err := net.ListenUDP("udp", udpAddr)
	if err != nil {
		return nil, fmt.Errorf("listen SIP UDP: %w", err)
	}
	return &Transport{
		conn:   conn,
		addr:   listenAddr,
		stopCh: make(chan struct{}),
	}, nil
}

func (t *Transport) Start(handler func(msg *Message, addr *net.UDPAddr)) {
	t.handler = handler
	go func() {
		buf := make([]byte, 65535)
		for {
			select {
			case <-t.stopCh:
				return
			default:
			}
			n, raddr, err := t.conn.ReadFromUDP(buf)
			if err != nil {
				continue
			}
			if msg := Parse(buf[:n]); msg != nil {
				go t.handler(msg, raddr)
			}
		}
	}()
}

func (t *Transport) Send(addr string, msg *Message) error {
	udpAddr, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return err
	}
	_, err = t.conn.WriteToUDP(msg.Serialize(), udpAddr)
	return err
}

func (t *Transport) Stop() {
	close(t.stopCh)
	t.conn.Close()
}

func (t *Transport) LocalAddr() string {
	return t.conn.LocalAddr().String()
}

func generateCallID() string {
	b := make([]byte, 16)
	for i := range b {
		b[i] = "0123456789abcdef"[i%16]
	}
	return fmt.Sprintf("%x", b)
}

func GenerateBranch() string {
	return "z9hG4bK" + fmt.Sprintf("%08x", atomic.AddUint32(&cseqCounter, 1))
}
