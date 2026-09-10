package media

import (
	"encoding/binary"
	"errors"
	"io"
)

var errIvfShort = errors.New("truncated IVF data")

type IvfHeader struct {
	FourCC      [4]byte
	Width       uint16
	Height      uint16
	TimebaseNum uint32
	TimebaseDen uint32
	FrameCount  uint32
}

func (h IvfHeader) FrameTimestampInc() uint32 {
	if h.TimebaseDen == 0 {
		return 6000
	}
	inc := uint32(90000) * h.TimebaseNum / h.TimebaseDen
	if inc == 0 {
		return 6000
	}
	return inc
}

func ReadIvfHeader(r io.Reader) (*IvfHeader, error) {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	if string(buf[0:4]) != "DKIF" {
		return nil, errors.New("not an IVF file")
	}
	h := &IvfHeader{
		Width:       binary.LittleEndian.Uint16(buf[12:14]),
		Height:      binary.LittleEndian.Uint16(buf[14:16]),
		TimebaseDen: binary.LittleEndian.Uint32(buf[16:20]),
		TimebaseNum: binary.LittleEndian.Uint32(buf[20:24]),
		FrameCount:  binary.LittleEndian.Uint32(buf[24:28]),
	}
	copy(h.FourCC[:], buf[8:12])
	return h, nil
}

func ReadIvfFrame(r io.Reader) (payload []byte, pts uint64, err error) {
	hdr := make([]byte, 12)
	if _, err = io.ReadFull(r, hdr); err != nil {
		return nil, 0, err
	}
	size := binary.LittleEndian.Uint32(hdr[0:4])
	pts = binary.LittleEndian.Uint64(hdr[4:12])
	if size == 0 || size > 4<<20 {
		return nil, 0, errors.New("invalid IVF frame size")
	}
	payload = make([]byte, size)
	if _, err = io.ReadFull(r, payload); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, 0, errIvfShort
		}
		return nil, 0, err
	}
	return payload, pts, nil
}
