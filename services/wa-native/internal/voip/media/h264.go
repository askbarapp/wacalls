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
	return PacketizeH264NALs(nals, mtu)
}

// PacketizeH264NALs packetizes a list of raw NAL units (without Annex-B start codes)
// onto WhatsApp WARP RTP payloads matching the wire format observed from WhatsApp mobile clients.
func PacketizeH264NALs(nals [][]byte, mtu int) [][]byte {
	if mtu < 16 {
		mtu = 1200
	}
	var cleaned [][]byte
	hasSPS := false
	hasIDR := false
	for _, nal := range nals {
		if len(nal) == 0 {
			continue
		}
		nt := nal[0] & 0x1f
		if nt == 0 || nt == 6 || nt == 9 || nt == 12 {
			continue // Drop undefined, SEI (unregistered user data), AUD, filler
		}
		if nt == 7 {
			hasSPS = true
		} else if nt == 5 {
			hasIDR = true
		}
		cleaned = append(cleaned, nal)
	}
	if len(cleaned) == 0 {
		return nil
	}

	// WhatsApp WARP Keyframe AU packaging:
	// If the Access Unit contains SPS or IDR, WhatsApp bundles SPS, PPS, and IDR
	// into a single continuous AU with Annex-B start codes (00 00 00 01) and fragments it
	// via FU-A starting with 0x7c 0x87, followed by 0x1c 0x07 continuation and 0x1c 0x47 end.
	if hasSPS || hasIDR {
		var sps, pps, idr []byte
		var extraVCL [][]byte
		for _, nal := range cleaned {
			nt := nal[0] & 0x1f
			switch nt {
			case 7:
				if sps == nil {
					sps = nal
				}
			case 8:
				if pps == nil {
					pps = nal
				}
			case 5:
				if idr == nil {
					idr = nal
				} else {
					extraVCL = append(extraVCL, nal)
				}
			default:
				extraVCL = append(extraVCL, nal)
			}
		}

		if sps != nil && pps != nil && idr != nil {
			return packetizeWhatsAppKeyframeAU(sps, pps, idr, extraVCL, mtu)
		}
	}

	// For P-frames (inter-frame): single NAL under MTU, or FU-A over MTU (0x7c 0x81 ... 0x1c 0x01 ... 0x1c 0x41).
	var out [][]byte
	for _, nal := range cleaned {
		out = append(out, packetizeWhatsAppNAL(nal, mtu)...)
	}
	return out
}

func packetizeWhatsAppKeyframeAU(sps, pps, idr []byte, extraVCL [][]byte, mtu int) [][]byte {
	// Assemble continuous AU matching WhatsApp phone wire:
	// SPS (without first byte) + 00 00 00 01 + PPS + 00 00 00 01 + IDR [+ 00 00 00 01 + extra...]
	startCode := []byte{0x00, 0x00, 0x00, 0x01}
	var payload []byte
	if len(sps) > 1 {
		payload = append(payload, sps[1:]...) // SPS body without 0x67 header
	}
	payload = append(payload, startCode...)
	payload = append(payload, pps...)
	payload = append(payload, startCode...)
	payload = append(payload, idr...)
	for _, extra := range extraVCL {
		payload = append(payload, startCode...)
		payload = append(payload, extra...)
	}

	maxFrag := mtu - 2
	if maxFrag < 1 {
		maxFrag = 1
	}

	var out [][]byte
	offset := 0
	first := true
	for offset < len(payload) {
		n := len(payload) - offset
		if n > maxFrag {
			n = maxFrag
		}
		frag := make([]byte, 2+n)
		if first {
			frag[0] = 0x7c // NRI=3, FU-A (28)
			frag[1] = 0x87 // S=1, E=0, Type=7 (SPS)
			first = false
		} else {
			frag[0] = 0x1c // NRI=0, FU-A (28)
			fu := byte(7)
			if offset+n >= len(payload) {
				fu |= 0x40 // E=1 (End bit)
			}
			frag[1] = fu
		}
		copy(frag[2:], payload[offset:offset+n])
		out = append(out, frag)
		offset += n
	}
	return out
}

func packetizeWhatsAppNAL(nal []byte, mtu int) [][]byte {
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
		if first {
			frag[0] = nri | h264NalFuA
			frag[1] = 0x80 | nt // S=1
			first = false
		} else {
			frag[0] = 0x1c // NRI=0 on continuation and end fragments per WhatsApp wire
			fu := nt
			if offset+n >= len(nal) {
				fu |= 0x40 // E=1
			}
			frag[1] = fu
		}
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
