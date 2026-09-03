let activeLoop: { stop: () => void } | null = null;

const getCtx = (): AudioContext | null => {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try { return new AC(); } catch { return null; }
};

const playTone = (ctx: AudioContext, freq: number, duration: number, gain = 0.18) => {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.02);
  g.gain.setValueAtTime(gain, t + duration - 0.05);
  g.gain.linearRampToValueAtTime(0, t + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
};

const playBusyTone = (ctx: AudioContext) => {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = 480;
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.12, t + 0.02);
  g.gain.setValueAtTime(0.12, t + 0.48);
  g.gain.linearRampToValueAtTime(0, t + 0.5);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.55);
};

const playDisconnectTone = (ctx: AudioContext) => {
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 480;
    const t = ctx.currentTime + i * 0.25;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.01);
    g.gain.setValueAtTime(0.15, t + 0.15);
    g.gain.linearRampToValueAtTime(0, t + 0.2);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  }
};

export const sounds = {
  ring() {
    this.stop();
    const ctx = getCtx();
    if (!ctx) return;
    let cancelled = false;
    const cycle = () => {
      if (cancelled) return;
      playTone(ctx, 440, 1.0);
      playTone(ctx, 480, 1.0);
      setTimeout(cycle, 3000);
    };
    cycle();
    activeLoop = { stop: () => { cancelled = true; void ctx.close().catch(() => {}); } };
  },

  busy() {
    this.stop();
    const ctx = getCtx();
    if (!ctx) return;
    let cancelled = false;
    const cycle = () => {
      if (cancelled) return;
      playBusyTone(ctx);
      setTimeout(cycle, 600);
    };
    cycle();
    activeLoop = { stop: () => { cancelled = true; void ctx.close().catch(() => {}); } };
  },

  disconnect() {
    this.stop();
    const ctx = getCtx();
    if (!ctx) return;
    playDisconnectTone(ctx);
    setTimeout(() => void ctx.close().catch(() => {}), 1000);
  },

  stop() {
    activeLoop?.stop();
    activeLoop = null;
  },
};
