package signaling

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"wacalls/internal/voip/core"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

var encryptedCallTags = map[string]bool{"preaccept": true, "accept": true}

func NeedsDecryption(tag string) bool { return encryptedCallTags[tag] }

func GenerateCallID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return strings.ToUpper(hex.EncodeToString(b))
}

func GenerateCallStanzaID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return strings.ToUpper(hex.EncodeToString(b))
}

func padRandomMax16(msg []byte) []byte {
	var r [1]byte
	rand.Read(r[:])
	padLen := int(r[0]&0x0f) + 1
	out := make([]byte, len(msg)+padLen)
	copy(out, msg)
	for i := len(msg); i < len(out); i++ {
		out[i] = byte(padLen)
	}
	return out
}

func unpadRandomMax16(b []byte) ([]byte, error) {
	if len(b) == 0 {
		return nil, fmt.Errorf("unpad given empty bytes")
	}
	pad := int(b[len(b)-1])
	if pad > len(b) {
		return nil, fmt.Errorf("unpad given %d bytes, but pad is %d", len(b), pad)
	}
	return b[:len(b)-pad], nil
}

func EncodeCallKeyMessage(callKey []byte) ([]byte, error) {
	msg := &waE2E.Message{Call: &waE2E.Call{CallKey: callKey}}
	return proto.Marshal(msg)
}

func DecryptCallKeyInNode(ctx context.Context, sock core.VoipSocket, inner *waBinary.Node, peerJid types.JID) ([]byte, error) {
	candidates := FindEncNodes(inner)
	if len(candidates) == 0 {
		return nil, nil
	}
	ownLid := sock.OwnLID()
	ownPn := sock.OwnPN()
	ownLidStr := ownLid.String()
	ownPnStr := ownPn.String()

	var prioritized []EncNodeCandidate
	var others []EncNodeCandidate
	for _, c := range candidates {
		isOwn := false
		if c.ToJID != "" {
			if c.ToJID == ownLidStr || c.ToJID == ownPnStr {
				isOwn = true
			} else if !ownLid.IsEmpty() && strings.HasPrefix(c.ToJID, ownLid.User) {
				isOwn = true
			} else if !ownPn.IsEmpty() && strings.HasPrefix(c.ToJID, ownPn.User) {
				isOwn = true
			}
		}
		if isOwn {
			prioritized = append(prioritized, c)
		} else {
			others = append(others, c)
		}
	}
	ordered := append(prioritized, others...)

	var lastErr error
	for _, c := range ordered {
		key, err := sock.DecryptCallKey(ctx, peerJid, c.EncNode)
		if err == nil && len(key) == 32 {
			return key, nil
		}
		if err != nil {
			lastErr = err
		}
	}
	return nil, lastErr
}

func DecodeCallKeyPlaintext(plaintext []byte) ([]byte, error) {
	var msg waE2E.Message
	if err := proto.Unmarshal(plaintext, &msg); err != nil {
		return nil, err
	}
	key := msg.GetCall().GetCallKey()
	if len(key) != 32 {
		return nil, fmt.Errorf("invalid callKey: expected 32 bytes, got %d", len(key))
	}
	return key, nil
}
