import pino from "pino";
import { prisma } from "@wacalls/database";
import {
  SarvamClient,
  extractSarvamApiKey,
  pcmFloatToWav,
  renderVoiceScript,
  inferSpokenLanguage,
  splitSpokenSentences,
  toBcp47,
  type ChatTurn,
} from "@wacalls/audio-engine";
import type { CallingEngine } from "@wacalls/calling-engine";

const log = pino({ name: "voice-agent", level: process.env.LOG_LEVEL ?? "info" });

const agents = new Map<string, VoiceAgent>();

type AgentConfig = {
  callId: string;
  engineCallId: string;
  organizationId: string;
  contactName?: string | null;
  phone: string;
  aiConfigId: string;
};

export async function resolveSarvamApiKey(organizationId: string): Promise<string> {
  const row = await prisma.setting.findFirst({
    where: { organizationId, key: "sarvam_api_key" },
  });
  const fromOrg = extractSarvamApiKey(row?.value);
  const key = fromOrg || process.env.SARVAM_API_KEY || process.env.AI_API_KEY || "";
  if (!key) {
    throw new Error("Sarvam AI API key is missing. Add it in AI calling settings or SARVAM_API_KEY.");
  }
  return key;
}

export async function startVoiceAgent(engine: CallingEngine, cfg: AgentConfig): Promise<void> {
  await stopVoiceAgent(cfg.callId);
  const ai = await prisma.aiConfig.findUnique({
    where: { id: cfg.aiConfigId },
    include: { knowledgeBase: { include: { documents: { take: 40 } } } },
  });
  if (!ai) {
    log.warn({ callId: cfg.callId }, "AI config missing; skipping voice agent");
    return;
  }
  const key = await resolveSarvamApiKey(cfg.organizationId);
  const agent = new VoiceAgent(engine, cfg, ai, new SarvamClient(key));
  agents.set(cfg.callId, agent);
  agents.set(cfg.engineCallId, agent);
  void agent.start();
}

export function pushAgentDownlink(callId: string, pcm: Float32Array) {
  agents.get(callId)?.onDownlink(pcm);
}

export async function stopVoiceAgent(callId: string) {
  const agent = agents.get(callId);
  if (!agent) return;
  agent.stop();
  for (const [key, value] of agents) {
    if (value === agent) agents.delete(key);
  }
}

class VoiceAgent {
  private stopped = false;
  private speaking = false;
  private history: ChatTurn[] = [];
  private pending = new Float32Array(0);
  private speakingSamples = 0;
  private silenceSamples = 0;
  private turnBusy = false;
  private activeLanguage: string;
  private readonly sampleRate = 16_000;
  private readonly contactName: string;

  constructor(
    private readonly engine: CallingEngine,
    private readonly cfg: AgentConfig,
    private readonly ai: {
      systemPrompt: string;
      greeting: string | null;
      objective: string | null;
      questions: string | null;
      disallowed: string | null;
      language: string;
      voice: string | null;
      model: string;
      temperature: number;
      maxTokens: number;
      knowledgeBase: { name: string; documents: Array<{ title: string; content: string }> } | null;
    },
    private readonly sarvam: SarvamClient,
  ) {
    this.contactName = cfg.contactName?.trim() || "there";
    this.activeLanguage = toBcp47(ai.language || "hi-IN");
  }

  async start() {
    const greeting =
      this.ai.greeting?.trim() ||
      `Hello ${this.contactName}, thanks for taking our call. How can I help you today?`;
    await this.say(renderVoiceScript(greeting, { name: this.contactName, phone: this.cfg.phone }));
  }

  stop() {
    this.stopped = true;
  }

  onDownlink(pcm: Float32Array) {
    if (this.stopped || this.speaking || this.turnBusy || !pcm.length) return;
    const merged = new Float32Array(this.pending.length + pcm.length);
    merged.set(this.pending);
    merged.set(pcm, this.pending.length);
    this.pending = merged;
    const energy = rms(pcm);
    if (energy > 0.015) {
      this.speakingSamples += pcm.length;
      this.silenceSamples = 0;
    } else if (this.speakingSamples > 0) {
      this.silenceSamples += pcm.length;
    }
    const speechMs = (this.speakingSamples / this.sampleRate) * 1000;
    const silenceMs = (this.silenceSamples / this.sampleRate) * 1000;
    const maxMs = (this.pending.length / this.sampleRate) * 1000;
    if ((speechMs >= 280 && silenceMs >= 380) || (speechMs >= 300 && maxMs >= 8_000)) {
      const clip = this.pending;
      this.pending = new Float32Array(0);
      this.speakingSamples = 0;
      this.silenceSamples = 0;
      void this.handleUtterance(clip);
    }
    if (this.pending.length > this.sampleRate * 20) {
      this.pending = this.pending.slice(-this.sampleRate * 8);
    }
  }

  private async handleUtterance(pcm: Float32Array) {
    if (this.stopped || this.speaking || this.turnBusy) return;
    this.turnBusy = true;
    try {
      const wav = pcmFloatToWav(pcm, this.sampleRate, 1);
      const stt = await this.sarvam.transcribe(wav, "unknown");
      const text = stt.transcript;
      if (!text || this.stopped) return;
      this.activeLanguage = inferSpokenLanguage(text, stt.languageCode, this.activeLanguage);
      log.info({ callId: this.cfg.callId, text, language: this.activeLanguage }, "callee said");
      const reply = await this.sarvam.chat(
        [
          { role: "system", content: this.systemPrompt() },
          ...this.history.slice(-10),
          { role: "user", content: `[Speak in ${this.activeLanguage}]\n${text}` },
        ],
        {
          model: this.ai.model || undefined,
          temperature: Math.min(this.ai.temperature ?? 0.4, 0.45),
          maxTokens: Math.min(this.ai.maxTokens || 120, 96),
        },
      );
      if (!reply || this.stopped) return;
      this.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
      if (this.history.length > 14) this.history = this.history.slice(-14);
      await this.say(reply);
    } catch (err) {
      log.warn({ err, callId: this.cfg.callId }, "voice agent turn failed");
    } finally {
      this.turnBusy = false;
    }
  }

  private systemPrompt(): string {
    const kb = (this.ai.knowledgeBase?.documents ?? [])
      .map((d) => `### ${d.title}\n${d.content}`)
      .join("\n\n")
      .slice(0, 4500);
    const language = toBcp47(this.ai.language);
    return [
      this.ai.systemPrompt,
      `You are a live phone agent. Sound human and brief. Mirror the caller's language (Hindi/English/Hinglish).`,
      `Keep replies under 25 words. Default greeting language: ${language}.`,
      `Caller name: ${this.contactName}. Phone: ${this.cfg.phone}.`,
      this.ai.objective ? `Objective: ${this.ai.objective}` : "",
      this.ai.questions ? `Questions to cover if relevant: ${this.ai.questions}` : "",
      this.ai.disallowed ? `Never do: ${this.ai.disallowed}` : "",
      kb ? `Knowledge base (${this.ai.knowledgeBase?.name}):\n${kb}` : "",
      "If you do not know, say you will arrange a callback. Do not invent facts outside the knowledge base.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async say(text: string) {
    if (this.stopped || !text.trim()) return;
    this.speaking = true;
    const opts = {
      language: this.activeLanguage,
      speaker: this.ai.voice || "shubh",
      sampleRate: this.sampleRate,
      pace: 1.08,
    };
    try {
      const sentences = splitSpokenSentences(text);
      let nextPcm: Promise<Float32Array> | null = sentences[0]
        ? this.sarvam.synthesizePcm(sentences[0]!, opts)
        : null;
      for (let i = 0; i < sentences.length; i += 1) {
        if (this.stopped) return;
        const pcm = await (nextPcm ?? this.sarvam.synthesizePcm(sentences[i]!, opts));
        const upcoming = sentences[i + 1];
        nextPcm = upcoming ? this.sarvam.synthesizePcm(upcoming, opts) : null;
        const frame = 1600;
        for (let j = 0; j < pcm.length; j += frame) {
          if (this.stopped) return;
          await this.engine.sendAudio(this.cfg.callId, pcm.slice(j, j + frame));
          await sleep(Math.round((Math.min(frame, pcm.length - j) / this.sampleRate) * 1000));
        }
      }
    } catch (err) {
      log.warn({ err, callId: this.cfg.callId }, "voice agent TTS failed");
    } finally {
      this.speaking = false;
    }
  }
}

function rms(pcm: Float32Array): number {
  if (!pcm.length) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 1) sum += (pcm[i] ?? 0) ** 2;
  return Math.sqrt(sum / pcm.length);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
