import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { wavDurationMs } from "@wacalls/audio-engine";

function ffprobeDurationMs(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `ffprobe exited ${code}`));
        return;
      }
      const sec = Number(out.trim());
      if (!Number.isFinite(sec) || sec <= 0) {
        reject(new Error("Could not read audio duration"));
        return;
      }
      resolve(Math.round(sec * 1000));
    });
  });
}

/** Prefer ffprobe; fall back to WAV header parse for .wav files. */
export async function probeAudioDurationMs(filePath: string, ext: string): Promise<number> {
  try {
    return await ffprobeDurationMs(filePath);
  } catch {
    if (ext.toLowerCase() === ".wav") {
      const buf = await readFile(filePath);
      const ms = wavDurationMs(buf);
      if (ms > 0) return ms;
    }
    throw new Error("Could not read audio duration");
  }
}
