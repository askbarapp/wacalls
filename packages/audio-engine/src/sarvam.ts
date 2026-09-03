import { pcmFloatToWav, wavToPcmFloat } from "./wav.js";

export const SARVAM_LANGUAGES = [
  { code: "hi-IN", label: "Hindi" },
  { code: "en-IN", label: "English (India)" },
  { code: "bn-IN", label: "Bengali" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" },
  { code: "mr-IN", label: "Marathi" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "kn-IN", label: "Kannada" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "pa-IN", label: "Punjabi" },
  { code: "od-IN", label: "Odia" },
] as const;

export const SARVAM_SPEAKERS = [
  "shubh",
  "aditya",
  "ritu",
  "priya",
  "neha",
  "rahul",
  "pooja",
  "rohan",
  "simran",
  "kavya",
  "amit",
  "dev",
  "ishita",
  "anand",
  "tanya",
] as const;

export const SARVAM_CHAT_MODEL = "sarvam-105b-conversations";
export const SARVAM_TTS_MODEL = "bulbul:v3";
export const SARVAM_STT_MODEL = "saaras:v3";

const BASE = "https://api.sarvam.ai";
const TTS_LIMIT = 2400;

export type SarvamTtsOptions = {
  language: string;
  speaker?: string;
  pace?: number;
  sampleRate?: number;
};

export type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

export function toBcp47(language: string): string {
  const raw = (language || "hi-IN").trim();
  if (raw.includes("-")) return raw;
  const map: Record<string, string> = {
    hi: "hi-IN",
    en: "en-IN",
    bn: "bn-IN",
    ta: "ta-IN",
    te: "te-IN",
    mr: "mr-IN",
    gu: "gu-IN",
    kn: "kn-IN",
    ml: "ml-IN",
    pa: "pa-IN",
    od: "od-IN",
    or: "od-IN",
  };
  return map[raw.toLowerCase()] ?? "hi-IN";
}

export function renderVoiceScript(
  body: string,
  contact: { name?: string | null; phone?: string | null; company?: string | null; email?: string | null },
): string {
  return body
    .replaceAll("{{name}}", contact.name?.trim() || "there")
    .replaceAll("{{phone}}", contact.phone ?? "")
    .replaceAll("{{company}}", contact.company?.trim() || "")
    .replaceAll("{{email}}", contact.email ?? "");
}

function splitText(text: string, max = TTS_LIMIT): string[] {
  const clean = text.trim();
  if (clean.length <= max) return [clean];
  const parts: string[] = [];
  let rest = clean;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export class SarvamClient {
  constructor(private readonly apiKey: string) {}

  private headers(json = true): Record<string, string> {
    const h: Record<string, string> = { "api-subscription-key": this.apiKey };
    if (json) h["content-type"] = "application/json";
    return h;
  }

  async synthesize(text: string, opts: SarvamTtsOptions): Promise<Buffer> {
    const chunks = splitText(text);
    const buffers: Buffer[] = [];
    for (const chunk of chunks) {
      buffers.push(await this.synthesizeChunk(chunk, opts));
    }
    if (buffers.length === 1) return buffers[0]!;
    const pcm: Float32Array[] = [];
    let sampleRate = opts.sampleRate ?? 16_000;
    for (const buf of buffers) {
      const decoded = wavToPcmFloat(buf);
      sampleRate = decoded.sampleRate;
      pcm.push(decoded.pcm);
    }
    const total = pcm.reduce((n, p) => n + p.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const p of pcm) {
      merged.set(p, offset);
      offset += p.length;
    }
    return pcmFloatToWav(merged, sampleRate, 1);
  }

  async synthesizePcm(text: string, opts: SarvamTtsOptions): Promise<Float32Array> {
    const wav = await this.synthesize(text, { ...opts, sampleRate: opts.sampleRate ?? 16_000 });
    return wavToPcmFloat(wav).pcm;
  }

  async transcribe(wav: Buffer, language?: string): Promise<string> {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "speech.wav");
    form.set("model", SARVAM_STT_MODEL);
    form.set("mode", "transcribe");
    if (language) form.set("language_code", toBcp47(language));
    const res = await fetch(`${BASE}/speech-to-text`, {
      method: "POST",
      headers: { "api-subscription-key": this.apiKey },
      body: form,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Sarvam STT failed (${res.status}): ${err.slice(0, 240)}`);
    }
    const json = (await res.json()) as { transcript?: string };
    return (json.transcript ?? "").trim();
  }

  async chat(messages: ChatTurn[], opts?: { model?: string; temperature?: number; maxTokens?: number }): Promise<string> {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: opts?.model || SARVAM_CHAT_MODEL,
        temperature: opts?.temperature ?? 0.4,
        max_tokens: opts?.maxTokens ?? 400,
        messages,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Sarvam chat failed (${res.status}): ${err.slice(0, 240)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  }

  /** Cheap authenticated ping so the UI can confirm a key is live. */
  async testConnection(): Promise<{ ok: boolean; status: number; message: string }> {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: SARVAM_CHAT_MODEL,
        temperature: 0,
        max_tokens: 8,
        messages: [{ role: "user", content: "Reply with the single word ok." }],
      }),
    });
    const raw = await res.text().catch(() => "");
    if (res.ok) {
      return { ok: true, status: res.status, message: "Connected. This Sarvam key is working." };
    }
    if (res.status === 403) {
      return {
        ok: false,
        status: 403,
        message: "Sarvam rejected this key. Copy a new api-subscription-key from dashboard.sarvam.ai.",
      };
    }
    if (res.status === 401) {
      return { ok: false, status: 401, message: "Invalid Sarvam API key." };
    }
    if (res.status === 402) {
      return {
        ok: true,
        status: 402,
        message: "Key is valid, but Sarvam credits are empty. Top up on dashboard.sarvam.ai.",
      };
    }
    if (res.status === 429) {
      return {
        ok: true,
        status: 429,
        message: "Key works, but Sarvam rate-limited this test. Try again in a minute.",
      };
    }
    const snippet = raw.replace(/\s+/g, " ").slice(0, 180);
    return {
      ok: false,
      status: res.status,
      message: snippet ? `Sarvam test failed (${res.status}): ${snippet}` : `Sarvam test failed (${res.status}).`,
    };
  }

  private async synthesizeChunk(text: string, opts: SarvamTtsOptions): Promise<Buffer> {
    const res = await fetch(`${BASE}/text-to-speech`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        text,
        language_code: toBcp47(opts.language),
        speaker: (opts.speaker || "shubh").toLowerCase(),
        model: SARVAM_TTS_MODEL,
        pace: Math.min(2, Math.max(0.5, opts.pace ?? 1)),
        speech_sample_rate: opts.sampleRate ?? 16_000,
        output_audio_codec: "wav",
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Sarvam TTS failed (${res.status}): ${err.slice(0, 240)}`);
    }
    const json = (await res.json()) as { audios?: string[] };
    const b64 = (json.audios ?? []).join("");
    if (!b64) throw new Error("Sarvam TTS returned empty audio");
    return Buffer.from(b64, "base64");
  }
}

export function extractSarvamApiKey(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of ["apiKey", "key", "value"]) {
      if (typeof rec[key] === "string" && rec[key].trim()) return rec[key].trim();
    }
  }
  return "";
}
