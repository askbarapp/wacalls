package call

import (
	"time"
	"wacalls/internal/voip/core"
	"wacalls/internal/voip/media"
	"wacalls/internal/voip/transport"
)

func (m *CallManager) initCodec() {
	if m.codec != nil {
		return
	}
	codec, err := media.NewMLowCodec(media.DefaultCodecOptions)
	if err != nil {
		m.log.Warn("MLow codec unavailable — call will run signaling-only (no audio)", "err", err)
		return
	}
	m.codec = codec
	m.log.Info("MLow codec initialized", "frame_size", codec.FrameSize(), "sample_rate", codec.SampleRate())
}

func (m *CallManager) FeedCapturedPCM(data []float32) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.totalPCMRecv += len(data)

	if m.codec == nil {
		m.log.Debug("FeedCapturedPCM: codec nil, dropping", "samples", len(data))
		return
	}
	if m.rtpSession == nil {
		m.log.Debug("FeedCapturedPCM: rtpSession nil, dropping", "samples", len(data))
		return
	}
	if m.srtpSession == nil {
		// Buffer audio while SRTP keys are being derived
		if m.pendingPCM == nil {
			m.pendingPCM = make([]float32, 0, 32000)
		}
		m.pendingPCM = append(m.pendingPCM, data...)
		if len(m.pendingPCM) > 32000 {
			m.pendingPCM = m.pendingPCM[len(m.pendingPCM)-32000:]
		}
		m.log.Debug("FeedCapturedPCM: srtpSession nil, buffering", "buffered", len(m.pendingPCM))
		return
	}
	if !m.relay.HasConnection() {
		// Buffer audio while relay connects (max 2 seconds @ 16kHz = 32000 samples)
		if m.pendingPCM == nil {
			m.pendingPCM = make([]float32, 0, 32000)
		}
		m.pendingPCM = append(m.pendingPCM, data...)
		if len(m.pendingPCM) > 32000 {
			m.pendingPCM = m.pendingPCM[len(m.pendingPCM)-32000:]
		}
		m.log.Debug("FeedCapturedPCM: relay not connected, buffering", "buffered", len(m.pendingPCM))
		return
	}

	// Flush buffered audio from when relay was connecting
	if len(m.pendingPCM) > 0 {
		m.log.Info("FeedCapturedPCM: flushing buffered audio", "samples", len(m.pendingPCM))
		buf := m.pendingPCM
		m.pendingPCM = nil
		m.feedPCMInternal(buf)
	}

	m.feedPCMInternal(data)
}

func (m *CallManager) feedPCMInternal(data []float32) {
	m.lastCaptureAt = time.Now()
	frameSize := m.codec.FrameSize()
	if m.encodeBuf == nil {
		m.encodeBuf = make([]float32, frameSize)
		m.encodeBufPos = 0
	}

	offset := 0
	for offset < len(data) {
		toCopy := min(len(data)-offset, frameSize-m.encodeBufPos)
		copy(m.encodeBuf[m.encodeBufPos:], data[offset:offset+toCopy])
		m.encodeBufPos += toCopy
		offset += toCopy
		if m.encodeBufPos < frameSize {
			break
		}
		frame := make([]float32, frameSize)
		copy(frame, m.encodeBuf)
		m.encodeBufPos = 0

		opus, err := m.codec.Encode(frame)
		if err != nil {
			m.log.Debug("encode error", "err", err)
			continue
		}
		m.sendOpusFrameLocked(opus)
	}
}

func (m *CallManager) sendOpusFrameLocked(opus []byte) {
	if m.rtpSession == nil || m.srtpSession == nil {
		return
	}
	marker := !m.firstPacketSent
	pkt := m.rtpSession.CreatePacketWithDuration(opus, m.codec.FrameSize(), marker)
	if m.debeEnabled {
		pkt.Header.Extension = true
		pkt.Header.ExtensionProfile = 0xbede
		pkt.Header.ExtensionData = nil
	}
	m.firstPacketSent = true
	m.totalFramesSent++

	if m.totalFramesSent%100 == 1 {
		m.log.Info("audio frame sent", "frames", m.totalFramesSent, "pcm_recv", m.totalPCMRecv)
	}

	srtp, err := m.srtpSession.Protect(pkt)
	if err != nil {
		m.log.Debug("srtp protect error", "err", err)
		return
	}
	m.relay.Broadcast(srtp)
}

func (m *CallManager) startSilenceKeepaliveLocked() {
	if m.keepaliveStop != nil || m.codec == nil {
		return
	}
	stop := make(chan struct{})
	m.keepaliveStop = stop
	frameSize := m.codec.FrameSize()
	go func() {
		ticker := time.NewTicker(60 * time.Millisecond)
		defer ticker.Stop()
		silence := make([]float32, frameSize)
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				m.mu.Lock()
				ready := m.codec != nil && m.rtpSession != nil && m.srtpSession != nil && m.relay.HasConnection()
				idle := time.Since(m.lastCaptureAt) > 120*time.Millisecond
				if ready && idle {
					if opus, err := m.codec.Encode(silence); err == nil {
						m.sendOpusFrameLocked(opus)
					}
				}
				m.mu.Unlock()
			}
		}
	}()
}

func (m *CallManager) onRelayData(data []byte) {
	if transport.IsStunPacket(data) {
		return
	}
	if !transport.IsRtpPacket(data) {
		return
	}
	if len(data) < 12 {
		return
	}
	pt := data[1] & 0x7f
	if pt != core.PayloadTypeWhatsAppOpus {
		return
	}

	m.mu.Lock()
	m.totalRelayRecv++
	if m.srtpSession == nil || m.codec == nil {
		m.mu.Unlock()
		return
	}
	ssrc := uint32(data[8])<<24 | uint32(data[9])<<16 | uint32(data[10])<<8 | uint32(data[11])
	if ssrc == m.selfSsrc {
		m.mu.Unlock()
		return
	}
	if !m.actualPeerSet {
		m.actualPeerSet = true
		if !containsSsrc(m.peerSsrcs, ssrc) {
			m.peerSsrcs = []uint32{ssrc}
			m.relay.SetSubscriptionSsrc(ssrc)
			go m.relay.ResendSubscriptions()
		}
	}
	srtp := m.srtpSession
	codec := m.codec
	m.mu.Unlock()

	pkt, err := srtp.Unprotect(data)
	if err != nil {
		m.log.Debug("srtp unprotect error", "err", err)
		return
	}
	if len(pkt.Payload) == 0 {
		return
	}
	pcm, err := codec.Decode(pkt.Payload)
	if err != nil {
		return
	}
	pcm = media.NormalizeFrame(pcm, codec.FrameSize())
	if m.OnPeerAudio != nil {
		m.OnPeerAudio(pcm)
	}
}
