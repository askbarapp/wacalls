package signaling

import "testing"

func TestVideoMediaNodeMatchesPhoneH264(t *testing.T) {
	n := videoMediaNode("portrait")
	if n.Tag != "video" {
		t.Fatalf("tag %q", n.Tag)
	}
	if n.Attrs["enc"] != "h.264" {
		t.Fatalf("enc=%q want h.264 (phone video token, not vp8/h264)", n.Attrs["enc"])
	}
	if n.Attrs["dec"] != "H264,H265,AV1" {
		t.Fatalf("dec=%q", n.Attrs["dec"])
	}
	if n.Attrs["screen_width"] != "480" || n.Attrs["screen_height"] != "640" {
		t.Fatalf("portrait size %s x %s", n.Attrs["screen_width"], n.Attrs["screen_height"])
	}
	land := videoMediaNode("landscape")
	if land.Attrs["screen_width"] != "640" || land.Attrs["screen_height"] != "480" {
		t.Fatalf("landscape size %s x %s", land.Attrs["screen_width"], land.Attrs["screen_height"])
	}
}
