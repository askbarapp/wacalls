package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os/exec"
	"sync"
	"wacalls/internal/voip/core"
	"wacalls/internal/voip/media"
)

func (ch *Channel) playVideoClip(lc *liveCall, path string) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		<-lc.stopPlay
		cancel()
	}()

	loop := "-1"
	if !lc.loopClip {
		loop = "0"
	}
	w, h := 480, 640
	if lc.orientation == "landscape" {
		w, h = 640, 480
	}
	vf := fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1", w, h, w, h)

	audioCmd := exec.CommandContext(ctx, "ffmpeg",
		"-hide_banner", "-loglevel", "error",
		"-stream_loop", loop, "-re", "-i", path,
		"-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1",
	)
	videoCmd := exec.CommandContext(ctx, "ffmpeg",
		"-hide_banner", "-loglevel", "error",
		"-stream_loop", loop, "-re", "-i", path,
		"-an", "-vf", vf,
		"-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8",
		"-b:v", "400k", "-crf", "32", "-auto-alt-ref", "0", "-lag-in-frames", "0",
		"-r", "15", "-g", "30", "-pix_fmt", "yuv420p",
		"-f", "ivf", "pipe:1",
	)
	audioOut, err := audioCmd.StdoutPipe()
	if err != nil {
		ch.log.Warn("video audio pipe", "err", err)
		return
	}
	videoOut, err := videoCmd.StdoutPipe()
	if err != nil {
		ch.log.Warn("video ivf pipe", "err", err)
		return
	}
	if err := audioCmd.Start(); err != nil {
		ch.log.Warn("ffmpeg audio start", "err", err)
		return
	}
	if err := videoCmd.Start(); err != nil {
		ch.log.Warn("ffmpeg vp8 start", "err", err)
		_ = audioCmd.Process.Kill()
		return
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		ch.streamPCM32(lc, audioOut)
	}()
	go func() {
		defer wg.Done()
		ch.streamIVF(lc, videoOut)
	}()
	wg.Wait()
	_ = audioCmd.Wait()
	_ = videoCmd.Wait()

	select {
	case <-lc.stopPlay:
		return
	default:
	}
	ch.publish("playback_done", map[string]any{"callId": lc.apiCallID})
	if lc.hangupAfter {
		_ = lc.cm.EndCall(context.Background(), core.EndCallReasonUserEnded)
	}
}

func (ch *Channel) streamPCM32(lc *liveCall, r io.Reader) {
	buf := make([]byte, 320*4)
	for {
		select {
		case <-lc.stopPlay:
			return
		default:
		}
		n, err := io.ReadFull(r, buf)
		if n >= 4 {
			usable := n / 4
			pcm := make([]float32, usable)
			for i := 0; i < usable; i++ {
				pcm[i] = math.Float32frombits(binary.LittleEndian.Uint32(buf[i*4:]))
			}
			if lc.recorder != nil {
				lc.recorder.WritePCM(pcm)
			}
			lc.cm.FeedCapturedPCM(pcm)
		}
		if err != nil {
			return
		}
	}
}

func (ch *Channel) streamIVF(lc *liveCall, r io.Reader) {
	br := bufio.NewReaderSize(r, 64*1024)
	hdr, err := media.ReadIvfHeader(br)
	if err != nil {
		ch.log.Warn("ivf header", "err", err)
		return
	}
	inc := hdr.FrameTimestampInc()
	for {
		select {
		case <-lc.stopPlay:
			return
		default:
		}
		frame, _, err := media.ReadIvfFrame(br)
		if err != nil {
			return
		}
		lc.cm.FeedCapturedVP8(frame, inc)
	}
}
