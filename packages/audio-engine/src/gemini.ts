import { pcmFloatToWav } from "./wav.js";
import type { ChatTurn, TranscribeResult } from "./sarvam.js";
import { inferSpokenLanguage, toBcp47 } from "./sarvam.js";

export const GEMINI_CHAT_MODEL = "gemini-3.6-flash";
export const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";
export const GEMINI_STT_MODEL = "gemini-3.6-flash";

/** Remap retired Gemini IDs so saved agents keep working for new API keys. */
export function resolveGeminiModel(model?: string | null): string {
  const id = (model || "").trim();
  if (!id) return GEMINI_CHAT_MODEL;
  if (id === "gemini-2.5-flash" || id === "models/gemini-2.5-flash") return GEMINI_CHAT_MODEL;
  if (id.includes("2.5-flash-preview-tts") || id === "gemini-2.5-flash-preview-tts") {
    return GEMINI_TTS_MODEL;
  }
  return id.replace(/^models\//, "");
}

export const GEMINI_VOICES = [
  "Kore",
  "Puck",
  "Charon",
  "Fenrir",
  "Aoede",
  "Leda",
  "Orus",
  "Zephyr",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
] as const;

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiTtsOptions = {
  language: string;
  speaker?: string;
  pace?: number;
  sampleRate?: number;
};

function pcm16leToFloat32(buf: Buffer): Float32Array {
  const n = Math.floor(buf.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = buf.readInt16LE(i * 2) / 0x8000;
  }
  return out;
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!input.length || fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = src - i0;
    out[i] = (input[i0] ?? 0) * (1 - t) + (input[i1] ?? 0) * t;
  }
  return out;
}

function parseAudioMimeRate(mime: string | undefined, fallback = 24_000): number {
  if (!mime) return fallback;
  const m = /rate=(\d+)/i.exec(mime);
  return m ? Number(m[1]) : fallback;
}

export function extractGeminiApiKey(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of ["apiKey", "key", "value"]) {
      if (typeof rec[key] === "string" && rec[key].trim()) return rec[key].trim();
    }
  }
  return "";
}

export class GeminiClient {
  constructor(private readonly apiKey: string) {}

  private url(model: string, method = "generateContent") {
    return `${BASE}/models/${encodeURIComponent(model)}:${method}?key=${encodeURIComponent(this.apiKey)}`;
  }

  async transcribe(wav: Buffer, language?: string): Promise<TranscribeResult> {
    const hint =
      language && language !== "unknown" && language !== "auto"
        ? ` Prefer language ${toBcp47(language)} when unsure.`
        : " Detect the spoken language automatically.";
    const res = await fetch(this.url(GEMINI_STT_MODEL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Transcribe this phone-call audio accurately. Return only the spoken words, no commentary.${hint}`,
              },
              {
                inlineData: {
                  mimeType: "audio/wav",
                  data: wav.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 512 },
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Gemini STT failed (${res.status}): ${err.slice(0, 240)}`);
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const transcript = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join(" ")
      .trim();
    const languageCode = inferSpokenLanguage(transcript, null, language || "hi-IN");
    return { transcript, languageCode };
  }

  async chat(
    messages: ChatTurn[],
    opts?: { model?: string; temperature?: number; maxTokens?: number },
  ): Promise<string> {
    const system = messages.find((m) => m.role === "system")?.content?.trim() || "";
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    // Gemini requires alternating user/model; merge consecutive same roles.
    const merged: typeof contents = [];
    for (const turn of contents) {
      const last = merged[merged.length - 1];
      if (last && last.role === turn.role) {
        last.parts[0]!.text = `${last.parts[0]!.text}\n${turn.parts[0]!.text}`;
      } else {
        merged.push({ role: turn.role, parts: [{ text: turn.parts[0]!.text }] });
      }
    }
    if (merged[0]?.role === "model") {
      merged.unshift({ role: "user", parts: [{ text: "Continue the phone call." }] });
    }
    const res = await fetch(this.url(resolveGeminiModel(opts?.model)), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(system
          ? { systemInstruction: { parts: [{ text: system }] } }
          : {}),
        contents: merged,
        generationConfig: {
          temperature: opts?.temperature ?? 0.4,
          maxOutputTokens: opts?.maxTokens ?? 96,
        },
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Gemini chat failed (${res.status}): ${err.slice(0, 240)}`);
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join(" ")
      .trim();
  }

  async synthesize(text: string, opts: GeminiTtsOptions): Promise<Buffer> {
    const pcm = await this.synthesizePcm(text, opts);
    return pcmFloatToWav(pcm, opts.sampleRate ?? 16_000, 1);
  }

  async synthesizePcm(text: string, opts: GeminiTtsOptions): Promise<Float32Array> {
    const clean = text.trim();
    if (!clean) return new Float32Array(0);
    const voice = (opts.speaker || "Kore").trim() || "Kore";
    const language = toBcp47(opts.language || "en-IN");
    const paceHint =
      opts.pace && opts.pace !== 1
        ? opts.pace > 1
          ? " Speak a bit faster."
          : " Speak a bit slower."
        : "";
    const prompt = `Speak the following naturally for a phone call in ${language}.${paceHint}\n\n${clean}`;
    const res = await fetch(this.url(GEMINI_TTS_MODEL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice },
            },
          },
        },
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Gemini TTS failed (${res.status}): ${err.slice(0, 240)}`);
    }
    const json = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }> };
      }>;
    };
    const part = json.candidates?.[0]?.content?.parts?.[0];
    const inline = part?.inlineData || part?.inline_data;
    const b64 = inline && "data" in inline ? inline.data : undefined;
    const mime =
      inline && "mimeType" in inline && typeof inline.mimeType === "string"
        ? inline.mimeType
        : inline && "mime_type" in inline && typeof inline.mime_type === "string"
          ? inline.mime_type
          : undefined;
    if (!b64) throw new Error("Gemini TTS returned empty audio");
    const raw = Buffer.from(b64, "base64");
    const rate = parseAudioMimeRate(mime, 24_000);
    const float = pcm16leToFloat32(raw);
    const target = opts.sampleRate ?? 16_000;
    return resampleLinear(float, rate, target);
  }

  async testConnection(): Promise<{ ok: boolean; status: number; message: string }> {
    const res = await fetch(this.url(GEMINI_CHAT_MODEL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Reply with the single word ok." }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 8 },
      }),
    });
    const raw = await res.text().catch(() => "");
    if (res.ok) {
      return { ok: true, status: res.status, message: "Connected. This Google Gemini key is working." };
    }
    if (res.status === 400 || res.status === 403) {
      return {
        ok: false,
        status: res.status,
        message: "Gemini rejected this key. Create an API key at aistudio.google.com/apikey.",
      };
    }
    if (res.status === 401) {
      return { ok: false, status: 401, message: "Invalid Google Gemini API key." };
    }
    if (res.status === 429) {
      return {
        ok: true,
        status: 429,
        message: "Key works, but Gemini rate-limited this test. Try again in a minute.",
      };
    }
    const snippet = raw.replace(/\s+/g, " ").slice(0, 180);
    return {
      ok: false,
      status: res.status,
      message: snippet ? `Gemini test failed (${res.status}): ${snippet}` : `Gemini test failed (${res.status}).`,
    };
  }
}
