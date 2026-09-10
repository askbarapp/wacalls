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
		"-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
		"-profile:v", "baseline", "-level", "3.1", "-pix_fmt", "yuv420p",
		"-b:v", "600k", "-maxrate", "800k", "-bufsize", "1200k",
		"-r", "15", "-g", "15", "-keyint_min", "15", "-bf", "0",
		"-x264-params", "repeat-headers=1:scenecut=0",
		"-f", "h264", "pipe:1",
	)
	audioOut, err := audioCmd.StdoutPipe()
	if err != nil {
		ch.log.Warn("video audio pipe", "err", err)
		return
	}
	videoOut, err := videoCmd.StdoutPipe()
	if err != nil {
		ch.log.Warn("video h264 pipe", "err", err)
		return
	}
	if err := audioCmd.Start(); err != nil {
		ch.log.Warn("ffmpeg audio start", "err", err)
		return
	}
	if err := videoCmd.Start(); err != nil {
		ch.log.Warn("ffmpeg h264 start", "err", err)
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
		ch.streamH264(lc, videoOut)
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

func (ch *Channel) streamH264(lc *liveCall, r io.Reader) {
	br := bufio.NewReaderSize(r, 256*1024)
	const tsInc uint32 = 6000
	var pending [][]byte
	var au [][]byte
	flush := func() {
		if len(au) == 0 {
			return
		}
		n := 0
		for _, p := range au {
			n += len(p)
		}
		buf := make([]byte, 0, n+8)
		for _, p := range au {
			buf = append(buf, 0, 0, 0, 1)
			buf = append(buf, p...)
		}
		lc.cm.FeedCapturedVP8(buf, tsInc)
		au = au[:0]
	}
	for {
		select {
		case <-lc.stopPlay:
			return
		default:
		}
		nal, err := readAnnexBNAL(br)
		if len(nal) > 0 {
			if media.IsH264VCL(nal) {
				if len(au) > 0 {
					hasVCL := false
					for _, p := range au {
						if media.IsH264VCL(p) {
							hasVCL = true
							break
						}
					}
					if hasVCL {
						flush()
					}
				}
				if len(pending) > 0 {
					au = append(au, pending...)
					pending = pending[:0]
				}
				au = append(au, nal)
			} else {
				t := nal[0] & 0x1f
				if t == 7 || t == 8 {
					pending = append(pending, nal)
				} else if t != 9 {
					au = append(au, nal)
				} else if len(au) > 0 {
					flush()
				}
			}
		}
		if err != nil {
			flush()
			return
		}
	}
}

func readAnnexBNAL(r *bufio.Reader) ([]byte, error) {
	var buf []byte
	zeros := 0
	started := false
	for {
		b, err := r.ReadByte()
		if err != nil {
			if started && len(buf) > 0 {
				return buf, err
			}
			return nil, err
		}
		if !started {
			if b == 0 {
				zeros++
				continue
			}
			if b == 1 && zeros >= 2 {
				started = true
				zeros = 0
				continue
			}
			zeros = 0
			continue
		}
		if b == 0 {
			zeros++
			if zeros < 3 {
				buf = append(buf, b)
			}
			continue
		}
		if b == 1 && zeros >= 2 {
			n := zeros
			if n > 3 {
				n = 3
			}
			if len(buf) >= n {
				buf = buf[:len(buf)-n]
			} else {
				buf = buf[:0]
			}
			zeros = 0
			return buf, nil
		}
		if zeros >= 3 {
			buf = append(buf, 0, 0)
			zeros = 0
		} else if zeros > 0 {
			zeros = 0
		}
		buf = append(buf, b)
	}
}
