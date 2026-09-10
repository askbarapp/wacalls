package media

const (
	h264NalFuA  = 28
	h264NalStapA = 24
)

// PacketizeH264 maps an Annex-B or raw-NAL access unit onto RFC 6184 RTP payloads.
func PacketizeH264(au []byte, mtu int) [][]byte {
	if len(au) == 0 {
		return nil
	}
	if mtu < 16 {
		mtu = 1200
	}
	nals := SplitAnnexB(au)
	if len(nals) == 0 {
		nals = [][]byte{au}
	}
	var cleaned [][]byte
	for _, nal := range nals {
		if len(nal) == 0 {
			continue
		}
		nt := nal[0] & 0x1f
		if nt == 0 || nt == 9 || nt == 12 {
			continue
		}
		cleaned = append(cleaned, nal)
	}
	if len(cleaned) == 0 {
		return nil
	}
	// WhatsApp's H.264 path is RFC 6184 single-NAL / FU-A. STAP-A is not
	// established on the WARP wire and phones drop aggregated units.
	var out [][]byte
	for _, nal := range cleaned {
		out = append(out, packetizeNAL(nal, mtu)...)
	}
	return out
}

func packStapA(nals [][]byte, mtu int) []byte {
	if len(nals) < 2 {
		return nil
	}
	nri := byte(0)
	size := 1
	for _, nal := range nals {
		size += 2 + len(nal)
		if nri < nal[0]&0x60 {
			nri = nal[0] & 0x60
		}
	}
	if size > mtu {
		return nil
	}
	out := make([]byte, 0, size)
	out = append(out, nri|h264NalStapA)
	for _, nal := range nals {
		out = append(out, byte(len(nal)>>8), byte(len(nal)))
		out = append(out, nal...)
	}
	return out
}

func packetizeNAL(nal []byte, mtu int) [][]byte {
	if len(nal) <= mtu {
		pkt := make([]byte, len(nal))
		copy(pkt, nal)
		return [][]byte{pkt}
	}
	nri := nal[0] & 0x60
	nt := nal[0] & 0x1f
	maxFrag := mtu - 2
	if maxFrag < 1 {
		maxFrag = 1
	}
	var out [][]byte
	offset := 1
	first := true
	for offset < len(nal) {
		n := len(nal) - offset
		if n > maxFrag {
			n = maxFrag
		}
		frag := make([]byte, 2+n)
		frag[0] = nri | h264NalFuA
		fu := nt
		if first {
			fu |= 0x80
			first = false
		}
		if offset+n >= len(nal) {
			fu |= 0x40
		}
		frag[1] = fu
		copy(frag[2:], nal[offset:offset+n])
		out = append(out, frag)
		offset += n
	}
	return out
}

// SplitAnnexB returns NAL units without start codes.
func SplitAnnexB(data []byte) [][]byte {
	var nals [][]byte
	i := 0
	for i < len(data) {
		start := indexStartCode(data, i)
		if start < 0 {
			break
		}
		sc := 3
		if start+3 < len(data) && data[start] == 0 && data[start+1] == 0 && data[start+2] == 0 && data[start+3] == 1 {
			sc = 4
		}
		nalStart := start + sc
		next := indexStartCode(data, nalStart)
		end := len(data)
		if next >= 0 {
			end = next
		}
		for end > nalStart && data[end-1] == 0 {
			end--
		}
		if end > nalStart {
			nals = append(nals, data[nalStart:end])
		}
		if next < 0 {
			break
		}
		i = next
	}
	return nals
}

func indexStartCode(data []byte, from int) int {
	for i := from; i+2 < len(data); i++ {
		if data[i] == 0 && data[i+1] == 0 && data[i+2] == 1 {
			return i
		}
		if i+3 < len(data) && data[i] == 0 && data[i+1] == 0 && data[i+2] == 0 && data[i+3] == 1 {
			return i
		}
	}
	return -1
}

func IsH264VCL(nal []byte) bool {
	if len(nal) == 0 {
		return false
	}
	t := nal[0] & 0x1f
	return t >= 1 && t <= 5
}
