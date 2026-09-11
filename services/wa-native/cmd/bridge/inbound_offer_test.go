package main

import "testing"

func TestInboundOfferAction(t *testing.T) {
	if got := inboundOfferAction(false, false, false, false); got != "ignore" {
		t.Fatalf("auto-answer off should leave the phone to ring, got %s", got)
	}
	if got := inboundOfferAction(false, false, true, false); got != "ignore-video" {
		t.Fatalf("video call without clip should leave phone to ring, got %s", got)
	}
	if got := inboundOfferAction(false, false, true, true); got != "answer" {
		t.Fatalf("video call with clip should answer, got %s", got)
	}
	if got := inboundOfferAction(true, false, true, false); got != "answer" {
		t.Fatalf("AI auto-answer should answer incoming calls even if video, got %s", got)
	}
	if got := inboundOfferAction(true, false, false, false); got != "answer" {
		t.Fatalf("audio + auto-answer should answer, got %s", got)
	}
	if got := inboundOfferAction(true, true, false, false); got != "reject-busy" {
		t.Fatalf("live WaCalls session should reject busy, got %s", got)
	}
}
