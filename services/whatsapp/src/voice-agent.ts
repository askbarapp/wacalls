import pino from "pino";
import { prisma } from "@wacalls/database";
import {
  SarvamClient,
  extractSarvamApiKey,
  pcmFloatToWav,
  renderVoiceScript,
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
    if (this.stopped || this.speaking || !pcm.length) return;
    const merged = new Float32Array(this.pending.length + pcm.length);
    merged.set(this.pending);
    merged.set(pcm, this.pending.length);
    this.pending = merged;
    const energy = rms(pcm);
    if (energy > 0.018) {
      this.speakingSamples += pcm.length;
      this.silenceSamples = 0;
    } else if (this.speakingSamples > 0) {
      this.silenceSamples += pcm.length;
    }
    const speechMs = (this.speakingSamples / this.sampleRate) * 1000;
    const silenceMs = (this.silenceSamples / this.sampleRate) * 1000;
    const maxMs = (this.pending.length / this.sampleRate) * 1000;
    if ((speechMs >= 500 && silenceMs >= 750) || (speechMs >= 400 && maxMs >= 12_000)) {
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
    if (this.stopped || this.speaking) return;
    try {
      const wav = pcmFloatToWav(pcm, this.sampleRate, 1);
      const text = await this.sarvam.transcribe(wav, this.ai.language);
      if (!text || this.stopped) return;
      log.info({ callId: this.cfg.callId, text }, "callee said");
      const reply = await this.sarvam.chat(
        [
          { role: "system", content: this.systemPrompt() },
          ...this.history.slice(-12),
          { role: "user", content: text },
        ],
        {
          model: this.ai.model || undefined,
          temperature: this.ai.temperature,
          maxTokens: this.ai.maxTokens,
        },
      );
      if (!reply || this.stopped) return;
      this.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
      if (this.history.length > 16) this.history = this.history.slice(-16);
      await this.say(reply);
    } catch (err) {
      log.warn({ err, callId: this.cfg.callId }, "voice agent turn failed");
    }
  }

  private systemPrompt(): string {
    const kb = (this.ai.knowledgeBase?.documents ?? [])
      .map((d) => `### ${d.title}\n${d.content}`)
      .join("\n\n")
      .slice(0, 8000);
    const language = toBcp47(this.ai.language);
    return [
      this.ai.systemPrompt,
      `You are a live phone agent. Keep replies under 40 words, spoken and natural, in language ${language}.`,
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
    try {
      const pcm = await this.sarvam.synthesizePcm(text, {
        language: this.ai.language,
        speaker: this.ai.voice || "shubh",
        sampleRate: this.sampleRate,
      });
      if (this.stopped) return;
      const frame = 1600;
      for (let i = 0; i < pcm.length; i += frame) {
        if (this.stopped) return;
        await this.engine.sendAudio(this.cfg.callId, pcm.slice(i, i + frame));
        await sleep(Math.round((Math.min(frame, pcm.length - i) / this.sampleRate) * 1000));
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
