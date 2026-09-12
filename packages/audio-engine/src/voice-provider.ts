import { GeminiClient, GEMINI_CHAT_MODEL, GEMINI_VOICES } from "./gemini.js";
import {
  SarvamClient,
  SARVAM_CHAT_MODEL,
  SARVAM_SPEAKERS,
  type ChatTurn,
  type SarvamTtsOptions,
  type TranscribeResult,
} from "./sarvam.js";

export type VoiceAiProviderId = "sarvam" | "gemini";

export type VoiceAiClient = {
  provider: VoiceAiProviderId;
  transcribe(wav: Buffer, language?: string): Promise<TranscribeResult>;
  chat(messages: ChatTurn[], opts?: { model?: string; temperature?: number; maxTokens?: number }): Promise<string>;
  chatStream(
    messages: ChatTurn[],
    onChunk: (chunk: string) => void,
    opts?: { model?: string; temperature?: number; maxTokens?: number; signal?: AbortSignal },
  ): Promise<string>;
  synthesizePcm(text: string, opts: SarvamTtsOptions): Promise<Float32Array>;
  synthesize(text: string, opts: SarvamTtsOptions): Promise<Buffer>;
  testConnection(): Promise<{ ok: boolean; status: number; message: string }>;
};

export function normalizeVoiceProvider(value?: string | null): VoiceAiProviderId {
  const raw = (value || "sarvam").trim().toLowerCase();
  return raw === "gemini" || raw === "google" || raw === "google-gemini" ? "gemini" : "sarvam";
}

export function defaultModelForProvider(provider: VoiceAiProviderId): string {
  return provider === "gemini" ? GEMINI_CHAT_MODEL : SARVAM_CHAT_MODEL;
}

export function defaultVoiceForProvider(provider: VoiceAiProviderId): string {
  return provider === "gemini" ? "Kore" : "aditya";
}

export function voicesForProvider(provider: VoiceAiProviderId): string[] {
  return provider === "gemini" ? [...GEMINI_VOICES] : [...SARVAM_SPEAKERS];
}

export function createVoiceAiClient(provider: string | null | undefined, apiKey: string): VoiceAiClient {
  const id = normalizeVoiceProvider(provider);
  if (id === "gemini") {
    const client = new GeminiClient(apiKey);
    return {
      provider: id,
      transcribe: (wav, language) => client.transcribe(wav, language),
      chat: (messages, opts) => client.chat(messages, opts),
      chatStream: async (messages, onChunk, opts) => {
        const full = await client.chat(messages, opts);
        onChunk(full);
        return full;
      },
      synthesizePcm: (text, opts) => client.synthesizePcm(text, opts),
      synthesize: (text, opts) => client.synthesize(text, opts),
      testConnection: () => client.testConnection(),
    };
  }
  const client = new SarvamClient(apiKey);
  return {
    provider: id,
    transcribe: (wav, language) => client.transcribe(wav, language),
    chat: (messages, opts) => client.chat(messages, opts),
    chatStream: (messages, onChunk, opts) => client.chatStream(messages, onChunk, opts),
    synthesizePcm: (text, opts) => client.synthesizePcm(text, opts),
    synthesize: (text, opts) => client.synthesize(text, opts),
    testConnection: () => client.testConnection(),
  };
}
