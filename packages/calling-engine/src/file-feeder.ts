import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

/**
 * Decode a file (or lavfi source) to 16-bit-paced f32le PCM and emit chunks
 * in realtime so the WASM mic pump can play it into a live call.
 */
export class FileAudioFeeder extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = Buffer.alloc(0);
  private queue: Float32Array[] = [];
  private stopped = false;

  constructor(
    private readonly sampleRate: number,
    private readonly channels: number,
    private readonly framesPerChunk: number,
    private readonly source: string,
    private readonly onChunk: (pcm: Float32Array) => void,
  ) {
    super();
  }

  start() {
    if (this.proc || this.stopped) return;
    const chunkSamples = this.framesPerChunk * this.channels;
    const chunkBytes = chunkSamples * Float32Array.BYTES_PER_ELEMENT;
    const intervalMs = (this.framesPerChunk / this.sampleRate) * 1000;
    const input = this.source === "silence"
      ? ["-f", "lavfi", "-i", `aevalsrc=0:d=3600:s=${this.sampleRate}`]
      : ["-i", this.source];
    this.proc = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-thread_queue_size",
      "512",
      ...input,
      "-f",
      "f32le",
      "-ac",
      String(this.channels),
      "-ar",
      String(this.sampleRate),
      "pipe:1",
    ]);
    this.proc.stdout.on("data", (chunk: Buffer) => {
      this.pending = Buffer.concat([this.pending, chunk]);
      while (this.pending.length >= chunkBytes) {
        const frame = this.pending.subarray(0, chunkBytes);
        this.pending = this.pending.subarray(chunkBytes);
        const copy = Buffer.from(frame);
        this.queue.push(new Float32Array(copy.buffer, copy.byteOffset, chunkSamples));
      }
    });
    this.proc.stderr.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) this.emit("log", msg);
    });
    this.proc.on("exit", () => {
      this.proc = null;
    });
    this.schedule(chunkSamples, intervalMs);
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      this.proc?.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    this.proc = null;
    this.queue = [];
    this.pending = Buffer.alloc(0);
  }

  private schedule(chunkSamples: number, intervalMs: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopped) return;
      const next = this.queue.shift();
      if (next) {
        this.onChunk(next);
        this.schedule(chunkSamples, intervalMs);
        return;
      }
      if (this.proc) {
        this.schedule(chunkSamples, intervalMs);
        return;
      }
      this.emit("ended");
    }, intervalMs);
  }
}
