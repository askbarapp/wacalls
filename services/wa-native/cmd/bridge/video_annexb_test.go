package main

import (
	"bufio"
	"bytes"
	"testing"
)

func TestReadAnnexBNALSplitsUnits(t *testing.T) {
	raw := []byte{
		0, 0, 0, 1, 0x67, 0x42, 0xc0,
		0, 0, 0, 1, 0x65, 0x88, 0x80,
	}
	br := bufio.NewReader(bytes.NewReader(raw))
	sc := annexBScanner{r: br}
	first, err := sc.Next()
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 3 || first[0] != 0x67 || first[2] != 0xc0 {
		t.Fatalf("sps %+v", first)
	}
	second, err := sc.Next()
	if err != nil && len(second) == 0 {
		t.Fatal(err)
	}
	if len(second) != 3 || second[0] != 0x65 {
		t.Fatalf("idr %+v", second)
	}
}
