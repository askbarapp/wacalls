package transport

import (
	"os"
	"strconv"
	"sync"

	"github.com/pion/webrtc/v4"
)

const (
	defaultICEPortMin uint16 = 10000
	defaultICEPortMax uint16 = 10031
)

var (
	webrtcAPIOnce sync.Once
	webrtcAPI     *webrtc.API
)

func icePortRange() (uint16, uint16) {
	min := envU16("ICE_UDP_PORT_MIN", defaultICEPortMin)
	max := envU16("ICE_UDP_PORT_MAX", defaultICEPortMax)
	if max < min {
		max = min
	}
	return min, max
}

func envU16(key string, fallback uint16) uint16 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 || n > 65535 {
		return fallback
	}
	return uint16(n)
}

func webrtcAPIForCalls() *webrtc.API {
	webrtcAPIOnce.Do(func() {
		se := webrtc.SettingEngine{}
		min, max := icePortRange()
		_ = se.SetEphemeralUDPPortRange(min, max)
		if ip := os.Getenv("PUBLIC_IP"); ip != "" {
			se.SetNAT1To1IPs([]string{ip}, webrtc.ICECandidateTypeHost)
		}
		se.SetNetworkTypes([]webrtc.NetworkType{
			webrtc.NetworkTypeUDP4,
			webrtc.NetworkTypeUDP6,
		})
		webrtcAPI = webrtc.NewAPI(webrtc.WithSettingEngine(se))
	})
	return webrtcAPI
}

func newRelayPeerConnection() (*webrtc.PeerConnection, error) {
	return webrtcAPIForCalls().NewPeerConnection(webrtc.Configuration{})
}
