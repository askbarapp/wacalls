package recording

import (
	"encoding/binary"
	"io"
	"math"
	"os"
	"sync"
	"time"
)

const (
	SampleRate = 16000
	Channels   = 1
	BitsPerSample = 16
)

type Recorder struct {
	mu       sync.Mutex
	file     *os.File
	samples  []float32
	started  time.Time
	duration time.Duration
	closed   bool
}

func New(filePath string) (*Recorder, error) {
	f, err := os.Create(filePath)
	if err != nil {
		return nil, err
	}
	r := &Recorder{
		file:    f,
		started: time.Now(),
	}
	return r, nil
}

func (r *Recorder) WritePCM(pcm []float32) {
	r.Mix(pcm)
}

// Mix writes PCM onto the wall-clock timeline so callee and agent audio overlap
// instead of concatenating, and silence is kept so the file matches call length.
func (r *Recorder) Mix(pcm []float32) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || len(pcm) == 0 {
		return
	}
	idx := int(time.Since(r.started).Seconds() * float64(SampleRate))
	if idx < 0 {
		idx = 0
	}
	need := idx + len(pcm)
	if need > len(r.samples) {
		grown := make([]float32, need+SampleRate)
		copy(grown, r.samples)
		r.samples = grown
	}
	for i, s := range pcm {
		j := idx + i
		sum := r.samples[j] + s
		if sum > 1 {
			sum = 1
		}
		if sum < -1 {
			sum = -1
		}
		r.samples[j] = sum
	}
}

func (r *Recorder) Stop() (time.Duration, int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return 0, 0, nil
	}
	r.closed = true
	r.duration = time.Since(r.started)
	end := int(r.duration.Seconds() * float64(SampleRate))
	if end > len(r.samples) {
		grown := make([]float32, end)
		copy(grown, r.samples)
		r.samples = grown
	} else if end > 0 && end < len(r.samples) {
		r.samples = r.samples[:end]
	}

	if err := r.writeWAV(); err != nil {
		r.file.Close()
		return 0, 0, err
	}
	info, _ := r.file.Stat()
	size := int64(0)
	if info != nil {
		size = info.Size()
	}
	r.file.Close()
	return r.duration, size, nil
}

func (r *Recorder) writeWAV() error {
	dataSize := len(r.samples) * 2
	fileSize := 36 + dataSize

	if _, err := r.file.WriteString("RIFF"); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, uint32(fileSize)); err != nil {
		return err
	}
	if _, err := r.file.WriteString("WAVE"); err != nil {
		return err
	}
	if _, err := r.file.WriteString("fmt "); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, uint32(16)); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, uint16(1)); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, uint16(Channels)); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, uint32(SampleRate)); err != nil {
		return err
	}
	byteRate := uint32(SampleRate * Channels * BitsPerSample / 8)
	if err := binary.Write(r.file, binary.LittleEndian, byteRate); err != nil {
		return err
	}
	blockAlign := uint16(Channels * BitsPerSample / 8)
	if err := binary.Write(r.file, binary.LittleEndian, blockAlign); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, uint16(BitsPerSample)); err != nil {
		return err
	}
	if _, err := r.file.WriteString("data"); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, uint32(dataSize)); err != nil {
		return err
	}
	for _, s := range r.samples {
		v := floatToInt16(s)
		if err := binary.Write(r.file, binary.LittleEndian, v); err != nil {
			return err
		}
	}
	return nil
}

func floatToInt16(s float32) int16 {
	switch {
	case math.IsNaN(float64(s)):
		return 0
	case s >= 1:
		return math.MaxInt16
	case s <= -1:
		return math.MinInt16
	}
	return int16(s * 32767)
}

func (r *Recorder) WriteTo(w io.Writer) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.file == nil {
		return 0, nil
	}
	r.file.Seek(0, 0)
	return io.Copy(w, r.file)
}
