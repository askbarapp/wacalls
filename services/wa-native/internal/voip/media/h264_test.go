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

func TestPacketizeH264KeyframeWhatsAppWARP(t *testing.T) {
	sps := []byte{0x67, 0x42, 0x00, 0x1e, 0x01}
	pps := []byte{0x68, 0xce, 0x38, 0x80}
	sei := []byte{0x06, 0x05, 0x04, 0x03}
	idr := bytes.Repeat([]byte{0x80}, 2500)
	idr[0] = 0x65 // IDR slice

	var au []byte
	for _, n := range [][]byte{sei, sps, pps, idr} {
		au = append(au, 0, 0, 0, 1)
		au = append(au, n...)
	}
	pkts := PacketizeH264(au, 1200)

	// First packet must be FU-A start with indicator 0x7c and header 0x87 (Type 7 SPS)
	if pkts[0][0] != 0x7c || pkts[0][1] != 0x87 {
		t.Fatalf("first packet header got %x %x want 7c 87", pkts[0][0], pkts[0][1])
	}
	// First packet must contain SPS body followed by Annex-B start code and PPS
	if !bytes.Contains(pkts[0], []byte{0, 0, 0, 1, 0x68}) {
		t.Fatal("first packet must contain 00 00 00 01 followed by PPS")
	}
	// Intermediate packets must have indicator 0x1c and header 0x07
	for i := 1; i < len(pkts)-1; i++ {
		if pkts[i][0] != 0x1c || pkts[i][1] != 0x07 {
			t.Fatalf("pkt %d header got %x %x want 1c 07", i, pkts[i][0], pkts[i][1])
		}
	}
	// Final packet must have indicator 0x1c and header 0x47 (End bit)
	last := pkts[len(pkts)-1]
	if last[0] != 0x1c || last[1] != 0x47 {
		t.Fatalf("last packet header got %x %x want 1c 47", last[0], last[1])
	}
}

func TestPacketizeH264PFrameSingleNAL(t *testing.T) {
	pframe := []byte{0x61, 0xd0, 0x00, 0x97, 0x24}
	pkts := PacketizeH264NALs([][]byte{pframe}, 1200)
	if len(pkts) != 1 {
		t.Fatalf("p-frame under MTU should be single NAL, got %d pkts", len(pkts))
	}
	if !bytes.Equal(pkts[0], pframe) {
		t.Fatalf("p-frame mismatch got %x want %x", pkts[0], pframe)
	}
}
