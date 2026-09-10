package media

// PacketizeVp8 wraps a VP8 bitstream in RFC 7741 RTP payloads.
// pictureID is the 15-bit RFC 7741 PictureID shared by every packet of this frame.
func PacketizeVp8(frame []byte, mtu int, pictureID uint16) [][]byte {
	if len(frame) == 0 {
		return nil
	}
	if mtu < 64 {
		mtu = 1200
	}
	const descLen = 4
	maxPayload := mtu - descLen
	if maxPayload < 1 {
		maxPayload = 1
	}
	pid := pictureID & 0x7fff
	var out [][]byte
	offset := 0
	first := true
	for offset < len(frame) {
		n := len(frame) - offset
		if n > maxPayload {
			n = maxPayload
		}
		pkt := make([]byte, descLen+n)
		// X=1 R=0 N=0 S=first PartID=0
		if first {
			pkt[0] = 0x90
			first = false
		} else {
			pkt[0] = 0x80
		}
		// I=1 (PictureID present)
		pkt[1] = 0x80
		// 15-bit PictureID (M=1)
		pkt[2] = 0x80 | byte(pid>>8)
		pkt[3] = byte(pid)
		copy(pkt[descLen:], frame[offset:offset+n])
		out = append(out, pkt)
		offset += n
	}
	return out
}
