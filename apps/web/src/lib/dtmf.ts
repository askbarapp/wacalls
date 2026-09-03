"use client";

/** ITU-T Q.23 dual-tone frequencies for a telephone keypad. */
const DTMF: Record<string, [number, number]> = {
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477],
  "*": [941, 1209],
  "0": [941, 1336],
  "#": [941, 1477],
};

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/** Play a short keypad tone. Safe to call from a click handler (user gesture). */
export function playDialTone(digit: string) {
  const pair = DTMF[digit];
  if (!pair) return;
  const ac = audioContext();
  if (!ac) return;
  void ac.resume();
  const now = ac.currentTime;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  gain.connect(ac.destination);
  for (const freq of pair) {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.12);
    osc.onended = () => {
      try {
        osc.disconnect();
      } catch {
        /* already disconnected */
      }
    };
  }
  window.setTimeout(() => {
    try {
      gain.disconnect();
    } catch {
      /* already disconnected */
    }
  }, 180);
}
