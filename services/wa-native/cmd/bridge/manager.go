package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"

	"wacalls/internal/recording"
	"wacalls/internal/voip/call"
	"wacalls/internal/voip/core"
	"wacalls/internal/voip/signaling"
	"wacalls/internal/voip/wanode"
	"wacalls/internal/wa"

	"github.com/redis/go-redis/v9"
	qrcode "github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

type Hub struct {
	ctx         context.Context
	db          *sql.DB
	container   *sqlstore.Container
	rdb         *redis.Client
	token       string
	recordings  string
	waLogger    waLog.Logger
	log         *slog.Logger
	mu          sync.Mutex
	channels    map[string]*Channel
}

type Channel struct {
	id     string
	hub    *Hub
	client *whatsmeow.Client
	log    *slog.Logger

	mu         sync.Mutex
	status     string
	qr         string
	qrCode     string
	pairCode   string
	lastError  string
	phone      string
	name       string
	orgID      string
	pairCancel context.CancelFunc
	calls      map[string]*liveCall
}

type liveCall struct {
	apiCallID      string
	engineCallID   string
	channelID      string
	orgID          string
	cm             *call.CallManager
	started        time.Time
	muted          bool
	hangupAfter    bool
	stopPlay       chan struct{}
	playAudioPath  string
	recorder      *recording.Recorder
	recordingPath string
	once          sync.Once
}

func NewHub(ctx context.Context, db *sql.DB, container *sqlstore.Container, rdb *redis.Client, token, recordings string, waLogger waLog.Logger, log *slog.Logger) *Hub {
	_ = os.MkdirAll(filepath.Join(recordings, "calls"), 0o755)
	store.SetOSInfo("Chrome", [3]uint32{122, 0, 0})
	h := &Hub{
		ctx:        ctx,
		db:         db,
		container:  container,
		rdb:        rdb,
		token:      token,
		recordings: recordings,
		waLogger:   waLogger,
		log:        log,
		channels:   map[string]*Channel{},
	}
	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				h.expireStaleCalls(context.Background())
			}
		}
	}()
	return h
}

func (h *Hub) Shutdown() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, ch := range h.channels {
		ch.shutdown()
	}
}

func (h *Hub) Restore(ctx context.Context) error {
	rows, err := h.loadSessions(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if row.JID == "" {
			continue
		}
		jid, err := types.ParseJID(row.JID)
		if err != nil {
			continue
		}
		device, err := h.container.GetDevice(ctx, jid)
		if err != nil || device == nil {
			h.log.Warn("stored device missing", "channel", row.ChannelID, "jid", row.JID)
			continue
		}
		ch := h.makeChannel(row.ChannelID, device)
		if org, err := h.channelOrg(ctx, row.ChannelID); err == nil {
			ch.orgID = org
		}
		if err := ch.client.Connect(); err != nil {
			h.log.Warn("restore connect failed", "channel", row.ChannelID, "err", err)
			ch.setStatus("RECONNECTING", err.Error())
			continue
		}
	}
	h.log.Info("native sessions restored", "count", len(rows))
	return nil
}

func (h *Hub) getChannel(id string) *Channel {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.channels[id]
}

func (h *Hub) ensureStore(ctx context.Context) error {
	var exists bool
	if err := h.db.QueryRowContext(ctx, `
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'whatsmeow_device'
)`).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	h.log.Warn("whatsmeow_device missing; upgrading store")
	return h.container.Upgrade(ctx)
}

func (h *Hub) makeChannel(id string, device *store.Device) *Channel {
	h.mu.Lock()
	defer h.mu.Unlock()
	if existing := h.channels[id]; existing != nil {
		existing.shutdown()
	}
	client := whatsmeow.NewClient(device, h.waLogger)
	client.EnableAutoReconnect = true
	ch := &Channel{
		id:     id,
		hub:    h,
		client: client,
		log:    h.log.With("channel", id),
		status: "CONNECTING",
		calls:  map[string]*liveCall{},
	}
	client.AddEventHandler(ch.handleEvent)
	h.channels[id] = ch
	return ch
}

func (h *Hub) Connect(ctx context.Context, channelID string, forceQR bool) error {
	if err := h.ensureStore(ctx); err != nil {
		return fmt.Errorf("whatsmeow store: %w", err)
	}
	org, err := h.channelOrg(ctx, channelID)
	if err != nil {
		return fmt.Errorf("unknown channel")
	}
	ch := h.getChannel(channelID)
	if forceQR && ch != nil {
		ch.logout(ctx)
		ch = nil
	}
	if ch != nil && ch.client.Store.ID != nil {
		if !ch.client.IsConnected() {
			if err := ch.client.Connect(); err != nil {
				return err
			}
		}
		ch.orgID = org
		return nil
	}
	device := h.container.NewDevice()
	ch = h.makeChannel(channelID, device)
	ch.orgID = org
	ch.setStatus("CONNECTING", "")
	return ch.startPairing()
}

func (h *Hub) PairWithCode(ctx context.Context, channelID, phone string) (string, error) {
	if err := h.ensureStore(ctx); err != nil {
		return "", fmt.Errorf("whatsmeow store: %w", err)
	}
	phone = digitsOnly(phone)
	if len(phone) < 8 {
		return "", fmt.Errorf("enter the WhatsApp number with country code, e.g. 9198xxxxxxxx")
	}
	if strings.HasPrefix(phone, "0") {
		return "", fmt.Errorf("use international format without a leading 0")
	}
	org, err := h.channelOrg(ctx, channelID)
	if err != nil {
		return "", fmt.Errorf("unknown channel")
	}
	ch := h.getChannel(channelID)
	if ch != nil {
		ch.logout(ctx)
	}
	device := h.container.NewDevice()
	ch = h.makeChannel(channelID, device)
	ch.orgID = org
	ch.setStatus("CONNECTING", "")

	pairCtx, cancel := context.WithCancel(h.ctx)
	ch.mu.Lock()
	ch.pairCancel = cancel
	ch.qr = ""
	ch.qrCode = ""
	ch.pairCode = ""
	ch.mu.Unlock()

	if err := ch.client.Connect(); err != nil {
		cancel()
		return "", err
	}
	deadline := time.Now().Add(12 * time.Second)
	for !ch.client.IsConnected() {
		if time.Now().After(deadline) {
			cancel()
			return "", fmt.Errorf("WhatsApp socket not ready — try again")
		}
		select {
		case <-pairCtx.Done():
			return "", fmt.Errorf("pairing cancelled")
		case <-time.After(100 * time.Millisecond):
		}
	}

	code, err := ch.client.PairPhone(pairCtx, phone, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
	if err != nil {
		ch.setStatus("ERROR", err.Error())
		return "", err
	}
	ch.mu.Lock()
	ch.pairCode = code
	ch.status = "CONNECTING"
	ch.mu.Unlock()
	ch.log.Info("pairing code ready", "phone", phone)
	ch.publish("pair_code", map[string]any{"code": code, "status": "CONNECTING"})
	return code, nil
}

func (ch *Channel) cancelPairing() {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if ch.pairCancel != nil {
		ch.pairCancel()
		ch.pairCancel = nil
	}
}

func (ch *Channel) logout(ctx context.Context) {
	ch.cancelPairing()
	ch.teardownCalls()
	if ch.client.Store.ID != nil {
		_ = ch.client.Logout(ctx)
	} else {
		ch.client.Disconnect()
	}
	ch.hub.saveJID(ctx, ch.id, "")
}

func (ch *Channel) shutdown() {
	ch.cancelPairing()
	ch.teardownCalls()
	ch.client.Disconnect()
}

func pairingPNG(code string) (string, error) {
	q, err := qrcode.New(code, qrcode.Medium)
	if err != nil {
		return "", err
	}
	q.DisableBorder = false
	png, err := q.PNG(720)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), nil
}

func (ch *Channel) startPairing() error {
	ch.cancelPairing()
	ctx, cancel := context.WithCancel(ch.hub.ctx)
	ch.mu.Lock()
	ch.pairCancel = cancel
	ch.qr = ""
	ch.qrCode = ""
	ch.pairCode = ""
	ch.mu.Unlock()

	qrChan, err := ch.client.GetQRChannel(ctx)
	if err != nil {
		cancel()
		if ch.client.Store.ID != nil {
			return ch.client.Connect()
		}
		return err
	}
	if err := ch.client.Connect(); err != nil {
		cancel()
		return err
	}
	go func() {
		for evt := range qrChan {
			switch evt.Event {
			case "code":
				pngURL, err := pairingPNG(evt.Code)
				if err != nil {
					ch.log.Warn("pairing qr encode failed", "err", err)
					continue
				}
				ch.mu.Lock()
				ch.qr = pngURL
				ch.qrCode = evt.Code
				ch.status = "CONNECTING"
				ch.mu.Unlock()
				ch.log.Info("pairing qr ready")
				ch.publish("qr", map[string]any{
					"qrDataUrl": pngURL,
					"qrCode":    evt.Code,
					"status":    "CONNECTING",
				})
			case "success":
				ch.onPaired()
			case "timeout":
				ch.setStatus("DISCONNECTED", "QR expired — tap New QR")
			case "error":
				ch.setStatus("ERROR", "WhatsApp pairing failed")
			}
		}
	}()
	return nil
}

func (ch *Channel) onPaired() {
	if ch.client.Store.ID == nil {
		return
	}
	phone, name := ch.identity()
	ch.hub.saveJID(context.Background(), ch.id, ch.client.Store.ID.String())
	ch.mu.Lock()
	already := ch.status == "CONNECTED" && ch.qr == "" && ch.qrCode == "" && ch.pairCode == ""
	ch.qr = ""
	ch.qrCode = ""
	ch.pairCode = ""
	ch.phone = phone
	ch.name = name
	ch.mu.Unlock()
	if already {
		return
	}
	ch.log.Info("whatsapp paired", "phone", phone)
	ch.setStatus("CONNECTED", "")
}

func (ch *Channel) identity() (phone, name string) {
	if id := ch.client.Store.ID; id != nil {
		phone = id.User
	}
	if ch.client.Store != nil {
		name = ch.client.Store.PushName
	}
	return
}

func (ch *Channel) setStatus(status, lastErr string) {
	ch.mu.Lock()
	ch.status = status
	ch.lastError = lastErr
	phone, name := ch.phone, ch.name
	ch.mu.Unlock()
	ch.hub.updateChannel(context.Background(), ch.id, status, phone, name, lastErr)
	ch.publish("channel_status", map[string]any{"status": status, "phoneNumber": phone, "displayName": name, "reason": lastErr})
}

func (ch *Channel) handleEvent(raw any) {
	ctx := context.Background()
	switch evt := raw.(type) {
	case *events.PairSuccess:
		ch.onPaired()
	case *events.PairError:
		ch.setStatus("ERROR", fmt.Sprintf("pairing failed: %v", evt.Error))
	case *events.Connected:
		ch.onPaired()
	case *events.Disconnected:
		if ch.client.Store.ID != nil {
			ch.setStatus("RECONNECTING", "disconnected")
		}
	case *events.LoggedOut:
		ch.setStatus("DISCONNECTED", "logged out")
	case *events.CallOffer:
		ch.onIncomingOffer(ctx, evt)
	case *events.CallAccept:
		if lc := ch.callFromNode(evt.From, evt.Data); lc != nil {
			lc.cm.HandleCallAccept(ctx, wrapCall(evt.From, evt.Data), evt.From)
		}
	case *events.CallTransport:
		if lc := ch.callFromNode(evt.From, evt.Data); lc != nil {
			lc.cm.HandleCallTransport(ctx, wrapCall(evt.From, evt.Data), evt.From)
		}
	case *events.CallTerminate, *events.CallReject:
		switch e := evt.(type) {
		case *events.CallTerminate:
			if lc := ch.callFromNode(e.From, e.Data); lc != nil {
				lc.cm.HandleCallTerminate(wrapCall(e.From, e.Data))
			}
		case *events.CallReject:
			if lc := ch.callFromNode(e.From, e.Data); lc != nil {
				lc.cm.HandleCallTerminate(wrapCall(e.From, e.Data))
			}
		}
	case *events.Message:
		ch.onChatMessage(ctx, evt)
	}
}

func (ch *Channel) onChatMessage(ctx context.Context, evt *events.Message) {
	if evt == nil || evt.Info.IsFromMe || evt.Info.IsGroup {
		return
	}
	text := messageText(evt.Message)
	if strings.TrimSpace(text) == "" {
		return
	}
	phone := ch.peerPhone(ctx, evt.Info.Sender)
	ch.publish("inbound_chat", map[string]any{
		"phone":     phone,
		"text":      text,
		"messageId": evt.Info.ID,
	})
}

func messageText(msg *waE2E.Message) string {
	if msg == nil {
		return ""
	}
	if t := msg.GetConversation(); t != "" {
		return t
	}
	if ext := msg.GetExtendedTextMessage(); ext != nil {
		if t := ext.GetText(); t != "" {
			return t
		}
	}
	return ""
}

func (ch *Channel) onIncomingOffer(ctx context.Context, evt *events.CallOffer) {
	node := wrapCall(evt.From, evt.Data)
	info := signaling.ExtractNodeInfo(node)
	if info == nil {
		return
	}
	if ch.hasLiveCall() {
		ch.rejectOffer(ctx, evt.From, info, "already on a call")
		return
	}
	cfg, err := ch.hub.loadIncomingConfig(ctx, ch.id)
	if err != nil {
		ch.log.Warn("incoming auto-answer config failed", "err", err)
		ch.rejectOffer(ctx, evt.From, info, "auto-answer unavailable")
		return
	}
	if cfg == nil || !cfg.Enabled || cfg.AiConfigID == "" {
		ch.rejectOffer(ctx, evt.From, info, "auto-answer off")
		return
	}
	if info.InnerNode != nil && hasChildTag(*info.InnerNode, "video") {
		ch.rejectOffer(ctx, evt.From, info, "video not supported")
		return
	}
	if ch.orgID == "" {
		if org, orgErr := ch.hub.channelOrg(ctx, ch.id); orgErr == nil {
			ch.orgID = org
		}
	}
	phone := ch.peerPhone(ctx, evt.From)
	callID, contactName, err := ch.hub.createInboundCall(ctx, ch.orgID, ch.id, phone, info.CallID)
	if err != nil {
		ch.log.Warn("inbound call row failed", "err", err)
		ch.rejectOffer(ctx, evt.From, info, "could not record inbound call")
		return
	}
	if !ch.hub.acquireChannelLock(ch.id, callID) {
		ch.hub.failCall(ctx, callID, "line busy")
		ch.rejectOffer(ctx, evt.From, info, "line busy")
		return
	}

	cm := call.NewCallManager(wa.NewSocket(ch.client), ch.log)
	lc := &liveCall{
		apiCallID:    callID,
		engineCallID: info.CallID,
		channelID:    ch.id,
		orgID:        ch.orgID,
		cm:           cm,
		started:      time.Now(),
		stopPlay:     make(chan struct{}),
	}
	ch.wireCall(lc)
	ch.mu.Lock()
	ch.calls[info.CallID] = lc
	ch.calls[callID] = lc
	ch.mu.Unlock()

	cm.HandleCallOffer(ctx, node, evt.From)
	if err := cm.AcceptCall(ctx, info.CallID); err != nil {
		ch.log.Warn("auto-answer accept failed", "err", err, "call_id", info.CallID)
		ch.hub.failCall(ctx, callID, err.Error())
		ch.releaseLock(callID)
		ch.removeCall(lc)
		ch.rejectOffer(ctx, evt.From, info, "accept failed")
		return
	}
	ch.emitCall(lc, "ringing", "")
	payload, _ := json.Marshal(map[string]any{
		"callId":         callID,
		"organizationId": ch.orgID,
		"channelId":      ch.id,
		"phone":          e164Phone(phone),
		"contactName":    contactName,
		"aiConfigId":     cfg.AiConfigID,
		"sendMessage":    cfg.SendMessage,
		"messageBody":    cfg.MessageBody,
		"messageWhen":    cfg.MessageWhen,
	})
	_ = ch.hub.rdb.Publish(ctx, "wacalls:inbound", payload).Err()
	ch.log.Info("auto-answered inbound call", "call_id", callID, "peer", phone)
}

func (ch *Channel) rejectOffer(ctx context.Context, from types.JID, info *signaling.NodeInfo, reason string) {
	if info == nil {
		return
	}
	creator := wanode.AttrString(info.InnerNode.Attrs, "call-creator")
	if creator == "" {
		creator = from.String()
	}
	reject := signaling.BuildRejectStanza(from, info.CallID, wanode.MustJID(creator))
	_ = wa.NewSocket(ch.client).SendNode(ctx, reject)
	ch.log.Info("rejected inbound call", "call_id", info.CallID, "reason", reason)
}

func (ch *Channel) hasLiveCall() bool {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	seen := map[*liveCall]bool{}
	for _, lc := range ch.calls {
		if lc == nil || seen[lc] {
			continue
		}
		seen[lc] = true
		cur := lc.cm.CurrentCall()
		if cur != nil && !cur.IsEnded() {
			return true
		}
	}
	return false
}

func (ch *Channel) peerPhone(ctx context.Context, jid types.JID) string {
	if jid.Server == types.DefaultUserServer {
		return jid.User
	}
	if ch.client.Store != nil && ch.client.Store.LIDs != nil {
		if pn, err := ch.client.Store.LIDs.GetPNForLID(ctx, jid); err == nil && !pn.IsEmpty() {
			return pn.User
		}
	}
	return jid.User
}

func hasChildTag(node waBinary.Node, tag string) bool {
	children, ok := node.Content.([]waBinary.Node)
	if !ok {
		return false
	}
	for _, child := range children {
		if child.Tag == tag {
			return true
		}
	}
	return false
}

func (ch *Channel) callFromNode(from types.JID, data *waBinary.Node) *liveCall {
	info := signaling.ExtractNodeInfo(wrapCall(from, data))
	if info == nil {
		return nil
	}
	ch.mu.Lock()
	defer ch.mu.Unlock()
	return ch.calls[info.CallID]
}

func wrapCall(from types.JID, inner *waBinary.Node) *waBinary.Node {
	content := []waBinary.Node{}
	if inner != nil {
		content = append(content, *inner)
	}
	return &waBinary.Node{Tag: "call", Attrs: waBinary.Attrs{"from": from}, Content: content}
}

func (ch *Channel) StartCall(ctx context.Context, apiCallID, phone string, audioPath string, hangupAfter bool) (engineID string, err error) {
	if ch.client.Store.ID == nil || !ch.client.IsConnected() {
		return "", fmt.Errorf("WhatsApp channel is not CONNECTED")
	}
	digits := digitsOnly(phone)
	if digits == "" {
		return "", fmt.Errorf("invalid phone number")
	}
	peer := types.NewJID(digits, types.DefaultUserServer)
	engineID = signaling.GenerateCallID()
	cm := call.NewCallManager(wa.NewSocket(ch.client), ch.log)
	lc := &liveCall{
		apiCallID:    apiCallID,
		engineCallID: engineID,
		channelID:    ch.id,
		orgID:        ch.orgID,
		cm:           cm,
		started:      time.Now(),
		hangupAfter:  hangupAfter,
		stopPlay:     make(chan struct{}),
		playAudioPath: audioPath,
	}
	ch.wireCall(lc)
	ch.mu.Lock()
	ch.calls[engineID] = lc
	if apiCallID != "" {
		ch.calls[apiCallID] = lc
	}
	ch.mu.Unlock()

	_ = ch.client.SendPresence(ctx, types.PresenceAvailable)
	if err := cm.StartCall(ctx, engineID, peer, false); err != nil {
		ch.removeCall(lc)
		return "", err
	}
	ch.emitCall(lc, "connecting", "")
	return engineID, nil
}

func (ch *Channel) wireCall(lc *liveCall) {
	lc.cm.OnStateChange = func(info *call.CallInfo) {
		if info.IsEnded() {
			ch.finishCall(lc, mapEndReason(info.StateData.EndReason), string(info.StateData.EndReason))
			return
		}
		switch info.StateData.State {
		case core.CallStateRinging, core.CallStateConnecting:
			ch.emitCall(lc, "ringing", "")
		case core.CallStateActive:
			ch.startRecording(lc)
			ch.emitCall(lc, "answered", "")
			if lc.playAudioPath != "" {
				// Start playback only after the WhatsApp call is active; otherwise playback_done
				// can fire early and hang up before the peer answers.
				path := lc.playAudioPath
				lc.playAudioPath = ""
				go ch.playFile(lc, path)
			}
		}
	}
	lc.cm.OnEnded = func(info *call.CallInfo) {
		ch.finishCall(lc, mapEndReason(info.StateData.EndReason), string(info.StateData.EndReason))
	}
	lc.cm.OnPeerAudio = func(pcm []float32) {
		if lc.recorder != nil {
			lc.recorder.WritePCM(pcm)
		}
		ch.publishPCM(lc.apiCallID, pcm)
	}
}

func (ch *Channel) startRecording(lc *liveCall) {
	if lc.recorder != nil {
		return
	}
	path := filepath.Join(ch.hub.recordings, "calls", lc.apiCallID+".wav")
	rec, err := recording.New(path)
	if err != nil {
		ch.log.Warn("recording open failed", "err", err)
		return
	}
	lc.recorder = rec
	lc.recordingPath = path
}

func (ch *Channel) finishCall(lc *liveCall, eventType, reason string) {
	lc.once.Do(func() {
		ch.finishCallLocked(lc, eventType, reason)
	})
}

func (ch *Channel) finishCallLocked(lc *liveCall, eventType, reason string) {
	select {
	case <-lc.stopPlay:
	default:
		close(lc.stopPlay)
	}
	if lc.recorder != nil {
		_, _, _ = lc.recorder.Stop()
		ch.hub.setRecording(context.Background(), lc.apiCallID, lc.recordingPath)
		ch.publish("recording", map[string]any{"callId": lc.apiCallID, "recordingPath": lc.recordingPath})
		lc.recorder = nil
	}
	duration := int(time.Since(lc.started).Milliseconds())
	ch.hub.updateCall(context.Background(), lc.apiCallID, strings.ToUpper(eventType), reason, duration)
	if eventType == "ended" || eventType == "failed" || eventType == "busy" || eventType == "no_answer" || eventType == "rejected" {
		ch.emitCall(lc, eventType, reason)
		ch.removeCall(lc)
		ch.releaseLock(lc.apiCallID)
	}
}

func (ch *Channel) removeCall(lc *liveCall) {
	ch.mu.Lock()
	delete(ch.calls, lc.engineCallID)
	delete(ch.calls, lc.apiCallID)
	ch.mu.Unlock()
}

func (ch *Channel) teardownCalls() {
	ch.mu.Lock()
	all := make([]*liveCall, 0, len(ch.calls))
	seen := map[*liveCall]bool{}
	for _, lc := range ch.calls {
		if !seen[lc] {
			seen[lc] = true
			all = append(all, lc)
		}
	}
	ch.calls = map[string]*liveCall{}
	ch.mu.Unlock()
	for _, lc := range all {
		_ = lc.cm.EndCall(context.Background(), core.EndCallReasonUserEnded)
	}
}

func (ch *Channel) lookupCall(id string) *liveCall {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	return ch.calls[id]
}

func (ch *Channel) emitCall(lc *liveCall, typ, reason string) {
	status := strings.ToUpper(typ)
	if typ == "connecting" {
		status = "CONNECTING"
	}
	if typ == "ringing" {
		status = "RINGING"
	}
	if typ == "answered" {
		status = "ANSWERED"
	}
	ch.hub.updateCall(context.Background(), lc.apiCallID, status, reason, int(time.Since(lc.started).Milliseconds()))
	payload := map[string]any{
		"type":      typ,
		"callId":    lc.apiCallID,
		"channelId": ch.id,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"reason":    reason,
	}
	if lc.orgID != "" {
		payload["organizationId"] = lc.orgID
	}
	ch.publishRaw(payload)
}

func (ch *Channel) publish(typ string, extra map[string]any) {
	payload := map[string]any{
		"type":      typ,
		"channelId": ch.id,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	if ch.orgID != "" {
		payload["organizationId"] = ch.orgID
	}
	for k, v := range extra {
		payload[k] = v
	}
	ch.publishRaw(payload)
}

func (ch *Channel) publishRaw(payload map[string]any) {
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_ = ch.hub.rdb.Publish(context.Background(), "wacalls:events", b).Err()
}

func (ch *Channel) publishPCM(callID string, pcm []float32) {
	if callID == "" || len(pcm) == 0 {
		return
	}
	buf := make([]byte, len(pcm)*4)
	for i, s := range pcm {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(s))
	}
	_ = ch.hub.rdb.Publish(context.Background(), "wacalls:pcm:"+callID, buf).Err()
}

func (ch *Channel) releaseLock(callID string) {
	key := "lock:whatsapp-channel:" + ch.id
	owner, err := ch.hub.rdb.Get(context.Background(), key).Result()
	if err == nil && owner == callID {
		_ = ch.hub.rdb.Del(context.Background(), key).Err()
	}
}

func (ch *Channel) FeedPCM(callID string, pcm []float32) {
	lc := ch.lookupCall(callID)
	if lc == nil || lc.muted || len(pcm) == 0 {
		return
	}
	if lc.recorder != nil {
		lc.recorder.WritePCM(pcm)
	}
	lc.cm.FeedCapturedPCM(pcm)
}

func (ch *Channel) Hangup(callID string) {
	lc := ch.lookupCall(callID)
	if lc == nil {
		return
	}
	_ = lc.cm.EndCall(context.Background(), core.EndCallReasonUserEnded)
}

func (ch *Channel) Mute(callID string, muted bool) {
	lc := ch.lookupCall(callID)
	if lc == nil {
		return
	}
	lc.muted = muted
}

func (ch *Channel) SendText(ctx context.Context, phone, text string) (string, error) {
	return ch.SendChat(ctx, phone, ChatPayload{Text: text}, 0)
}

type ChatButton struct {
	ID    string `json:"id"`
	Type  string `json:"type"`
	Text  string `json:"text"`
	URL   string `json:"url"`
	Phone string `json:"phone"`
}

type ChatRow struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type ChatSection struct {
	Title string    `json:"title"`
	Rows  []ChatRow `json:"rows"`
}

type ChatPayload struct {
	Kind       string        `json:"kind"`
	Text       string        `json:"text"`
	Header     string        `json:"header"`
	Footer     string        `json:"footer"`
	ImagePath  string        `json:"imagePath"`
	Buttons    []ChatButton  `json:"buttons"`
	ListButton string        `json:"listButton"`
	Sections   []ChatSection `json:"sections"`
}

func (ch *Channel) SendChat(ctx context.Context, phone string, payload ChatPayload, typing time.Duration) (string, error) {
	digits := digitsOnly(phone)
	jid := types.NewJID(digits, types.DefaultUserServer)
	if typing > 0 {
		_ = ch.client.SendChatPresence(ctx, jid, types.ChatPresenceComposing, types.ChatPresenceMediaText)
		timer := time.NewTimer(typing)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", ctx.Err()
		case <-timer.C:
		}
		_ = ch.client.SendChatPresence(ctx, jid, types.ChatPresencePaused, types.ChatPresenceMediaText)
	}
	kind := strings.ToUpper(strings.TrimSpace(payload.Kind))
	if kind == "BUTTON" && len(payload.Buttons) > 0 {
		id, err := ch.sendButtons(ctx, jid, payload)
		if err == nil {
			return id, nil
		}
		ch.log.Warn("button template send failed, falling back", "err", err)
	}
	if kind == "LIST" && len(payload.Sections) > 0 {
		id, err := ch.sendList(ctx, jid, payload)
		if err == nil {
			return id, nil
		}
		ch.log.Warn("list template send failed, falling back", "err", err)
	}
	if payload.ImagePath != "" {
		id, err := ch.sendImage(ctx, jid, payload.ImagePath, payload.Text)
		if err == nil {
			return id, nil
		}
		ch.log.Warn("image send failed, falling back to text", "err", err)
	}
	text := strings.TrimSpace(payload.Text)
	if text == "" {
		text = strings.TrimSpace(strings.TrimSpace(payload.Header) + "\n\n" + strings.TrimSpace(payload.Footer))
	}
	if text == "" {
		return "", fmt.Errorf("empty message")
	}
	msg := &waE2E.Message{Conversation: proto.String(text)}
	resp, err := ch.client.SendMessage(ctx, jid, msg)
	if err != nil {
		return "", err
	}
	return resp.ID, nil
}

func (ch *Channel) sendButtons(ctx context.Context, jid types.JID, payload ChatPayload) (string, error) {
	buttons := make([]*waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton, 0, len(payload.Buttons))
	for i, btn := range payload.Buttons {
		text := strings.TrimSpace(btn.Text)
		if text == "" {
			continue
		}
		id := strings.TrimSpace(btn.ID)
		if id == "" {
			id = fmt.Sprintf("btn-%d", i+1)
		}
		name := "quick_reply"
		params := map[string]any{"display_text": text, "id": id}
		switch strings.ToLower(btn.Type) {
		case "url":
			if strings.TrimSpace(btn.URL) == "" {
				continue
			}
			name = "cta_url"
			params = map[string]any{"display_text": text, "url": btn.URL, "merchant_url": btn.URL}
		case "call":
			if strings.TrimSpace(btn.Phone) == "" {
				continue
			}
			name = "cta_call"
			params = map[string]any{"display_text": text, "phone_number": btn.Phone}
		}
		raw, _ := json.Marshal(params)
		buttons = append(buttons, &waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton{
			Name:             proto.String(name),
			ButtonParamsJSON: proto.String(string(raw)),
		})
	}
	if len(buttons) == 0 {
		return "", fmt.Errorf("add at least one button")
	}
	interactive := &waE2E.InteractiveMessage{
		Body: &waE2E.InteractiveMessage_Body{Text: proto.String(payload.Text)},
		InteractiveMessage: &waE2E.InteractiveMessage_NativeFlowMessage_{
			NativeFlowMessage: &waE2E.InteractiveMessage_NativeFlowMessage{
				Buttons: buttons,
			},
		},
	}
	if strings.TrimSpace(payload.Header) != "" {
		interactive.Header = &waE2E.InteractiveMessage_Header{
			Title:              proto.String(payload.Header),
			HasMediaAttachment: proto.Bool(false),
		}
	}
	if strings.TrimSpace(payload.Footer) != "" {
		interactive.Footer = &waE2E.InteractiveMessage_Footer{Text: proto.String(payload.Footer)}
	}
	msg := wrapInteractive(interactive)
	resp, err := ch.client.SendMessage(ctx, jid, msg)
	if err != nil {
		return "", err
	}
	return resp.ID, nil
}

func (ch *Channel) sendList(ctx context.Context, jid types.JID, payload ChatPayload) (string, error) {
	sections := make([]*waE2E.ListMessage_Section, 0, len(payload.Sections))
	for _, section := range payload.Sections {
		rows := make([]*waE2E.ListMessage_Row, 0, len(section.Rows))
		for i, row := range section.Rows {
			title := strings.TrimSpace(row.Title)
			if title == "" {
				continue
			}
			id := strings.TrimSpace(row.ID)
			if id == "" {
				id = fmt.Sprintf("row-%d", i+1)
			}
			item := &waE2E.ListMessage_Row{Title: proto.String(title), RowID: proto.String(id)}
			if strings.TrimSpace(row.Description) != "" {
				item.Description = proto.String(row.Description)
			}
			rows = append(rows, item)
		}
		if len(rows) == 0 {
			continue
		}
		title := strings.TrimSpace(section.Title)
		if title == "" {
			title = "Options"
		}
		sections = append(sections, &waE2E.ListMessage_Section{Title: proto.String(title), Rows: rows})
	}
	if len(sections) == 0 {
		return "", fmt.Errorf("add at least one list option")
	}
	button := strings.TrimSpace(payload.ListButton)
	if button == "" {
		button = "Options"
	}
	list := &waE2E.ListMessage{
		Description: proto.String(payload.Text),
		ButtonText:  proto.String(button),
		ListType:    waE2E.ListMessage_SINGLE_SELECT.Enum(),
		Sections:    sections,
	}
	if strings.TrimSpace(payload.Header) != "" {
		list.Title = proto.String(payload.Header)
	}
	if strings.TrimSpace(payload.Footer) != "" {
		list.FooterText = proto.String(payload.Footer)
	}
	resp, err := ch.client.SendMessage(ctx, jid, &waE2E.Message{ListMessage: list})
	if err != nil {
		return "", err
	}
	return resp.ID, nil
}

func wrapInteractive(interactive *waE2E.InteractiveMessage) *waE2E.Message {
	return &waE2E.Message{
		ViewOnceMessage: &waE2E.FutureProofMessage{
			Message: &waE2E.Message{
				MessageContextInfo: &waE2E.MessageContextInfo{
					DeviceListMetadata:        &waE2E.DeviceListMetadata{},
					DeviceListMetadataVersion: proto.Int32(2),
				},
				InteractiveMessage: interactive,
			},
		},
	}
}

func (ch *Channel) OnWhatsApp(ctx context.Context, phones []string) ([]map[string]any, error) {
	if ch.client == nil || ch.client.Store.ID == nil || !ch.client.IsConnected() {
		return nil, fmt.Errorf("WhatsApp channel is not CONNECTED")
	}
	queries := make([]string, 0, len(phones))
	for _, p := range phones {
		d := digitsOnly(p)
		if d == "" {
			continue
		}
		queries = append(queries, "+"+d)
	}
	found := map[string]bool{}
	const batch = 10
	for i := 0; i < len(queries); i += batch {
		end := i + batch
		if end > len(queries) {
			end = len(queries)
		}
		resp, err := ch.client.IsOnWhatsApp(ctx, queries[i:end])
		if err != nil {
			return nil, err
		}
		for _, row := range resp {
			d := digitsOnly(row.Query)
			if d == "" {
				d = digitsOnly(row.JID.User)
			}
			found[d] = row.IsIn
		}
	}
	out := make([]map[string]any, 0, len(phones))
	for _, p := range phones {
		d := digitsOnly(p)
		exists := false
		if v, ok := found[d]; ok {
			exists = v
		} else {
			for key, v := range found {
				if len(key) >= 10 && len(d) >= 10 && strings.HasSuffix(d, key[len(key)-10:]) {
					exists = v
					break
				}
			}
		}
		out = append(out, map[string]any{"phone": d, "exists": exists})
	}
	return out, nil
}

func (ch *Channel) sendImage(ctx context.Context, jid types.JID, imagePath, caption string) (string, error) {
	data, err := os.ReadFile(imagePath)
	if err != nil {
		return "", err
	}
	if len(data) == 0 || len(data) > 6<<20 {
		return "", fmt.Errorf("invalid image")
	}
	uploaded, err := ch.client.Upload(ctx, data, whatsmeow.MediaImage)
	if err != nil {
		return "", err
	}
	mime := http.DetectContentType(data)
	msg := &waE2E.Message{
		ImageMessage: &waE2E.ImageMessage{
			URL:           proto.String(uploaded.URL),
			DirectPath:    proto.String(uploaded.DirectPath),
			MediaKey:      uploaded.MediaKey,
			Mimetype:      proto.String(mime),
			FileEncSHA256: uploaded.FileEncSHA256,
			FileSHA256:    uploaded.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(data))),
			Caption:       proto.String(caption),
		},
	}
	resp, err := ch.client.SendMessage(ctx, jid, msg)
	if err != nil {
		return "", err
	}
	return resp.ID, nil
}

func (ch *Channel) Avatar(ctx context.Context, phone string) (string, string, error) {
	digits := digitsOnly(phone)
	if digits == "" {
		return "", "", fmt.Errorf("missing phone")
	}
	pn := types.NewJID(digits, types.DefaultUserServer)
	candidates := []types.JID{pn}
	if ch.client.Store != nil && ch.client.Store.LIDs != nil {
		if lid, err := ch.client.Store.LIDs.GetLIDForPN(ctx, pn); err == nil && !lid.IsEmpty() {
			candidates = append([]types.JID{lid}, pn)
		}
	}
	if len(candidates) == 1 {
		if info, err := ch.client.GetUserInfo(ctx, []types.JID{pn}); err == nil {
			for _, ui := range info {
				if !ui.LID.IsEmpty() {
					candidates = append([]types.JID{ui.LID}, pn)
					break
				}
			}
		}
	}
	name := ch.whatsappName(ctx, candidates)
	var last error
	for _, jid := range candidates {
		for _, preview := range []bool{true, false} {
			info, err := ch.client.GetProfilePictureInfo(ctx, jid, &whatsmeow.GetProfilePictureParams{Preview: preview})
			if err != nil {
				last = err
				continue
			}
			if info == nil || info.URL == "" {
				continue
			}
			data, err := fetchDataURL(ctx, info.URL)
			if err != nil {
				last = err
				continue
			}
			return data, name, nil
		}
	}
	if name != "" {
		return "", name, nil
	}
	if last != nil {
		return "", "", last
	}
	return "", "", fmt.Errorf("no profile picture")
}

func (ch *Channel) whatsappName(ctx context.Context, jids []types.JID) string {
	if ch.client.Store == nil || ch.client.Store.Contacts == nil {
		return ""
	}
	for _, jid := range jids {
		info, err := ch.client.Store.Contacts.GetContact(ctx, jid)
		if err != nil {
			continue
		}
		for _, n := range []string{info.BusinessName, info.FullName, info.PushName, info.FirstName} {
			if s := strings.TrimSpace(n); s != "" {
				return s
			}
		}
	}
	return ""
}

func fetchDataURL(ctx context.Context, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return "", fmt.Errorf("picture http %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil || len(body) == 0 {
		return "", fmt.Errorf("empty picture")
	}
	mime := http.DetectContentType(body)
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(body), nil
}

func (ch *Channel) playFile(lc *liveCall, path string) {
	pcm, err := decodeAudioFile(path)
	if err != nil {
		ch.log.Warn("audio file decode failed", "path", path, "err", err)
		return
	}
	frame := 320
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	off := 0
	for off < len(pcm) {
		select {
		case <-lc.stopPlay:
			return
		case <-ticker.C:
			end := off + frame
			if end > len(pcm) {
				end = len(pcm)
			}
			chunk := pcm[off:end]
			if lc.recorder != nil {
				lc.recorder.WritePCM(chunk)
			}
			lc.cm.FeedCapturedPCM(chunk)
			off = end
		}
	}
	ch.publish("playback_done", map[string]any{"callId": lc.apiCallID})
	if lc.hangupAfter {
		_ = lc.cm.EndCall(context.Background(), core.EndCallReasonUserEnded)
	}
}

func mapEndReason(reason core.EndCallReason) string {
	switch reason {
	case core.EndCallReasonBusy:
		return "busy"
	case core.EndCallReasonDeclined:
		return "rejected"
	case core.EndCallReasonTimeout:
		return "no_answer"
	case core.EndCallReasonFailed:
		return "failed"
	case core.EndCallReasonCancelled:
		return "ended"
	default:
		return "ended"
	}
}

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
