const WAV_HEADER = 44;

export function pcmFloatToWav(pcm: Float32Array, sampleRate = 16_000, channels = 1): Buffer {
  const samples = pcm.length;
  const dataBytes = samples * 2;
  const buf = Buffer.alloc(WAV_HEADER + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i += 1) {
    const s = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    buf.writeInt16LE(s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), WAV_HEADER + i * 2);
  }
  return buf;
}

export function wavToPcmFloat(wav: Buffer): { pcm: Float32Array; sampleRate: number; channels: number } {
  if (wav.length < WAV_HEADER || wav.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Not a WAV file");
  }
  let offset = 12;
  let sampleRate = 16_000;
  let channels = 1;
  let bits = 16;
  let dataOffset = WAV_HEADER;
  let dataBytes = wav.length - WAV_HEADER;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      channels = wav.readUInt16LE(start + 2);
      sampleRate = wav.readUInt32LE(start + 4);
      bits = wav.readUInt16LE(start + 14);
    } else if (id === "data") {
      dataOffset = start;
      dataBytes = size;
      break;
    }
    offset = start + size + (size % 2);
  }
  const sampleCount = Math.floor(dataBytes / (bits / 8));
  const pcm = new Float32Array(sampleCount);
  if (bits === 16) {
    for (let i = 0; i < sampleCount; i += 1) {
      pcm[i] = wav.readInt16LE(dataOffset + i * 2) / 0x8000;
    }
  } else if (bits === 8) {
    for (let i = 0; i < sampleCount; i += 1) {
      pcm[i] = (wav[dataOffset + i]! - 128) / 128;
    }
  } else {
    throw new Error(`Unsupported WAV bit depth ${bits}`);
  }
  return { pcm, sampleRate, channels };
}

export function wavDurationMs(wav: Buffer): number {
  const { pcm, sampleRate, channels } = wavToPcmFloat(wav);
  if (!sampleRate || !channels) return 0;
  return Math.round((pcm.length / channels / sampleRate) * 1000);
}
