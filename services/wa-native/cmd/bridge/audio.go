package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func decodeAudioFile(path string) ([]float32, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if pcm, ok := decodeWAV(raw); ok {
		return pcm, nil
	}
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		return nil, fmt.Errorf("unsupported audio file %s (need wav or ffmpeg)", filepath.Base(path))
	}
	cmd := exec.Command(ffmpeg, "-v", "error", "-i", path, "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000", "pipe:1")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg decode: %w", err)
	}
	return s16leToFloat32(out), nil
}

func decodeWAV(raw []byte) ([]float32, bool) {
	if len(raw) < 44 || string(raw[0:4]) != "RIFF" || string(raw[8:12]) != "WAVE" {
		return nil, false
	}
	off := 12
	var data []byte
	channels := 1
	rate := 16000
	bits := 16
	for off+8 <= len(raw) {
		chunk := string(raw[off : off+4])
		size := int(binary.LittleEndian.Uint32(raw[off+4 : off+8]))
		off += 8
		if off+size > len(raw) {
			break
		}
		body := raw[off : off+size]
		off += size
		if size%2 == 1 {
			off++
		}
		switch chunk {
		case "fmt ":
			if len(body) >= 16 {
				channels = int(binary.LittleEndian.Uint16(body[2:4]))
				rate = int(binary.LittleEndian.Uint32(body[4:8]))
				bits = int(binary.LittleEndian.Uint16(body[14:16]))
			}
		case "data":
			data = body
		}
	}
	if data == nil || bits != 16 {
		return nil, false
	}
	pcm := s16leToFloat32(data)
	if channels == 2 {
		mono := make([]float32, len(pcm)/2)
		for i := 0; i < len(mono); i++ {
			mono[i] = (pcm[i*2] + pcm[i*2+1]) / 2
		}
		pcm = mono
	}
	if rate != 16000 && rate > 0 {
		pcm = resampleLinear(pcm, rate, 16000)
	}
	return pcm, true
}

func s16leToFloat32(b []byte) []float32 {
	n := len(b) / 2
	out := make([]float32, n)
	r := bytes.NewReader(b)
	for i := 0; i < n; i++ {
		var s int16
		_ = binary.Read(r, binary.LittleEndian, &s)
		out[i] = float32(s) / 32768
	}
	return out
}

func resampleLinear(in []float32, from, to int) []float32 {
	if from == to || len(in) == 0 {
		return in
	}
	outLen := int(float64(len(in)) * float64(to) / float64(from))
	out := make([]float32, outLen)
	ratio := float64(from) / float64(to)
	for i := range out {
		src := float64(i) * ratio
		j := int(src)
		f := float32(src - float64(j))
		if j+1 < len(in) {
			out[i] = in[j]*(1-f) + in[j+1]*f
		} else if j < len(in) {
			out[i] = in[j]
		}
	}
	return out
}
