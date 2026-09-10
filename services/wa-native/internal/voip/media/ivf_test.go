package media

import (
	"bytes"
	"encoding/binary"
	"io"
	"testing"
)

func TestIvfRoundtripHeaderAndFrame(t *testing.T) {
	var buf bytes.Buffer
	hdr := make([]byte, 32)
	copy(hdr[0:4], "DKIF")
	copy(hdr[8:12], "VP80")
	binary.LittleEndian.PutUint16(hdr[12:14], 480)
	binary.LittleEndian.PutUint16(hdr[14:16], 640)
	binary.LittleEndian.PutUint32(hdr[16:20], 15)
	binary.LittleEndian.PutUint32(hdr[20:24], 1)
	binary.LittleEndian.PutUint32(hdr[24:28], 1)
	frame := []byte{0x90, 0x00, 0x01, 0x02}
	var body bytes.Buffer
	_ = binary.Write(&body, binary.LittleEndian, uint32(len(frame)))
	_ = binary.Write(&body, binary.LittleEndian, uint64(0))
	body.Write(frame)
	buf.Write(hdr)
	buf.Write(body.Bytes())

	got, err := ReadIvfHeader(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if got.Width != 480 || got.Height != 640 {
		t.Fatalf("size %dx%d", got.Width, got.Height)
	}
	if got.FrameTimestampInc() != 6000 {
		t.Fatalf("ts inc %d", got.FrameTimestampInc())
	}
	payload, _, err := ReadIvfFrame(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(payload, frame) {
		t.Fatalf("payload %v", payload)
	}
	_, _, err = ReadIvfFrame(&buf)
	if err != io.EOF && err != io.ErrUnexpectedEOF {
		t.Fatalf("want eof, got %v", err)
	}
}

func TestPacketizeVp8SingleAndSplit(t *testing.T) {
	one := PacketizeVp8([]byte{1, 2, 3, 4}, 1200, 7)
	if len(one) != 1 {
		t.Fatalf("single packet %#v", one)
	}
	if one[0][0]&0x80 == 0 {
		t.Fatal("X bit must be set")
	}
	if one[0][0]&0x10 == 0 {
		t.Fatal("first packet must have S bit")
	}
	if one[0][1] != 0x80 {
		t.Fatal("I bit must be set")
	}
	if one[0][2]&0x80 == 0 {
		t.Fatal("15-bit PictureID M bit must be set")
	}
	pid := uint16(one[0][2]&0x7f)<<8 | uint16(one[0][3])
	if pid != 7 {
		t.Fatalf("picture id %d", pid)
	}
	if !bytes.Equal(one[0][4:], []byte{1, 2, 3, 4}) {
		t.Fatalf("payload %v", one[0][4:])
	}
	big := bytes.Repeat([]byte{9}, 2000)
	parts := PacketizeVp8(big, 1200, 9)
	if len(parts) < 2 {
		t.Fatalf("expected split, got %d", len(parts))
	}
	if parts[0][0]&0x10 == 0 {
		t.Fatal("first packet must have S bit")
	}
	if parts[1][0]&0x10 != 0 {
		t.Fatal("continuation must clear S bit")
	}
	if parts[0][3] != parts[1][3] {
		t.Fatal("picture id must match across fragments")
	}
}
