package sip

import (
	"log/slog"
	"sync"
)

type BridgeDirection int

const (
	BridgeWhatsAppToSIP BridgeDirection = iota
	BridgeSIPToWhatsApp
)

type AudioBridge struct {
	sipSession   *RTPSession
	whatsappChan chan []float32
	codec        Codec
	sampleRate   int
	mu           sync.Mutex
	stopCh       chan struct{}
	running      bool
	log          *slog.Logger
}

func NewAudioBridge(sipSession *RTPSession, codec Codec, log *slog.Logger) *AudioBridge {
	sampleRate := 8000
	if codec == CodecPCMU || codec == CodecPCMA {
		sampleRate = 8000
	}
	return &AudioBridge{
		sipSession:   sipSession,
		whatsappChan: make(chan []float32, 100),
		codec:        codec,
		sampleRate:   sampleRate,
		stopCh:       make(chan struct{}),
		log:          log,
	}
}

func (b *AudioBridge) Start() {
	b.mu.Lock()
	if b.running {
		b.mu.Unlock()
		return
	}
	b.running = true
	b.mu.Unlock()

	b.sipSession.Start(func(rtpPayload []byte) {
		var pcm []float32
		switch b.codec {
		case CodecPCMA:
			pcm = G711ALawToPCM16(rtpPayload)
		default:
			pcm = G711MuLawToPCM16(rtpPayload)
		}
		pcm16 := Resample8to16(pcm)
		select {
		case b.whatsappChan <- pcm16:
		default:
		}
	})
}

func (b *AudioBridge) Stop() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.running {
		return
	}
	b.running = false
	close(b.stopCh)
	b.sipSession.Stop()
}

func (b *AudioBridge) SendToWhatsApp(pcm16 []float32) error {
	select {
	case b.whatsappChan <- pcm16:
		return nil
	default:
		return nil
	}
}

func (b *AudioBridge) ReceiveFromWhatsApp() <-chan []float32 {
	return b.whatsappChan
}

func (b *AudioBridge) SendToSIP(pcm16 []float32) error {
	pcm8 := Resample16to8(pcm16)
	var g711 []byte
	switch b.codec {
	case CodecPCMA:
		g711 = PCM16ToG711ALaw(pcm8)
	default:
		g711 = PCM16ToG711MuLaw(pcm8)
	}
	return b.sipSession.Write(g711)
}

type SIPWhatsAppBridge struct {
	ua       *UA
	log      *slog.Logger
	bridges  map[string]*AudioBridge
	mu       sync.RWMutex
}

func NewSIPWhatsAppBridge(ua *UA, log *slog.Logger) *SIPWhatsAppBridge {
	return &SIPWhatsAppBridge{
		ua:      ua,
		log:     log,
		bridges: make(map[string]*AudioBridge),
	}
}

func (b *SIPWhatsAppBridge) HandleWhatsAppAudio(callID string, peerAudio <-chan []float32) {
	b.mu.RLock()
	bridge, ok := b.bridges[callID]
	b.mu.RUnlock()
	if !ok {
		return
	}
	go func() {
		for {
			select {
			case <-bridge.stopCh:
				return
			case pcm, ok := <-peerAudio:
				if !ok {
					return
				}
				bridge.SendToSIP(pcm)
			}
		}
	}()
}

func (b *SIPWhatsAppBridge) HandleSIPAudio(callID string, onWhatsAppAudio func([]float32)) {
	b.mu.RLock()
	bridge, ok := b.bridges[callID]
	b.mu.RUnlock()
	if !ok {
		return
	}
	go func() {
		for {
			select {
			case <-bridge.stopCh:
				return
			case pcm, ok := <-bridge.ReceiveFromWhatsApp():
				if !ok {
					return
				}
				onWhatsAppAudio(pcm)
			}
		}
	}()
}

func (b *SIPWhatsAppBridge) CreateBridge(callID string, rtpPort int) (*AudioBridge, error) {
	rtp, err := NewRTPSession(rtpPort)
	if err != nil {
		return nil, err
	}
	bridge := NewAudioBridge(rtp, CodecPCMU, b.log)
	bridge.Start()
	b.mu.Lock()
	b.bridges[callID] = bridge
	b.mu.Unlock()
	return bridge, nil
}

func (b *SIPWhatsAppBridge) RemoveBridge(callID string) {
	b.mu.Lock()
	if bridge, ok := b.bridges[callID]; ok {
		bridge.Stop()
		delete(b.bridges, callID)
	}
	b.mu.Unlock()
}

func (b *SIPWhatsAppBridge) GetBridge(callID string) (*AudioBridge, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	bridge, ok := b.bridges[callID]
	return bridge, ok
}
