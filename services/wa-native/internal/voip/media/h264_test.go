package media

import (
	"bytes"
	"testing"
)

func TestSplitAnnexB(t *testing.T) {
	sps := []byte{0x67, 0x42, 0x00, 0x1e}
	idr := []byte{0x65, 0x88, 0x80, 0x01, 0x02}
	stream := append([]byte{0, 0, 0, 1}, sps...)
	stream = append(stream, 0, 0, 0, 1)
	stream = append(stream, idr...)
	nals := SplitAnnexB(stream)
	if len(nals) != 2 {
		t.Fatalf("nals %d", len(nals))
	}
	if nals[0][0] != 0x67 || nals[1][0] != 0x65 {
		t.Fatalf("nal types %x %x", nals[0][0], nals[1][0])
	}
}

func TestPacketizeH264SingleAndFUA(t *testing.T) {
	small := []byte{0x67, 0x42, 0x00, 0x1e}
	one := PacketizeH264(append([]byte{0, 0, 0, 1}, small...), 1200)
	if len(one) != 1 || one[0][0] != 0x67 {
		t.Fatalf("single %#v", one)
	}
	big := bytes.Repeat([]byte{0x80}, 2000)
	big[0] = 0x65
	parts := PacketizeH264(append([]byte{0, 0, 0, 1}, big...), 200)
	if len(parts) < 3 {
		t.Fatalf("expected FU-A split, got %d", len(parts))
	}
	if parts[0][0]&0x1f != h264NalFuA {
		t.Fatalf("fu indicator %x", parts[0][0])
	}
	if parts[0][1]&0x80 == 0 {
		t.Fatal("first FU must set S")
	}
	if parts[len(parts)-1][1]&0x40 == 0 {
		t.Fatal("last FU must set E")
	}
}
