package media

import "testing"

func TestPacketizeVp8SplitsAndSetsStartBit(t *testing.T) {
	frame := make([]byte, 2500)
	for i := range frame {
		frame[i] = byte(i)
	}
	pkts := PacketizeVp8(frame, 200, 0x1234)
	if len(pkts) < 2 {
		t.Fatalf("expected fragmentation, got %d packets", len(pkts))
	}
	if pkts[0][0]&0x10 == 0 {
		t.Fatal("first packet missing S bit")
	}
	for i := 1; i < len(pkts); i++ {
		if pkts[i][0]&0x10 != 0 {
			t.Fatalf("packet %d unexpectedly has S bit", i)
		}
	}
	pidHi, pidLo := pkts[0][2], pkts[0][3]
	for i, p := range pkts {
		if p[2] != pidHi || p[3] != pidLo {
			t.Fatalf("packet %d picture id mismatch", i)
		}
	}
	var rebuilt []byte
	for _, p := range pkts {
		rebuilt = append(rebuilt, p[4:]...)
	}
	if len(rebuilt) != len(frame) {
		t.Fatalf("rebuilt %d want %d", len(rebuilt), len(frame))
	}
	for i := range frame {
		if rebuilt[i] != frame[i] {
			t.Fatalf("payload mismatch at %d", i)
		}
	}
}

func TestPacketizeVp8Empty(t *testing.T) {
	if PacketizeVp8(nil, 1200, 1) != nil {
		t.Fatal("expected nil for empty frame")
	}
}
