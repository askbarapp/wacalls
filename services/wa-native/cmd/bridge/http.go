package main

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"time"
)

func (h *Hub) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.handleHealth)
	mux.HandleFunc("GET /internal/capabilities", h.auth(h.handleCapabilities))
	mux.HandleFunc("POST /internal/channels/{id}/connect", h.auth(h.handleConnect))
	mux.HandleFunc("POST /internal/channels/{id}/pair", h.auth(h.handlePair))
	mux.HandleFunc("POST /internal/channels/{id}/disconnect", h.auth(h.handleDisconnect))
	mux.HandleFunc("GET /internal/channels/{id}/qr", h.auth(h.handleQR))
	mux.HandleFunc("GET /internal/channels/{id}/status", h.auth(h.handleStatus))
	mux.HandleFunc("GET /internal/channels/{id}/avatar", h.auth(h.handleAvatar))
	mux.HandleFunc("POST /internal/channels/{id}/on-whatsapp", h.auth(h.handleOnWhatsApp))
	mux.HandleFunc("POST /internal/messages", h.auth(h.handleMessage))
	mux.HandleFunc("POST /internal/calls", h.auth(h.handleCall))
	mux.HandleFunc("POST /internal/calls/{id}/hangup", h.auth(h.handleHangup))
	mux.HandleFunc("POST /internal/calls/{id}/mute", h.auth(h.handleMute))
	mux.HandleFunc("POST /internal/calls/{id}/pcm", h.auth(h.handlePCM))
	return mux
}

func (h *Hub) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.token != "" && r.Header.Get("x-internal-token") != h.token {
			writeErr(w, 401, "unauthorized")
			return
		}
		next(w, r)
	}
}

func (h *Hub) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":       "ok",
		"engine":       "native",
		"capabilities": capabilities(),
	})
}

func (h *Hub) handleCapabilities(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"name": "native", "capabilities": capabilities()})
}

func capabilities() map[string]any {
	return map[string]any{
		"qrConnect":        true,
		"pairingCode":      true,
		"outboundVoice":    true,
		"inboundVoice":     true,
		"callEvents":       true,
		"audioInject":      true,
		"audioCapture":     true,
		"recordedPlayback": true,
		"realtimeAi":       false,
		"experimental":     true,
		"sendText":         true,
	}
}

func (h *Hub) handleConnect(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		ForceQr bool `json:"forceQr"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := h.Connect(r.Context(), id, body.ForceQr); err != nil {
		writeErr(w, 409, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Hub) handlePair(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Phone string `json:"phone"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	code, err := h.PairWithCode(r.Context(), id, body.Phone)
	if err != nil {
		writeErr(w, 409, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "code": code})
}

func (h *Hub) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ch := h.getChannel(id)
	if ch != nil {
		ch.logout(r.Context())
		ch.setStatus("DISCONNECTED", "")
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Hub) handleQR(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ch := h.getChannel(id)
	status, qr, code, pairCode, lastErr := "DISCONNECTED", "", "", "", ""
	if ch != nil {
		ch.mu.Lock()
		status, qr, code, pairCode, lastErr = ch.status, ch.qr, ch.qrCode, ch.pairCode, ch.lastError
		ch.mu.Unlock()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"qr": qr, "code": code, "pairingCode": pairCode, "status": status, "lastError": lastErr, "engine": "native",
	})
}

func (h *Hub) handleStatus(w http.ResponseWriter, r *http.Request) {
	status := "DISCONNECTED"
	if ch := h.getChannel(r.PathValue("id")); ch != nil {
		ch.mu.Lock()
		status = ch.status
		ch.mu.Unlock()
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": status})
}

func (h *Hub) handleAvatar(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	phone := r.URL.Query().Get("phone")
	digits := digitsOnly(phone)
	ctx := r.Context()
	cacheKey := "wacalls:avatar:" + id + ":" + digits
	if digits != "" {
		if raw, err := h.rdb.Get(ctx, cacheKey).Result(); err == nil && raw != "" {
			var payload map[string]any
			if json.Unmarshal([]byte(raw), &payload) == nil {
				writeJSON(w, http.StatusOK, payload)
				return
			}
		}
	}
	ch := h.getChannel(id)
	if ch == nil {
		writeJSON(w, http.StatusOK, map[string]any{"avatar": nil, "name": ""})
		return
	}
	avatar, name, err := ch.Avatar(ctx, phone)
	if err != nil && avatar == "" && name == "" {
		h.log.Info("avatar lookup empty", "channel", id, "err", err)
	}
	payload := map[string]any{"avatar": nil, "name": name}
	if avatar != "" {
		payload["avatar"] = avatar
	}
	if digits != "" {
		ttl := 30 * time.Minute
		if avatar == "" {
			ttl = 2 * time.Minute
		}
		if b, err := json.Marshal(payload); err == nil {
			_ = h.rdb.Set(ctx, cacheKey, b, ttl).Err()
		}
	}
	writeJSON(w, http.StatusOK, payload)
}

func (h *Hub) handleOnWhatsApp(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Phones []string `json:"phones"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}
	if len(body.Phones) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"results": []any{}})
		return
	}
	if len(body.Phones) > 200 {
		writeErr(w, 400, "too many numbers (max 200)")
		return
	}
	ch := h.getChannel(id)
	if ch == nil {
		writeErr(w, 409, "WhatsApp channel is not CONNECTED")
		return
	}
	results, err := ch.OnWhatsApp(r.Context(), body.Phones)
	if err != nil {
		writeErr(w, 409, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (h *Hub) handleMessage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ChannelID  string        `json:"channelId"`
		Phone      string        `json:"phone"`
		Text       string        `json:"text"`
		Kind       string        `json:"kind"`
		Header     string        `json:"header"`
		Footer     string        `json:"footer"`
		ImagePath  string        `json:"imagePath"`
		Buttons    []ChatButton  `json:"buttons"`
		ListButton string        `json:"listButton"`
		Sections   []ChatSection `json:"sections"`
		TypingMs   int           `json:"typingMs"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}
	ch := h.getChannel(body.ChannelID)
	if ch == nil {
		writeErr(w, 409, "WhatsApp channel is not CONNECTED")
		return
	}
	typing := time.Duration(0)
	if body.TypingMs > 0 {
		typing = time.Duration(body.TypingMs) * time.Millisecond
		if typing > 15*time.Second {
			typing = 15 * time.Second
		}
	}
	id, err := ch.SendChat(r.Context(), body.Phone, ChatPayload{
		Kind:       body.Kind,
		Text:       body.Text,
		Header:     body.Header,
		Footer:     body.Footer,
		ImagePath:  body.ImagePath,
		Buttons:    body.Buttons,
		ListButton: body.ListButton,
		Sections:   body.Sections,
	}, typing)
	if err != nil {
		writeErr(w, 409, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "id": id})
}

func (h *Hub) handleCall(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CallID              string `json:"callId"`
		ChannelID           string `json:"channelId"`
		OrganizationID      string `json:"organizationId"`
		Phone               string `json:"phone"`
		AudioFilePath       string `json:"audioFilePath"`
		HangupAfterPlayback bool   `json:"hangupAfterPlayback"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid body")
		return
	}
	ch := h.getChannel(body.ChannelID)
	if ch == nil {
		writeErr(w, 409, "WhatsApp channel is not CONNECTED")
		return
	}
	if body.OrganizationID != "" {
		ch.orgID = body.OrganizationID
	}
	h.updateCall(r.Context(), body.CallID, "CONNECTING", "", 0)
	engineID, err := ch.StartCall(r.Context(), body.CallID, body.Phone, body.AudioFilePath, body.HangupAfterPlayback)
	if err != nil {
		h.updateCall(r.Context(), body.CallID, "FAILED", err.Error(), 0)
		writeErr(w, 409, err.Error())
		return
	}
	h.setEngineCallID(r.Context(), body.CallID, engineID)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"session": map[string]any{"callId": body.CallID, "engineCallId": engineID},
	})
}

func (h *Hub) eachChannel() []*Channel {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]*Channel, 0, len(h.channels))
	for _, ch := range h.channels {
		out = append(out, ch)
	}
	return out
}

func (h *Hub) handleHangup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	for _, ch := range h.eachChannel() {
		if ch.lookupCall(id) != nil {
			ch.Hangup(id)
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Hub) handleMute(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Muted bool `json:"muted"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	for _, ch := range h.eachChannel() {
		if ch.lookupCall(id) != nil {
			ch.Mute(id, body.Muted)
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Hub) handlePCM(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	raw, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil || len(raw) < 4 {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	n := len(raw) / 4
	pcm := make([]float32, n)
	for i := 0; i < n; i++ {
		pcm[i] = math.Float32frombits(binary.LittleEndian.Uint32(raw[i*4:]))
	}
	for _, ch := range h.eachChannel() {
		if ch.lookupCall(id) != nil {
			ch.FeedPCM(id, pcm)
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"message": message}, "success": false})
}
