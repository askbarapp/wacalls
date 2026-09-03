package sip

import (
	"encoding/binary"
	"fmt"
	"net"
	"sync"
	"time"
)

type RTPSession struct {
	conn       *net.UDPConn
	remoteAddr *net.UDPAddr
	ssrc       uint32
	seq        uint16
	timestamp  uint32
	onPacket   func([]byte)
	mu         sync.Mutex
	stopCh     chan struct{}
}

func NewRTPSession(localPort int) (*RTPSession, error) {
	addr, err := net.ResolveUDPAddr("udp", fmt.Sprintf(":%d", localPort))
	if err != nil {
		return nil, err
	}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		return nil, err
	}
	return &RTPSession{
		conn:   conn,
		ssrc:   uint32(time.Now().UnixNano()),
		stopCh: make(chan struct{}),
	}, nil
}

func (r *RTPSession) Start(onPacket func([]byte)) {
	r.onPacket = onPacket
	go func() {
		buf := make([]byte, 1500)
		for {
			select {
			case <-r.stopCh:
				return
			default:
			}
			n, _, err := r.conn.ReadFromUDP(buf)
			if err != nil {
				continue
			}
			if r.onPacket != nil && n > 12 {
				r.onPacket(buf[12:n])
			}
		}
	}()
}

func (r *RTPSession) SetRemote(addr *net.UDPAddr) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.remoteAddr = addr
}

func (r *RTPSession) Write(payload []byte) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.remoteAddr == nil {
		return fmt.Errorf("no remote addr")
	}
	pkt := make([]byte, 12+len(payload))
	pkt[0] = 0x80
	pkt[1] = 0x00
	binary.BigEndian.PutUint16(pkt[2:4], r.seq)
	binary.BigEndian.PutUint32(pkt[4:8], r.timestamp)
	binary.BigEndian.PutUint32(pkt[8:12], r.ssrc)
	copy(pkt[12:], payload)
	r.seq++
	r.timestamp += 160
	_, err := r.conn.WriteToUDP(pkt, r.remoteAddr)
	return err
}

func (r *RTPSession) Stop() {
	close(r.stopCh)
	r.conn.Close()
}

func (r *RTPSession) LocalPort() int {
	return r.conn.LocalAddr().(*net.UDPAddr).Port
}

type Codec int

const (
	CodecPCMU Codec = 0
	CodecPCMA Codec = 8
)

func PCM16ToG711MuLaw(pcm []float32) []byte {
	out := make([]byte, len(pcm))
	for i, s := range pcm {
		out[i] = linearToMuLaw(floatToInt16(s))
	}
	return out
}

func G711MuLawToPCM16(g711 []byte) []float32 {
	out := make([]float32, len(g711))
	for i, b := range g711 {
		out[i] = float32(muLawToLinear(b)) / 32768.0
	}
	return out
}

func PCM16ToG711ALaw(pcm []float32) []byte {
	out := make([]byte, len(pcm))
	for i, s := range pcm {
		out[i] = linearToALaw(floatToInt16(s))
	}
	return out
}

func G711ALawToPCM16(g711 []byte) []float32 {
	out := make([]float32, len(g711))
	for i, b := range g711 {
		out[i] = float32(aLawToLinear(b)) / 32768.0
	}
	return out
}

func Resample8to16(pcm8 []float32) []float32 {
	out := make([]float32, len(pcm8)*2)
	for i, s := range pcm8 {
		out[i*2] = s
		out[i*2+1] = s
	}
	return out
}

func Resample16to8(pcm16 []float32) []float32 {
	out := make([]float32, len(pcm16)/2)
	for i := range out {
		out[i] = (pcm16[i*2] + pcm16[i*2+1]) / 2
	}
	return out
}

func floatToInt16(s float32) int16 {
	if s > 1.0 {
		return 32767
	}
	if s < -1.0 {
		return -32768
	}
	return int16(s * 32767)
}

func linearToMuLaw(sample int16) byte {
	const bias = 33
	const clip = 32635
	s := int(sample)
	sign := byte(0)
	if s < 0 {
		sign = 0x80
		s = -s
	}
	if s > clip {
		s = clip
	}
	s += bias
	exponent := byte(7)
	mask := int(0x40)
	for i := byte(0); i < 8; i++ {
		if s&mask != 0 {
			exponent = 7 - i
			break
		}
		mask >>= 1
	}
	mantissa := byte((s >> (exponent + 3)) & 0x0F)
	return ^(sign | (exponent << 4) | mantissa)
}

func muLawToLinear(value byte) int16 {
	value = ^value
	sign := int16(1)
	if value&0x80 != 0 {
		sign = -1
		value &= 0x7F
	}
	exponent := int((value >> 4) & 0x07)
	mantissa := int(value & 0x0F)
	sample := int16((mantissa<<(uint(exponent)+3) | (1 << uint(exponent))) + (1 << uint(exponent)) - 33)
	return sign * sample
}

func linearToALaw(sample int16) byte {
	s := int(sample)
	sign := byte(0)
	if s < 0 {
		sign = 0x80
		s = -s
	}
	if s > 32767 {
		s = 32767
	}
	exponent := byte(0)
	mask := int(0x4000)
	for i := byte(0); i < 8; i++ {
		if s&mask != 0 {
			exponent = 7 - i
			break
		}
		mask >>= 1
	}
	mantissa := byte((s >> (uint(exponent) + 3)) & 0x0F)
	return sign | (exponent << 4) | mantissa | 0x55
}

func aLawToLinear(value byte) int16 {
	value ^= 0x55
	sign := int16(1)
	if value&0x80 != 0 {
		sign = -1
		value &= 0x7F
	}
	exponent := int((value >> 4) & 0x07)
	mantissa := int(value & 0x0F)
	sample := int16(((mantissa << 1) | 1) << (uint(exponent) + 3))
	if exponent > 0 {
		sample -= 0x21
	}
	return sign * sample
}
