package main

import "testing"

func TestInboundOfferAction(t *testing.T) {
	if got := inboundOfferAction(false, false, false); got != "ignore" {
		t.Fatalf("auto-answer off should leave the phone to ring, got %s", got)
	}
	if got := inboundOfferAction(false, false, true); got != "ignore" {
		t.Fatalf("auto-answer off must not reject video, got %s", got)
	}
	if got := inboundOfferAction(true, false, true); got != "ignore-video" {
		t.Fatalf("AI auto-answer cannot take video without killing the phone call, got %s", got)
	}
	if got := inboundOfferAction(true, false, false); got != "answer" {
		t.Fatalf("audio + auto-answer should answer, got %s", got)
	}
	if got := inboundOfferAction(true, true, false); got != "reject-busy" {
		t.Fatalf("live WaCalls session should reject busy, got %s", got)
	}
}
