package main

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
)

func ensureNativeTables(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS wa_native_sessions (
  channel_id TEXT PRIMARY KEY,
  jid TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`)
	return err
}

func (h *Hub) saveJID(ctx context.Context, channelID, jid string) {
	_, _ = h.db.ExecContext(ctx, `
INSERT INTO wa_native_sessions (channel_id, jid, updated_at)
VALUES ($1, $2, NOW())
ON CONFLICT (channel_id) DO UPDATE SET jid = EXCLUDED.jid, updated_at = NOW()`, channelID, jid)
}

func (h *Hub) loadSessions(ctx context.Context) ([]struct{ ChannelID, JID string }, error) {
	rows, err := h.db.QueryContext(ctx, `SELECT channel_id, COALESCE(jid, '') FROM wa_native_sessions`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct{ ChannelID, JID string }
	for rows.Next() {
		var row struct{ ChannelID, JID string }
		if err := rows.Scan(&row.ChannelID, &row.JID); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (h *Hub) channelOrg(ctx context.Context, channelID string) (string, error) {
	var org string
	err := h.db.QueryRowContext(ctx, `SELECT organization_id FROM whatsapp_channels WHERE id = $1`, channelID).Scan(&org)
	return org, err
}

func (h *Hub) updateChannel(ctx context.Context, channelID, status, phone, name, lastErr string) {
	_, _ = h.db.ExecContext(ctx, `
UPDATE whatsapp_channels
SET status = $2::"ChannelStatus",
    session_status = $2,
    phone_number = COALESCE(NULLIF($3, ''), phone_number),
    display_name = COALESCE(NULLIF($4, ''), display_name),
    last_error = NULLIF($5, ''),
    last_seen_at = NOW(),
    last_connected_at = CASE WHEN $2 = 'CONNECTED' THEN NOW() ELSE last_connected_at END,
    updated_at = NOW()
WHERE id = $1`, channelID, status, phone, name, lastErr)
}

func (h *Hub) updateCall(ctx context.Context, callID, status, reason string, durationMs int) {
	if callID == "" {
		return
	}
	switch status {
	case "CONNECTING":
		_, _ = h.db.ExecContext(ctx, `UPDATE calls SET status = 'CONNECTING', started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = $1`, callID)
	case "RINGING":
		_, _ = h.db.ExecContext(ctx, `UPDATE calls SET status = 'RINGING', updated_at = NOW() WHERE id = $1`, callID)
	case "ANSWERED":
		_, _ = h.db.ExecContext(ctx, `UPDATE calls SET status = 'ANSWERED', answered_at = COALESCE(answered_at, NOW()), updated_at = NOW() WHERE id = $1`, callID)
	case "ENDED", "FAILED", "BUSY", "NO_ANSWER", "REJECTED", "CANCELLED":
		_, _ = h.db.ExecContext(ctx, `
UPDATE calls SET status = $2::"CallStatus", ended_at = NOW(), duration_ms = $3, failure_reason = NULLIF($4, ''), updated_at = NOW()
WHERE id = $1 AND status NOT IN ('ENDED','FAILED','BUSY','NO_ANSWER','REJECTED','CANCELLED')`, callID, status, durationMs, reason)
	}
}

func (h *Hub) setEngineCallID(ctx context.Context, callID, engineID string) {
	_, _ = h.db.ExecContext(ctx, `UPDATE calls SET engine_call_id = $2, updated_at = NOW() WHERE id = $1`, callID, engineID)
}

func (h *Hub) setRecording(ctx context.Context, callID, path string) {
	_, _ = h.db.ExecContext(ctx, `UPDATE calls SET recording_path = $2, updated_at = NOW() WHERE id = $1`, callID, path)
}

func (h *Hub) expireStaleCalls(ctx context.Context) {
	_, _ = h.db.ExecContext(ctx, `
UPDATE calls
SET status = 'ENDED', ended_at = NOW(), failure_reason = 'stale call auto-expired', updated_at = NOW()
WHERE status IN ('QUEUED','CONNECTING','RINGING','ANSWERED')
  AND COALESCE(started_at, queued_at, created_at) < NOW() - INTERVAL '45 minutes'`)
}

type incomingConfig struct {
	Enabled     bool
	AiConfigID  string
	SendMessage bool
	MessageBody string
	MessageWhen string
}

func (h *Hub) loadIncomingConfig(ctx context.Context, channelID string) (*incomingConfig, error) {
	row := incomingConfig{MessageWhen: "answered"}
	err := h.db.QueryRowContext(ctx, `
SELECT enabled, COALESCE(ai_config_id, ''), send_message, COALESCE(message_body, ''), COALESCE(message_when, 'answered')
FROM incoming_answer_configs
WHERE channel_id = $1`, channelID).Scan(&row.Enabled, &row.AiConfigID, &row.SendMessage, &row.MessageBody, &row.MessageWhen)
	if err == sql.ErrNoRows {
		return &incomingConfig{}, nil
	}
	if err != nil {
		return nil, err
	}
	if row.MessageWhen == "" {
		row.MessageWhen = "answered"
	}
	return &row, nil
}

func (h *Hub) acquireChannelLock(channelID, callID string) bool {
	ok, err := h.rdb.SetNX(context.Background(), "lock:whatsapp-channel:"+channelID, callID, 120*time.Second).Result()
	return err == nil && ok
}

func (h *Hub) failCall(ctx context.Context, callID, reason string) {
	if callID == "" {
		return
	}
	_, _ = h.db.ExecContext(ctx, `
UPDATE calls SET status = 'FAILED', failure_reason = $2, ended_at = NOW(), updated_at = NOW()
WHERE id = $1 AND status NOT IN ('ENDED','FAILED','BUSY','NO_ANSWER','REJECTED','CANCELLED')`, callID, reason)
}

func (h *Hub) createInboundCall(ctx context.Context, orgID, channelID, phone, engineID string) (callID, contactName string, err error) {
	phone = e164Phone(phone)
	if phone == "" {
		return "", "", fmt.Errorf("missing caller phone")
	}
	contactID := uuid.NewString()
	contactName = "Incoming"
	err = h.db.QueryRowContext(ctx, `
INSERT INTO contacts (id, organization_id, name, phone, custom_fields, tags, status, created_at, updated_at)
VALUES ($1, $2, $3, $4, '{}'::jsonb, '{}'::text[], 'active', NOW(), NOW())
ON CONFLICT (organization_id, phone) DO UPDATE SET updated_at = NOW()
RETURNING id, name`, contactID, orgID, "Incoming "+last4(phone), phone).Scan(&contactID, &contactName)
	if err != nil {
		return "", "", err
	}
	callID = uuid.NewString()
	_, err = h.db.ExecContext(ctx, `
INSERT INTO calls (
  id, organization_id, channel_id, contact_id, phone, contact_name, status, source,
  engine_call_id, queued_at, started_at, created_at, updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, 'RINGING', 'inbound',
  $7, NOW(), NOW(), NOW(), NOW()
)`, callID, orgID, channelID, contactID, phone, contactName, engineID)
	if err != nil {
		return "", "", err
	}
	return callID, contactName, nil
}

func e164Phone(raw string) string {
	digits := make([]rune, 0, len(raw))
	for _, r := range raw {
		if r >= '0' && r <= '9' {
			digits = append(digits, r)
		}
	}
	if len(digits) == 0 {
		return ""
	}
	return "+" + string(digits)
}

func last4(phone string) string {
	d := phone
	if len(d) > 4 {
		return d[len(d)-4:]
	}
	return d
}
