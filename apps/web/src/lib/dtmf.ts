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

/**
 * Play a standard realistic telephone ringback tone (440Hz + 480Hz)
 * while the dialer is waiting for the recipient to answer.
 */
export function startRingbackTone(): { stop: () => void } {
  const ac = audioContext();
  if (!ac) return { stop: () => {} };
  void ac.resume();

  let stopped = false;
  let interval: any = null;
  const activeNodes: Array<{ stop?: () => void; disconnect: () => void }> = [];

  const playPulse = () => {
    if (stopped) return;
    const now = ac.currentTime;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.05);
    gain.gain.setValueAtTime(0.07, now + 1.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
    gain.connect(ac.destination);

    for (const freq of [440, 480]) {
      const osc = ac.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 1.5);
      activeNodes.push(osc);
    }
    activeNodes.push(gain);
  };

  playPulse();
  interval = setInterval(() => {
    if (stopped) {
      clearInterval(interval);
      return;
    }
    playPulse();
  }, 3500);

  return {
    stop: () => {
      stopped = true;
      if (interval) clearInterval(interval);
      for (const node of activeNodes) {
        try {
          if (node.stop) node.stop();
          node.disconnect();
        } catch {
          /* ignore */
        }
      }
      activeNodes.length = 0;
    },
  };
}
