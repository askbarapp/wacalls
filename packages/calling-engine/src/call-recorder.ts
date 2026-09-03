import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MAX_SAMPLES = 16_000 * 60 * 30;

function toInt16(sample: number) {
  const clipped = Math.max(-1, Math.min(1, sample));
  return clipped < 0 ? Math.round(clipped * 0x8000) : Math.round(clipped * 0x7fff);
}

/**
 * Mixes uplink (browser mic) and downlink (WhatsApp callee) PCM into a 16 kHz
 * mono WAV. Placement is wall-clock based so the two sides stay roughly aligned.
 */
export class CallRecorder {
  readonly sampleRate: number;
  #startedAt = 0;
  #uplink = new Int16Array(MAX_SAMPLES);
  #downlink = new Int16Array(MAX_SAMPLES);
  #end = 0;
  #active = false;

  constructor(sampleRate = 16_000) {
    this.sampleRate = sampleRate;
  }

  get active() {
    return this.#active;
  }

  start() {
    if (this.#active) return;
    this.#startedAt = Date.now();
    this.#end = 0;
    this.#active = true;
  }

  addUplink(pcm: Float32Array) {
    this.#write(this.#uplink, pcm);
  }

  addDownlink(pcm: Float32Array) {
    this.#write(this.#downlink, pcm);
  }

  finalize(filePath: string): { samples: number; byteSize: number } | null {
    if (!this.#active && this.#end === 0) return null;
    this.#active = false;
    const samples = this.#end;
    if (samples < this.sampleRate / 5) return null;
    const dataBytes = samples * 2;
    const wav = Buffer.alloc(44 + dataBytes);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + dataBytes, 4);
    wav.write("WAVE", 8);
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(this.sampleRate, 24);
    wav.writeUInt32LE(this.sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(dataBytes, 40);
    for (let i = 0; i < samples; i += 1) {
      const mixed = Math.max(-32768, Math.min(32767, (this.#uplink[i] ?? 0) + (this.#downlink[i] ?? 0)));
      wav.writeInt16LE(mixed, 44 + i * 2);
    }
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, wav);
    return { samples, byteSize: wav.byteLength };
  }

  #write(track: Int16Array, pcm: Float32Array) {
    if (!this.#active || !pcm?.length) return;
    const offset = Math.min(
      MAX_SAMPLES - 1,
      Math.max(0, Math.floor(((Date.now() - this.#startedAt) * this.sampleRate) / 1000)),
    );
    const n = Math.min(pcm.length, MAX_SAMPLES - offset);
    for (let i = 0; i < n; i += 1) {
      track[offset + i] = toInt16(pcm[i] ?? 0);
    }
    this.#end = Math.max(this.#end, offset + n);
  }
}
