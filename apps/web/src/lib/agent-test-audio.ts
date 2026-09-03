const TARGET_RATE = 16_000;
const SPEECH_START_MS = 500;
const SILENCE_END_MS = 750;
const MAX_UTTERANCE_MS = 12_000;
const ENERGY_GATE = 0.018;

export type CallPhase = "idle" | "starting" | "speaking" | "listening" | "hearing" | "thinking";

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    out[i] = input[Math.min(input.length - 1, Math.floor(i * ratio))] ?? 0;
  }
  return out;
}

function rms(pcm: Float32Array): number {
  if (!pcm.length) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 1) sum += (pcm[i] ?? 0) ** 2;
  return Math.sqrt(sum / pcm.length);
}

function encodeWavBase64(pcm: Float32Array, sampleRate: number): string {
  const dataBytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i += 1) {
    const s = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    view.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function wavBytes(audioBase64: string): Blob {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: "audio/wav" });
}

export type CallMicHandlers = {
  onLevel: (value: number) => void;
  onHearing: (hearing: boolean) => void;
  onUtterance: (audioBase64: string) => void;
};

/** Continuous mic capture with the same barge-in / silence rules as live WhatsApp calls. */
export class CallMicSession {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private player: HTMLAudioElement | null = null;
  private pending = new Float32Array(0);
  private speakingSamples = 0;
  private silenceSamples = 0;
  private listening = false;
  private agentTalking = false;
  private flushing = false;
  private handlers: CallMicHandlers | null = null;

  async start(handlers: CallMicHandlers) {
    this.handlers = handlers;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    this.ctx = new AudioContext();
    await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    const silent = this.ctx.createGain();
    silent.gain.value = 0;
    this.processor.onaudioprocess = (ev) => {
      this.onFrame(ev.inputBuffer.getChannelData(0), this.ctx?.sampleRate ?? 48_000);
    };
    this.source.connect(this.processor);
    this.processor.connect(silent);
    silent.connect(this.ctx.destination);
  }

  listen(on: boolean) {
    this.listening = on;
    if (!on) {
      this.resetBuffer();
      this.handlers?.onHearing(false);
    }
  }

  setAgentTalking(on: boolean) {
    this.agentTalking = on;
    if (on) {
      this.resetBuffer();
      this.handlers?.onHearing(false);
    }
  }

  async play(audioBase64: string) {
    this.stopPlayback();
    this.setAgentTalking(true);
    this.listen(false);
    const url = URL.createObjectURL(wavBytes(audioBase64));
    const audio = new Audio(url);
    this.player = audio;
    try {
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("Could not play the agent voice"));
        void audio.play().catch(reject);
      });
    } finally {
      URL.revokeObjectURL(url);
      if (this.player === audio) this.player = null;
      await sleep(400);
      this.setAgentTalking(false);
    }
  }

  stop() {
    this.listening = false;
    this.stopPlayback();
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
    this.handlers = null;
    this.resetBuffer();
  }

  private stopPlayback() {
    if (!this.player) return;
    this.player.pause();
    this.player.src = "";
    this.player = null;
  }

  private resetBuffer() {
    this.pending = new Float32Array(0);
    this.speakingSamples = 0;
    this.silenceSamples = 0;
    this.flushing = false;
  }

  private onFrame(input: Float32Array, fromRate: number) {
    if (!this.listening || this.agentTalking || this.flushing || !input.length) return;
    const pcm = downsample(input, fromRate, TARGET_RATE);
    this.handlers?.onLevel(rms(pcm));
    const merged = new Float32Array(this.pending.length + pcm.length);
    merged.set(this.pending);
    merged.set(pcm, this.pending.length);
    this.pending = merged;
    const energy = rms(pcm);
    if (energy > ENERGY_GATE) {
      this.speakingSamples += pcm.length;
      this.silenceSamples = 0;
      this.handlers?.onHearing(true);
    } else if (this.speakingSamples > 0) {
      this.silenceSamples += pcm.length;
    }
    const speechMs = (this.speakingSamples / TARGET_RATE) * 1000;
    const silenceMs = (this.silenceSamples / TARGET_RATE) * 1000;
    const maxMs = (this.pending.length / TARGET_RATE) * 1000;
    if ((speechMs >= SPEECH_START_MS && silenceMs >= SILENCE_END_MS) || (speechMs >= 400 && maxMs >= MAX_UTTERANCE_MS)) {
      const clip = this.pending;
      this.resetBuffer();
      this.flushing = true;
      this.handlers?.onHearing(false);
      this.handlers?.onUtterance(encodeWavBase64(clip, TARGET_RATE));
    }
    if (this.pending.length > TARGET_RATE * 20) {
      this.pending = this.pending.slice(-TARGET_RATE * 8);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
