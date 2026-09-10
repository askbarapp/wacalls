package media

// PacketizeVp8 wraps a VP8 bitstream in RFC 7741 RTP payloads.
func PacketizeVp8(frame []byte, mtu int) [][]byte {
	if len(frame) == 0 {
		return nil
	}
	if mtu < 64 {
		mtu = 1200
	}
	maxPayload := mtu - 1
	var out [][]byte
	offset := 0
	first := true
	for offset < len(frame) {
		n := len(frame) - offset
		if n > maxPayload {
			n = maxPayload
		}
		pkt := make([]byte, 1+n)
		// X=0 R=0 N=0 S=first PartID=0
		if first {
			pkt[0] = 0x10
			first = false
		}
		copy(pkt[1:], frame[offset:offset+n])
		out = append(out, pkt)
		offset += n
	}
	return out
}
