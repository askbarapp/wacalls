"use client";

import { callMediaWsUrl, ensureAccessToken } from "./api";

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

function upsample(input: Float32Array, fromRate: number, toRate: number, dest: Float32Array) {
  if (fromRate === toRate) {
    dest.set(input.subarray(0, Math.min(input.length, dest.length)));
    return;
  }
  const ratio = fromRate / toRate;
  for (let i = 0; i < dest.length; i += 1) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = src - i0;
    dest[i] = (input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac;
  }
}

export type CallAudioHandle = {
  setMuted: (muted: boolean) => void;
  setSpeaker: (on: boolean) => void;
  stop: () => void;
};

export async function startCallAudio(callId: string, stream?: MediaStream): Promise<CallAudioHandle> {
  const token = (await ensureAccessToken()) ?? "";

  const mic =
    stream ??
    (await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    }));

  const ctx = new AudioContext();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(mic);
  const capture = ctx.createScriptProcessor(4096, 1, 1);
  const playback = ctx.createScriptProcessor(4096, 1, 1);
  const silent = ctx.createGain();
  silent.gain.value = 0;
  const speakerGain = ctx.createGain();
  speakerGain.gain.value = 1;

  let muted = false;
  let speakerOn = true;
  const playQueue: number[] = [];
  const ws = new WebSocket(callMediaWsUrl(token, callId));
  ws.binaryType = "arraybuffer";

  ws.onmessage = (ev) => {
    const buf = ev.data instanceof ArrayBuffer ? ev.data : null;
    if (!buf || buf.byteLength < 4) return;
    const pcm = new Float32Array(buf.slice(0));
    for (let i = 0; i < pcm.length; i += 1) playQueue.push(pcm[i] ?? 0);
    if (playQueue.length > 16_000 * 4) playQueue.splice(0, playQueue.length - 16_000 * 2);
  };

  capture.onaudioprocess = (ev) => {
    if (muted || ws.readyState !== WebSocket.OPEN) return;
    const input = ev.inputBuffer.getChannelData(0);
    const pcm = downsample(input, ctx.sampleRate, 16_000);
    ws.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  };

  playback.onaudioprocess = (ev) => {
    const out = ev.outputBuffer.getChannelData(0);
    out.fill(0);
    if (!speakerOn || playQueue.length === 0) return;
    const needed = Math.ceil(out.length * (16_000 / ctx.sampleRate));
    const take = Math.min(needed, playQueue.length);
    const chunk = Float32Array.from(playQueue.splice(0, take));
    upsample(chunk, 16_000, ctx.sampleRate, out);
  };

  source.connect(capture);
  capture.connect(silent);
  silent.connect(ctx.destination);
  playback.connect(speakerGain);
  speakerGain.connect(ctx.destination);

  return {
    setMuted: (next) => {
      muted = next;
      mic.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
    },
    setSpeaker: (on) => {
      speakerOn = on;
      speakerGain.gain.value = on ? 1 : 0.08;
    },
    stop: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      try {
        capture.disconnect();
        playback.disconnect();
        source.disconnect();
        speakerGain.disconnect();
        silent.disconnect();
      } catch {
        /* ignore */
      }
      mic.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
