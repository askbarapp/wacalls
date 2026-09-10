package media

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/binary"
	"fmt"
	"sync"
	"wacalls/internal/voip/core"
)

type SrtpErrorType string

const (
	SrtpErrPacketTooShort SrtpErrorType = "packet_too_short"
	SrtpErrAuthFailed     SrtpErrorType = "auth_failed"
	SrtpErrEncryption     SrtpErrorType = "encryption"
	SrtpErrDecryption     SrtpErrorType = "decryption"
)

type SrtpError struct {
	Type SrtpErrorType
	Msg  string
}

func (e *SrtpError) Error() string { return fmt.Sprintf("srtp %s: %s", e.Type, e.Msg) }

type SrtpContext struct {
	sessionKey  []byte
	sessionSalt []byte
	authKey     []byte
	roc         uint32
	lastSeq     uint16
	initialized bool
	authTagLen  int
}

func NewSrtpContext(keying core.SrtpKeyingMaterial, authTagLen int) (*SrtpContext, error) {
	if authTagLen <= 0 {
		authTagLen = core.SRTPAuthTagLen
	}
	sk, err := deriveSrtpKey(keying.MasterKey, keying.MasterSalt, core.SRTPLabelEncryption, 16)
	if err != nil {
		return nil, err
	}
	ak, err := deriveSrtpKey(keying.MasterKey, keying.MasterSalt, core.SRTPLabelAuth, 20)
	if err != nil {
		return nil, err
	}
	ss, err := deriveSrtpKey(keying.MasterKey, keying.MasterSalt, core.SRTPLabelSalt, 14)
	if err != nil {
		return nil, err
	}
	return &SrtpContext{
		sessionKey:  sk,
		sessionSalt: ss,
		authKey:     ak,
		authTagLen:  authTagLen,
	}, nil
}

func (c *SrtpContext) SetAuthKeying(keying core.SrtpKeyingMaterial) error {
	ak, err := deriveSrtpKey(keying.MasterKey, keying.MasterSalt, core.SRTPLabelAuth, 20)
	if err != nil {
		return err
	}
	c.authKey = ak
	return nil
}

func (c *SrtpContext) Protect(packet *RtpPacket) ([]byte, error) {
	c.updateRoc(packet.Header.SequenceNumber)
	index := c.packetIndex(packet.Header.SequenceNumber)

	headerSize := packet.Header.Size()
	output := make([]byte, headerSize+len(packet.Payload)+c.authTagLen)

	if _, err := packet.Header.Encode(output); err != nil {
		return nil, &SrtpError{SrtpErrEncryption, err.Error()}
	}

	iv := c.generateIV(packet.Header.Ssrc, index)
	if err := aesCtrXor(c.sessionKey, iv, packet.Payload, output[headerSize:headerSize+len(packet.Payload)]); err != nil {
		return nil, &SrtpError{SrtpErrEncryption, err.Error()}
	}

	if c.authTagLen > 0 {
		authData := output[:headerSize+len(packet.Payload)]
		tag := c.computeAuthTag(authData, c.roc, c.authTagLen)
		copy(output[headerSize+len(packet.Payload):], tag)
	}

	return output, nil
}

func (c *SrtpContext) Unprotect(data []byte) (*RtpPacket, error) {
	if len(data) < 12 {
		return nil, &SrtpError{SrtpErrPacketTooShort, fmt.Sprintf("packet too short: %d bytes", len(data))}
	}

	header, err := DecodeRtpHeader(data)
	if err != nil {
		return nil, &SrtpError{SrtpErrDecryption, err.Error()}
	}
	headerSize := header.Size()
	payloadLen := len(data) - headerSize - c.authTagLen
	if payloadLen <= 0 {
		return nil, &SrtpError{SrtpErrPacketTooShort, fmt.Sprintf("no payload: %dB total, %dB header, auth=%d", len(data), headerSize, c.authTagLen)}
	}

	c.updateRoc(header.SequenceNumber)
	index := c.packetIndex(header.SequenceNumber)

	iv := c.generateIV(header.Ssrc, index)
	decrypted := make([]byte, payloadLen)
	if err := aesCtrXor(c.sessionKey, iv, data[headerSize:headerSize+payloadLen], decrypted); err != nil {
		return nil, &SrtpError{SrtpErrDecryption, err.Error()}
	}

	return &RtpPacket{Header: header, Payload: decrypted}, nil
}

func (c *SrtpContext) updateRoc(seq uint16) {
	if !c.initialized {
		c.lastSeq = seq
		c.initialized = true
		return
	}

	diff := int32(seq) - int32(c.lastSeq)
	if diff < -32768 {
		c.roc++
	}
	c.lastSeq = seq
}

func (c *SrtpContext) packetIndex(seq uint16) uint64 {
	return (uint64(c.roc) << 16) | uint64(seq)
}

func (c *SrtpContext) generateIV(ssrc uint32, index uint64) []byte {
	iv := make([]byte, 16)
	copy(iv, c.sessionSalt[:14])

	var ssrcBuf [4]byte
	binary.BigEndian.PutUint32(ssrcBuf[:], ssrc)
	for i := 0; i < 4; i++ {
		iv[4+i] ^= ssrcBuf[i]
	}

	var idxBuf [8]byte
	binary.BigEndian.PutUint64(idxBuf[:], index)
	for i := 0; i < 6; i++ {
		iv[8+i] ^= idxBuf[2+i]
	}

	return iv
}

func (c *SrtpContext) computeAuthTag(data []byte, roc uint32, tagLen int) []byte {
	mac := hmac.New(sha1.New, c.authKey)
	mac.Write(data)
	var rocBuf [4]byte
	binary.BigEndian.PutUint32(rocBuf[:], roc)
	mac.Write(rocBuf[:])
	sum := mac.Sum(nil)
	return sum[:tagLen]
}

type SrtpSession struct {
	mu          sync.Mutex
	sendKey     core.SrtpKeyingMaterial
	recvKey     core.SrtpKeyingMaterial
	sendAuthLen int
	recvAuthLen int
	sendAuth    *core.SrtpKeyingMaterial
	sendCtxs    map[uint32]*SrtpContext
	recvCtxs    map[uint32]*SrtpContext
}

func NewSrtpSession(sendKey, recvKey core.SrtpKeyingMaterial, sendAuthLen, recvAuthLen int) (*SrtpSession, error) {
	if sendAuthLen <= 0 {
		sendAuthLen = core.SRTPAuthTagLen
	}
	if recvAuthLen <= 0 {
		recvAuthLen = core.SRTPAuthTagLen
	}
	return &SrtpSession{
		sendKey:     sendKey,
		recvKey:     recvKey,
		sendAuthLen: sendAuthLen,
		recvAuthLen: recvAuthLen,
		sendCtxs:    map[uint32]*SrtpContext{},
		recvCtxs:    map[uint32]*SrtpContext{},
	}, nil
}

func (s *SrtpSession) sendCtx(ssrc uint32) (*SrtpContext, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx, ok := s.sendCtxs[ssrc]; ok {
		return ctx, nil
	}
	ctx, err := NewSrtpContext(s.sendKey, s.sendAuthLen)
	if err != nil {
		return nil, err
	}
	if s.sendAuth != nil {
		if err := ctx.SetAuthKeying(*s.sendAuth); err != nil {
			return nil, err
		}
	}
	s.sendCtxs[ssrc] = ctx
	return ctx, nil
}

func (s *SrtpSession) recvCtx(ssrc uint32) (*SrtpContext, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx, ok := s.recvCtxs[ssrc]; ok {
		return ctx, nil
	}
	ctx, err := NewSrtpContext(s.recvKey, s.recvAuthLen)
	if err != nil {
		return nil, err
	}
	s.recvCtxs[ssrc] = ctx
	return ctx, nil
}

func (s *SrtpSession) Protect(packet *RtpPacket) ([]byte, error) {
	if packet == nil || packet.Header == nil {
		return nil, &SrtpError{SrtpErrEncryption, "nil packet"}
	}
	ctx, err := s.sendCtx(packet.Header.Ssrc)
	if err != nil {
		return nil, err
	}
	return ctx.Protect(packet)
}

func (s *SrtpSession) Unprotect(data []byte) (*RtpPacket, error) {
	if len(data) < 12 {
		return nil, &SrtpError{SrtpErrPacketTooShort, fmt.Sprintf("packet too short: %d bytes", len(data))}
	}
	ssrc := uint32(data[8])<<24 | uint32(data[9])<<16 | uint32(data[10])<<8 | uint32(data[11])
	ctx, err := s.recvCtx(ssrc)
	if err != nil {
		return nil, err
	}
	return ctx.Unprotect(data)
}

func (s *SrtpSession) SetSendAuthKeying(keying core.SrtpKeyingMaterial) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := keying
	s.sendAuth = &cp
	for _, ctx := range s.sendCtxs {
		if err := ctx.SetAuthKeying(keying); err != nil {
			return err
		}
	}
	return nil
}

func deriveSrtpKey(masterKey, masterSalt []byte, label byte, length int) ([]byte, error) {
	iv := make([]byte, 16)
	copy(iv, masterSalt[:14])
	iv[7] ^= label

	out := make([]byte, length)
	if err := aesCtrXor(masterKey, iv, make([]byte, length), out); err != nil {
		return nil, err
	}
	return out, nil
}

func aesCtrXor(key, iv, src, dst []byte) error {
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	cipher.NewCTR(block, iv).XORKeyStream(dst, src)
	return nil
}
