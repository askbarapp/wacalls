import pino from "pino";
import { prisma, getContactMemory, formatMemoryForPrompt, upsertContactMemory, parseMemoryUpdate, recordIntentEvent } from "@wacalls/database";
import {
  createVoiceAiClient,
  extractGeminiApiKey,
  extractSarvamApiKey,
  pcmFloatToWav,
  renderVoiceScript,
  inferSpokenLanguage,
  splitSpokenSentences,
  toBcp47,
  normalizeVoiceProvider,
  defaultVoiceForProvider,
  buildVoiceAgentSystemPrompt,
  normalizeIntentPlaybook,
  matchIntentPlaybook,
  parseHangupTag,
  defaultHangupReply,
  defaultWrapUpReply,
  DEFAULT_MAX_CALL_DURATION_SEC,
  DEFAULT_WRAP_UP_SEC,
  type ChatTurn,
  type IntentPlaybookItem,
  type VoiceAiClient,
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

async function resolveProviderClient(organizationId: string, provider?: string | null): Promise<VoiceAiClient> {
  const id = normalizeVoiceProvider(provider);
  if (id === "gemini") {
    const row = await prisma.setting.findFirst({
      where: { organizationId, key: "gemini_api_key" },
    });
    const key = extractGeminiApiKey(row?.value) || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    if (!key) throw new Error("Google Gemini API key is missing. Add it on AI calling → API keys.");
    return createVoiceAiClient("gemini", key);
  }
  return createVoiceAiClient("sarvam", await resolveSarvamApiKey(organizationId));
}

export async function startVoiceAgent(engine: CallingEngine, cfg: AgentConfig): Promise<void> {
  await stopVoiceAgent(cfg.callId);
  const [ai, memory] = await Promise.all([
    prisma.aiConfig.findUnique({
      where: { id: cfg.aiConfigId },
      include: { knowledgeBase: { include: { documents: { take: 40 } } } },
    }),
    getContactMemory(prisma, cfg.organizationId, cfg.phone),
  ]);
  if (!ai) {
    log.warn({ callId: cfg.callId }, "AI config missing; skipping voice agent");
    return;
  }
  const client = await resolveProviderClient(cfg.organizationId, ai.provider);
  const playbook = normalizeIntentPlaybook(ai.intentPlaybook);
  const recallMode =
    ai.memoryRecallMode === "always" || ai.memoryRecallMode === "never" ? ai.memoryRecallMode : "related_only";
  const agent = new VoiceAgent(
    engine,
    cfg,
    {
      ...ai,
      intentPlaybook: playbook,
      maxCallDurationSec: ai.maxCallDurationSec ?? DEFAULT_MAX_CALL_DURATION_SEC,
      wrapUpSec: ai.wrapUpSec ?? DEFAULT_WRAP_UP_SEC,
      memoryRecallMode: recallMode,
    },
    client,
    formatMemoryForPrompt(memory, recallMode),
  );
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
  private wrappingUp = false;
  private hangupRequested = false;
  private memorySaved = false;
  private callStartedAt = 0;
  private durationTimer: ReturnType<typeof setInterval> | null = null;
  private lastMatchedIntent: string | null = null;
  private activeLanguage: string;
  private readonly sampleRate = 16_000;
  private readonly contactName: string;
  private readonly playbook: IntentPlaybookItem[];
  private readonly maxMs: number;
  private readonly wrapMs: number;

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
      maxCallDurationSec: number;
      wrapUpSec: number;
      intentPlaybook: IntentPlaybookItem[];
      knowledgeBase: { name: string; documents: Array<{ title: string; content: string }> } | null;
    },
    private readonly sarvam: VoiceAiClient,
    private readonly memoryPrompt: string,
  ) {
    this.contactName = cfg.contactName?.trim() || "there";
    this.activeLanguage = toBcp47(ai.language || "hi-IN");
    this.playbook = ai.intentPlaybook;
    this.maxMs = Math.max(30, ai.maxCallDurationSec) * 1000;
    this.wrapMs = Math.min(Math.max(5, ai.wrapUpSec), Math.floor(ai.maxCallDurationSec / 2)) * 1000;
  }

  async start() {
    this.callStartedAt = Date.now();
    this.startDurationWatch();
    const greeting =
      this.ai.greeting?.trim() ||
      `Hello ${this.contactName}, thanks for taking our call. How can I help you today?`;
    const spoken = renderVoiceScript(greeting, { name: this.contactName, phone: this.cfg.phone });
    this.history.push({ role: "assistant", content: spoken });
    await this.say(spoken);
  }

  stop() {
    this.stopped = true;
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
    void this.persistMemory(this.hangupRequested ? "caller_ended" : "call_ended");
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

  private startDurationWatch() {
    if (this.durationTimer) return;
    this.durationTimer = setInterval(() => {
      if (this.stopped || !this.callStartedAt) return;
      const elapsed = Date.now() - this.callStartedAt;
      if (!this.wrappingUp && elapsed >= this.maxMs - this.wrapMs) {
        this.wrappingUp = true;
        if (!this.speaking && !this.turnBusy) {
          void this.say(defaultWrapUpReply(this.activeLanguage));
        }
      }
      if (elapsed >= this.maxMs) void this.thankAndHangup(defaultHangupReply(this.activeLanguage));
    }, 2000);
  }

  private async thankAndHangup(spoken: string) {
    if (this.stopped || this.hangupRequested) return;
    this.hangupRequested = true;
    const line = spoken.trim() || defaultHangupReply(this.activeLanguage);
    this.history.push({ role: "assistant", content: line });
    await this.say(line);
    try {
      await this.engine.hangup(this.cfg.callId);
    } catch (err) {
      log.warn({ err, callId: this.cfg.callId }, "hangup failed");
    }
    this.stop();
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

      const matched = matchIntentPlaybook(text, this.playbook);
      if (matched) {
        this.lastMatchedIntent = matched.intent;
        void recordIntentEvent(prisma, {
          organizationId: this.cfg.organizationId,
          aiConfigId: this.cfg.aiConfigId,
          callId: this.cfg.callId,
          phone: this.cfg.phone,
          intent: matched.intent,
          action: matched.action,
          utterance: text,
        }).catch(() => undefined);
      }
      if (matched?.action === "hangup") {
        this.history.push({ role: "user", content: text });
        await this.thankAndHangup(matched.reply);
        return;
      }

      let reply: string;
      if (matched?.action === "continue" && matched.reply.trim()) {
        reply = matched.reply.trim();
      } else {
        reply = await this.sarvam.chat(
          [
            {
              role: "system",
              content: buildVoiceAgentSystemPrompt(this.ai, {
                name: this.contactName,
                phone: this.cfg.phone,
              }, {
                memory: this.memoryPrompt,
                wrappingUp: this.wrappingUp,
              }),
            },
            ...this.history.slice(-10),
            { role: "user", content: `[Speak in ${this.activeLanguage}]\n${text}` },
          ],
          {
            model: this.ai.model || undefined,
            temperature: Math.min(this.ai.temperature ?? 0.4, 0.45),
            maxTokens: Math.min(this.ai.maxTokens || 120, 96),
          },
        );
      }
      if (!reply || this.stopped) return;
      const hangupParsed = parseHangupTag(reply);
      reply = hangupParsed.spoken;
      this.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
      if (this.history.length > 14) this.history = this.history.slice(-14);
      await this.say(reply);
      if (hangupParsed.hangup || this.wrappingUp) {
        this.hangupRequested = true;
        try {
          await this.engine.hangup(this.cfg.callId);
        } catch (err) {
          log.warn({ err, callId: this.cfg.callId }, "hangup failed");
        }
        this.stop();
      }
    } catch (err) {
      log.warn({ err, callId: this.cfg.callId }, "voice agent turn failed");
    } finally {
      this.turnBusy = false;
    }
  }

  private async persistMemory(outcome: string) {
    if (this.memorySaved) return;
    this.memorySaved = true;
    if (this.history.length < 2) return;
    try {
      const transcript = this.history
        .map((t) => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`)
        .join("\n")
        .slice(0, 3500);
      const raw = await this.sarvam.chat(
        [
          {
            role: "system",
            content:
              "Summarize this phone call for future agents. Reply with lines only:\nSUMMARY: one short sentence\nFACT: short fact (0-5 lines)\nINTENT: main caller intent or none",
          },
          { role: "user", content: transcript },
        ],
        { temperature: 0.2, maxTokens: 160 },
      );
      const parsed = parseMemoryUpdate(raw || "");
      await upsertContactMemory(prisma, {
        organizationId: this.cfg.organizationId,
        phone: this.cfg.phone,
        summary: parsed.summary,
        facts: parsed.facts,
        lastIntent: parsed.lastIntent || this.lastMatchedIntent,
        lastOutcome: outcome,
        callId: this.cfg.callId,
      });
    } catch (err) {
      log.warn({ err, callId: this.cfg.callId }, "contact memory update failed");
    }
  }

  private async say(text: string) {
    if (this.stopped || !text.trim()) return;
    this.speaking = true;
    const opts = {
      language: this.activeLanguage,
      speaker: this.ai.voice || defaultVoiceForProvider(this.sarvam.provider),
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
