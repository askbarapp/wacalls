package media

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"testing"

	"wacalls/internal/voip/core"
)

func refHKDF(ikm, salt []byte, info string, length int) []byte {
	if salt == nil {
		salt = make([]byte, sha256.Size)
	}

	ext := hmac.New(sha256.New, salt)
	ext.Write(ikm)
	prk := ext.Sum(nil)

	var okm, t []byte
	for i := 1; len(okm) < length; i++ {
		h := hmac.New(sha256.New, prk)
		h.Write(t)
		h.Write([]byte(info))
		h.Write([]byte{byte(i)})
		t = h.Sum(nil)
		okm = append(okm, t...)
	}
	return okm[:length]
}

func TestGenerateSecureSsrc(t *testing.T) {
	const callID = "ABCDEF0123456789ABCDEF0123456789"
	const jid = "5511999999999:3@lid"

	a := GenerateSecureSsrc(callID, jid, 0)
	b := GenerateSecureSsrc(callID, jid, 0)
	if a != b {
		t.Fatalf("ssrc not deterministic: %d != %d", a, b)
	}
	if GenerateSecureSsrc(callID, jid, 1) == a {
		t.Fatal("counter should change the ssrc")
	}
	if GenerateSecureSsrc(callID, "other@lid", 0) == a {
		t.Fatal("different jid should change the ssrc")
	}

	salt := make([]byte, 4)
	binary.LittleEndian.PutUint32(salt, 0)
	want := binary.LittleEndian.Uint32(refHKDF([]byte(callID), salt, jid, 4))
	if a != want {
		t.Fatalf("ssrc mismatch with reference HKDF: got %d want %d", a, want)
	}
}

func TestDerivePerJidSrtpKey(t *testing.T) {
	callKey := bytes.Repeat([]byte{0xAB}, 32)
	const jid = "5511999999999:0@lid"

	km, err := DerivePerJidSrtpKey(callKey, jid)
	if err != nil {
		t.Fatal(err)
	}
	if len(km.MasterKey) != 16 || len(km.MasterSalt) != 14 {
		t.Fatalf("bad lengths: key=%d salt=%d", len(km.MasterKey), len(km.MasterSalt))
	}

	ref := refHKDF(callKey, nil, jid, 46)
	if !bytes.Equal(km.MasterKey, ref[0:16]) {
		t.Error("master key mismatch with reference HKDF")
	}
	if !bytes.Equal(km.MasterSalt, ref[16:30]) {
		t.Error("master salt mismatch with reference HKDF")
	}
}

func TestRtpHeaderRoundtrip(t *testing.T) {
	h := NewRtpHeader(core.PayloadTypeWhatsAppOpus, 0x1234, 0xDEADBEEF, 0xCAFEBABE)
	h.Marker = true
	h.Extension = true
	h.ExtensionProfile = 0xBEDE
	h.ExtensionData = []byte{}

	buf := make([]byte, h.Size())
	if _, err := h.Encode(buf); err != nil {
		t.Fatal(err)
	}
	got, err := DecodeRtpHeader(buf)
	if err != nil {
		t.Fatal(err)
	}
	if got.PayloadType != h.PayloadType || got.SequenceNumber != h.SequenceNumber ||
		got.Timestamp != h.Timestamp || got.Ssrc != h.Ssrc || got.Marker != h.Marker ||
		!got.Extension || got.ExtensionProfile != 0xBEDE {
		t.Fatalf("header mismatch: %+v vs %+v", got, h)
	}
}

func TestRtpPacketRoundtrip(t *testing.T) {
	sess := NewWhatsAppOpusSession(0x11223344)
	payload := []byte{1, 2, 3, 4, 5, 6, 7, 8}
	pkt := sess.CreatePacketWithDuration(payload, 960, true)
	enc, err := pkt.Encode()
	if err != nil {
		t.Fatal(err)
	}
	dec, err := DecodeRtpPacket(enc)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(dec.Payload, payload) {
		t.Fatalf("payload mismatch: %v", dec.Payload)
	}

	pkt2 := sess.CreatePacketWithDuration(payload, 960, false)
	if pkt2.Header.SequenceNumber != pkt.Header.SequenceNumber+1 {
		t.Fatal("sequence number did not advance")
	}
	if pkt2.Header.Timestamp != pkt.Header.Timestamp+960 {
		t.Fatal("timestamp did not advance by duration")
	}
}

func TestSrtpRoundtrip(t *testing.T) {
	callKey := bytes.Repeat([]byte{0x11}, 32)
	sendKM, _ := DerivePerJidSrtpKey(callKey, "self:0@lid")
	recvKM, _ := DerivePerJidSrtpKey(callKey, "peer:0@lid")

	sender, err := NewSrtpSession(sendKM, recvKM, core.SRTPSendAuthTagLen, core.SRTPRecvAuthTagLen)
	if err != nil {
		t.Fatal(err)
	}
	receiver, err := NewSrtpSession(recvKM, sendKM, core.SRTPRecvAuthTagLen, core.SRTPSendAuthTagLen)
	if err != nil {
		t.Fatal(err)
	}

	sess := NewWhatsAppOpusSession(0xAABBCCDD)
	payload := bytes.Repeat([]byte{0x42}, 40)
	pkt := sess.CreatePacketWithDuration(payload, 960, true)

	protected, err := sender.Protect(pkt)
	if err != nil {
		t.Fatal(err)
	}
	if len(protected) != pkt.Header.Size()+len(payload)+core.SRTPSendAuthTagLen {
		t.Fatalf("unexpected protected length: %d", len(protected))
	}

	got, err := receiver.Unprotect(protected)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got.Payload, payload) {
		t.Fatalf("srtp roundtrip payload mismatch: %v", got.Payload)
	}
}

func TestSrtpIndependentSsrcs(t *testing.T) {
	callKey := bytes.Repeat([]byte{0x11}, 32)
	sendKM, _ := DerivePerJidSrtpKey(callKey, "self:0@lid")
	recvKM, _ := DerivePerJidSrtpKey(callKey, "peer:0@lid")
	sender, err := NewSrtpSession(sendKM, recvKM, core.SRTPSendAuthTagLen, core.SRTPRecvAuthTagLen)
	if err != nil {
		t.Fatal(err)
	}
	receiver, err := NewSrtpSession(recvKM, sendKM, core.SRTPRecvAuthTagLen, core.SRTPSendAuthTagLen)
	if err != nil {
		t.Fatal(err)
	}
	audio := NewWhatsAppOpusSession(0x11111111)
	video := NewWhatsAppVp8Session(0x22222222)
	aPayload := bytes.Repeat([]byte{0x41}, 20)
	vPayload := bytes.Repeat([]byte{0x56}, 40)
	for i := 0; i < 8; i++ {
		ap := audio.CreatePacketWithDuration(aPayload, 960, i == 0)
		protected, err := sender.Protect(ap)
		if err != nil {
			t.Fatal(err)
		}
		got, err := receiver.Unprotect(protected)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got.Payload, aPayload) {
			t.Fatal("audio payload mismatch")
		}
		vp := video.CreatePacketWithDuration(vPayload, 6000, true)
		protected, err = sender.Protect(vp)
		if err != nil {
			t.Fatal(err)
		}
		got, err = receiver.Unprotect(protected)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got.Payload, vPayload) {
			t.Fatal("video payload mismatch")
		}
	}
}

func TestDeriveSrtpKeyReference(t *testing.T) {
	masterKey := bytes.Repeat([]byte{0x01}, 16)
	masterSalt := bytes.Repeat([]byte{0x02}, 14)

	got, err := deriveSrtpKey(masterKey, masterSalt, core.SRTPLabelEncryption, 16)
	if err != nil {
		t.Fatal(err)
	}

	iv := make([]byte, 16)
	copy(iv, masterSalt)
	iv[7] ^= core.SRTPLabelEncryption
	block, _ := aes.NewCipher(masterKey)
	want := make([]byte, 16)
	cipher.NewCTR(block, iv).XORKeyStream(want, make([]byte, 16))

	if !bytes.Equal(got, want) {
		t.Fatalf("deriveSrtpKey mismatch:\n got=%x\nwant=%x", got, want)
	}
}

func TestApplyWarpSpeechHeaderIs16Bytes(t *testing.T) {
	s := NewWhatsAppH264Session(0x11111111)
	pkt := s.CreatePacketWithDuration([]byte{0x67, 0x42}, 0, false)
	ApplyWarpSpeechHeader(pkt)
	if pkt.Header.Size() != 16 {
		t.Fatalf("header size %d want 16", pkt.Header.Size())
	}
	buf := make([]byte, pkt.Header.Size())
	n, err := pkt.Header.Encode(buf)
	if err != nil || n != 16 {
		t.Fatal(err)
	}
	if buf[0] != 0x90 {
		t.Fatalf("first byte %x want 0x90", buf[0])
	}
	if binary.BigEndian.Uint16(buf[12:14]) != 0xdebe {
		t.Fatalf("ext profile %x", buf[12:14])
	}
}

func TestApplyWhatsAppVideoHeaderIs24Bytes(t *testing.T) {
	s := NewWhatsAppH264Session(0x22222222)

	// Test first packet of a keyframe: 16 bytes extension = 4 words → header = 12 + 4 + 16 = 32
	pkt := s.CreatePacketWithDuration([]byte{0x67, 0x42}, 0, false)
	ApplyWhatsAppVideoHeader(pkt, 42, true, true) // keyframe, first packet
	if pkt.Header.Size() != 32 {
		t.Fatalf("keyframe first header size %d want 32", pkt.Header.Size())
	}
	buf := make([]byte, pkt.Header.Size())
	n, err := pkt.Header.Encode(buf)
	if err != nil || n != 32 {
		t.Fatal(err)
	}
	if buf[0] != 0x90 {
		t.Fatalf("first byte %x want 0x90", buf[0])
	}
	if binary.BigEndian.Uint16(buf[12:14]) != 0xdebe {
		t.Fatalf("ext profile %x", buf[12:14])
	}
	if binary.BigEndian.Uint16(buf[14:16]) != 4 {
		t.Fatalf("ext words %d want 4", binary.BigEndian.Uint16(buf[14:16]))
	}
	// Check CVO extension ID 3 and frame number
	if buf[16] != 0x32 || buf[17] != 0x09 || buf[19] != 42 {
		t.Fatalf("ext data header mismatch %x", buf[16:32])
	}
	// Check extension ID 5 present
	if buf[20] != 0x51 {
		t.Fatalf("ext ID 5 missing, got %x", buf[20])
	}

	// Test continuation packet: 12 bytes extension = 3 words → header = 12 + 4 + 12 = 28
	pkt2 := s.CreatePacketWithDuration([]byte{0x67, 0x42}, 0, true)
	ApplyWhatsAppVideoHeader(pkt2, 42, true, false) // keyframe, continuation
	if pkt2.Header.Size() != 28 {
		t.Fatalf("continuation header size %d want 28", pkt2.Header.Size())
	}
}
