import { Redis } from "ioredis";
import pino from "pino";
import { Queue } from "bullmq";
import {
  prisma,
  listOpenSlots,
  slotsPrompt,
  parseBookTag,
  bookAppointment,
  appendCallTranscriptTurns,
  getContactMemory,
  formatMemoryForPrompt,
  upsertContactMemory,
  parseMemoryUpdate,
  recordIntentEvent,
  type ContactMemoryRecord,
  type OpenSlot,
} from "@wacalls/database";
import {
  extractSarvamApiKey,
  extractGeminiApiKey,
  pcmFloatToWav,
  buildVoiceAgentGreeting,
  buildVoiceAgentSystemPrompt,
  inferSpokenLanguage,
  splitSpokenSentences,
  toBcp47,
  createVoiceAiClient,
  normalizeVoiceProvider,
  defaultVoiceForProvider,
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
import { QUEUE_NAMES } from "@wacalls/queue";

const log = pino({ name: "voice-agent", level: process.env.LOG_LEVEL ?? "info" });

export type AgentHandle = {
  stop: () => void;
  onAnswered: () => void;
};

function pcmFromBuffer(message: Buffer): Float32Array {
  const copy = message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength);
  return new Float32Array(copy);
}

function pcmToBuffer(pcm: Float32Array): Buffer {
  const buf = Buffer.alloc(pcm.length * 4);
  for (let i = 0; i < pcm.length; i += 1) {
    buf.writeFloatLE(pcm[i] ?? 0, i * 4);
  }
  return buf;
}

async function resolveProviderKey(organizationId: string, provider: string) {
  const id = normalizeVoiceProvider(provider);
  if (id === "gemini") {
    const row = await prisma.setting.findFirst({
      where: { organizationId, key: "gemini_api_key" },
    });
    const key = extractGeminiApiKey(row?.value) || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    if (!key) throw new Error("Gemini API key missing");
    return { provider: id, key };
  }
  const row = await prisma.setting.findFirst({
    where: { organizationId, key: "sarvam_api_key" },
  });
  const key = extractSarvamApiKey(row?.value) || process.env.SARVAM_API_KEY || process.env.AI_API_KEY || "";
  if (!key) throw new Error("Sarvam API key missing");
  return { provider: id, key };
}

export async function startNativeVoiceAgent(input: {
  callId: string;
  organizationId: string;
  phone: string;
  contactName?: string | null;
  aiConfigId: string;
  redisUrl: string;
  whatsappUrl: string;
  internalToken: string;
  deferGreeting?: boolean;
  maxCallDurationSec?: number | null;
}): Promise<AgentHandle | null> {
  const [ai, call, memory] = await Promise.all([
    prisma.aiConfig.findUnique({
      where: { id: input.aiConfigId },
      include: { knowledgeBase: { include: { documents: { take: 40 } } } },
    }),
    prisma.call.findUnique({
      where: { id: input.callId },
      include: { campaign: { select: { maxCallDurationSec: true } } },
    }),
    getContactMemory(prisma, input.organizationId, input.phone),
  ]);
  if (!ai) {
    log.warn({ callId: input.callId }, "AI config missing; skipping voice agent");
    return null;
  }
  let voiceClient: VoiceAiClient;
  try {
    const resolved = await resolveProviderKey(input.organizationId, ai.provider);
    voiceClient = createVoiceAiClient(resolved.provider, resolved.key);
  } catch (err) {
    log.warn({ err, callId: input.callId, provider: ai.provider }, "AI provider key missing; skipping voice agent");
    return null;
  }

  const playbook = normalizeIntentPlaybook(ai.intentPlaybook);
  const recallMode =
    ai.memoryRecallMode === "always" || ai.memoryRecallMode === "never" ? ai.memoryRecallMode : "related_only";
  const durationSec =
    call?.campaign?.maxCallDurationSec ??
    input.maxCallDurationSec ??
    ai.maxCallDurationSec ??
    DEFAULT_MAX_CALL_DURATION_SEC;
  const slots = await listOpenSlots(prisma, ai.id);
  const agent = new NativeVoiceAgent(
    {
      ...input,
      channelId: call?.channelId ?? "",
      contactId: call?.contactId ?? null,
    },
    {
      ...ai,
      intentPlaybook: playbook,
      maxCallDurationSec: durationSec,
      wrapUpSec: ai.wrapUpSec ?? DEFAULT_WRAP_UP_SEC,
      memoryRecallMode: recallMode,
    },
    voiceClient,
    slots,
    memory,
  );
  const sub = new Redis(input.redisUrl, { maxRetriesPerRequest: null });
  const channel = `wacalls:pcm:${input.callId}`;
  let stopped = false;
  sub.on("error", (err) => log.warn({ err: err.message, callId: input.callId }, "pcm redis error"));
  sub.on("messageBuffer", (_ch, message) => {
    agent.onDownlink(pcmFromBuffer(message));
  });
  await sub.subscribe(channel);
  if (!input.deferGreeting) void agent.greet();
  return {
    onAnswered: () => {
      void agent.greet();
    },
    stop: () => {
      agent.stop();
      if (stopped) return;
      stopped = true;
      void sub.quit().catch(() => undefined);
    },
  };
}

class NativeVoiceAgent {
  private stopped = false;
  private greeted = false;
  private speaking = false;
  private interrupt = false;
  private history: ChatTurn[] = [];
  private pending = new Float32Array(0);
  private speakingSamples = 0;
  private silenceSamples = 0;
  private bargeSamples = 0;
  private booked = false;
  private activeLanguage: string;
  private turnBusy = false;
  private wrappingUp = false;
  private hangupRequested = false;
  private memorySaved = false;
  private callStartedAt = 0;
  private durationTimer: ReturnType<typeof setInterval> | null = null;
  private lastMatchedIntent: string | null = null;
  private readonly sampleRate = 16_000;
  private readonly contactName: string;
  private readonly playbook: IntentPlaybookItem[];
  private readonly maxMs: number;
  private readonly wrapMs: number;
  private readonly memoryPrompt: string;

  constructor(
    private readonly cfg: {
      callId: string;
      organizationId: string;
      phone: string;
      contactName?: string | null;
      channelId: string;
      contactId: string | null;
      whatsappUrl: string;
      internalToken: string;
      redisUrl: string;
    },
    private readonly ai: {
      id: string;
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
      appointmentMessage: string | null;
      maxCallDurationSec: number;
      wrapUpSec: number;
      memoryRecallMode: "related_only" | "always" | "never";
      intentPlaybook: IntentPlaybookItem[];
      knowledgeBase: { name: string; documents: Array<{ title: string; content: string }> } | null;
    },
    private readonly sarvam: VoiceAiClient,
    private readonly slots: OpenSlot[],
    memory: ContactMemoryRecord | null,
  ) {
    this.contactName = cfg.contactName?.trim() || "there";
    this.activeLanguage = toBcp47(ai.language || "hi-IN");
    this.playbook = ai.intentPlaybook;
    this.maxMs = Math.max(30, ai.maxCallDurationSec) * 1000;
    this.wrapMs = Math.min(Math.max(5, ai.wrapUpSec), Math.floor(ai.maxCallDurationSec / 2)) * 1000;
    this.memoryPrompt = formatMemoryForPrompt(memory, ai.memoryRecallMode);
  }

  async greet() {
    if (this.greeted || this.stopped) return;
    this.greeted = true;
    this.callStartedAt = Date.now();
    this.startDurationWatch();
    const greeting = buildVoiceAgentGreeting(this.ai.greeting, {
      name: this.contactName,
      phone: this.cfg.phone,
    });
    this.history.push({ role: "assistant", content: greeting });
    void this.saveTurns([{ role: "assistant", text: greeting }]);
    await this.say(greeting);
  }

  stop() {
    this.stopped = true;
    this.interrupt = true;
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
    void this.persistMemory(this.hangupRequested ? "caller_ended" : "call_ended");
  }

  onDownlink(pcm: Float32Array) {
    if (this.stopped || !pcm.length) return;
    if (this.speaking) {
      const energy = rms(pcm);
      if (energy > 0.028) this.bargeSamples += pcm.length;
      else this.bargeSamples = 0;
      if (this.bargeSamples >= this.sampleRate * 0.32) {
        this.interrupt = true;
        this.speaking = false;
        this.bargeSamples = 0;
        this.pending = new Float32Array(pcm);
        this.speakingSamples = pcm.length;
        this.silenceSamples = 0;
      }
      return;
    }
    if (this.turnBusy) return;
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
        log.info({ callId: this.cfg.callId, elapsed }, "AI call entering wrap-up");
        if (!this.speaking && !this.turnBusy) {
          void this.beginWrapUp();
        }
      }
      if (elapsed >= this.maxMs) {
        void this.forceHangup("duration");
      }
    }, 2000);
  }

  private async beginWrapUp() {
    if (this.stopped || this.hangupRequested) return;
    const line = defaultWrapUpReply(this.activeLanguage);
    this.history.push({ role: "assistant", content: line });
    void this.saveTurns([{ role: "assistant", text: line }]);
    await this.say(line);
  }

  private async forceHangup(reason: "duration" | "intent" | "tag") {
    if (this.stopped || this.hangupRequested) return;
    this.hangupRequested = true;
    log.info({ callId: this.cfg.callId, reason }, "AI call hangup");
    const line = defaultHangupReply(this.activeLanguage);
    try {
      await this.say(line);
    } catch {
      /* still hang up */
    }
    await this.requestHangup();
    this.stop();
  }

  private async thankAndHangup(spoken: string) {
    if (this.stopped || this.hangupRequested) return;
    this.hangupRequested = true;
    const line = spoken.trim() || defaultHangupReply(this.activeLanguage);
    this.history.push({ role: "assistant", content: line });
    void this.saveTurns([{ role: "assistant", text: line }]);
    await this.say(line);
    await this.requestHangup();
    this.stop();
  }

  private async requestHangup() {
    try {
      await fetch(`${this.cfg.whatsappUrl}/internal/calls/${this.cfg.callId}/hangup`, {
        method: "POST",
        headers: {
          "x-internal-token": this.cfg.internalToken,
          "content-type": "application/json",
        },
        body: "{}",
      });
    } catch (err) {
      log.warn({ err, callId: this.cfg.callId }, "hangup request failed");
    }
  }

  private async handleUtterance(pcm: Float32Array) {
    if (this.stopped || this.speaking || this.turnBusy) return;
    this.turnBusy = true;
    const started = Date.now();
    try {
      const wav = pcmFloatToWav(pcm, this.sampleRate, 1);
      const stt = await this.sarvam.transcribe(wav, "unknown");
      const text = stt.transcript;
      if (!text || this.stopped) return;
      this.activeLanguage = inferSpokenLanguage(text, stt.languageCode, this.activeLanguage);
      log.info(
        { callId: this.cfg.callId, text, language: this.activeLanguage, sttMs: Date.now() - started },
        "callee said",
      );

      const matched = matchIntentPlaybook(text, this.playbook);
      if (matched) {
        this.lastMatchedIntent = matched.intent;
        void recordIntentEvent(prisma, {
          organizationId: this.cfg.organizationId,
          aiConfigId: this.ai.id,
          callId: this.cfg.callId,
          phone: this.cfg.phone,
          intent: matched.intent,
          action: matched.action,
          utterance: text,
        }).catch(() => undefined);
      }

      if (matched?.action === "hangup") {
        this.history.push({ role: "user", content: text });
        void this.saveTurns([{ role: "user", text }]);
        await this.thankAndHangup(matched.reply);
        return;
      }

      let reply: string;
      if (matched?.action === "continue" && matched.reply.trim()) {
        reply = matched.reply.trim();
        log.info({ callId: this.cfg.callId, intent: matched.intent }, "playbook reply");
      } else {
        const chatStarted = Date.now();
        reply = await this.sarvam.chat(
          [
            { role: "system", content: this.systemPrompt() },
            ...this.history.slice(-10),
            {
              role: "user",
              content: `[Speak in ${this.activeLanguage}]\n${text}`,
            },
          ],
          {
            model: this.ai.model || undefined,
            temperature: Math.min(this.ai.temperature ?? 0.4, 0.45),
            maxTokens: Math.min(this.ai.maxTokens || 120, 96),
          },
        );
        if (!reply || this.stopped) return;
        log.info({ callId: this.cfg.callId, chatMs: Date.now() - chatStarted }, "agent reply ready");
      }

      const hangupParsed = parseHangupTag(reply);
      reply = hangupParsed.spoken;
      const parsed = parseBookTag(reply);
      reply = parsed.spoken;
      if (parsed.iso && !this.booked && this.cfg.channelId) {
        const appt = await bookAppointment(prisma, {
          organizationId: this.cfg.organizationId,
          aiConfigId: this.ai.id,
          channelId: this.cfg.channelId,
          contactId: this.cfg.contactId,
          callId: this.cfg.callId,
          phone: this.cfg.phone,
          contactName: this.contactName,
          iso: parsed.iso,
          slots: this.slots,
        });
        if (appt) {
          this.booked = true;
          await this.enqueueReminder(appt.id, appt.startsAt);
          log.info({ callId: this.cfg.callId, appointmentId: appt.id }, "appointment booked");
        }
      }

      this.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
      if (this.history.length > 14) this.history = this.history.slice(-14);
      void this.saveTurns([
        { role: "user", text },
        { role: "assistant", text: reply },
      ]);
      await this.say(reply);

      if (hangupParsed.hangup || this.wrappingUp) {
        await this.requestHangup();
        this.hangupRequested = true;
        this.stop();
      }
    } catch (err) {
      log.warn({ err, callId: this.cfg.callId }, "voice agent turn failed");
    } finally {
      this.turnBusy = false;
    }
  }

  private systemPrompt(): string {
    return buildVoiceAgentSystemPrompt(
      this.ai,
      { name: this.contactName, phone: this.cfg.phone },
      {
        slots: this.booked ? "An appointment is already booked. Do not book another." : slotsPrompt(this.slots),
        memory: this.memoryPrompt,
        wrappingUp: this.wrappingUp,
      },
    );
  }

  private async enqueueReminder(appointmentId: string, startsAt: Date) {
    const delay = Math.max(0, startsAt.getTime() - Date.now());
    const q = new Queue(QUEUE_NAMES.appointmentReminders, { connection: { url: this.cfg.redisUrl } });
    await q.add("remind", { appointmentId }, { delay, jobId: `appt-${appointmentId}` });
    await q.close();
  }

  private async saveTurns(turns: Array<{ role: "user" | "assistant"; text: string }>) {
    try {
      await appendCallTranscriptTurns(prisma, this.cfg.callId, turns, {
        source: "ai",
        language: this.activeLanguage,
      });
    } catch (err) {
      log.warn({ err, callId: this.cfg.callId }, "could not save call transcript");
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
    this.interrupt = false;
    this.pending = new Float32Array(0);
    this.speakingSamples = 0;
    this.silenceSamples = 0;
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
        if (this.stopped || this.interrupt) return;
        const pcm = await (nextPcm ?? this.sarvam.synthesizePcm(sentences[i]!, opts));
        const upcoming = sentences[i + 1];
        nextPcm = upcoming ? this.sarvam.synthesizePcm(upcoming, opts) : null;
        if (this.stopped || this.interrupt) return;
        const frame = 1600;
        for (let j = 0; j < pcm.length; j += frame) {
          if (this.stopped || this.interrupt) return;
          await this.sendPcm(pcm.slice(j, j + frame));
          await sleep(Math.round((Math.min(frame, pcm.length - j) / this.sampleRate) * 1000));
        }
      }
    } catch (err) {
      log.warn({ err, callId: this.cfg.callId }, "voice agent TTS failed");
    } finally {
      this.speaking = false;
      this.interrupt = false;
      await sleep(80);
    }
  }

  private async sendPcm(pcm: Float32Array) {
    const res = await fetch(`${this.cfg.whatsappUrl}/internal/calls/${this.cfg.callId}/pcm`, {
      method: "POST",
      headers: {
        "x-internal-token": this.cfg.internalToken,
        "content-type": "application/octet-stream",
      },
      body: new Uint8Array(pcmToBuffer(pcm)),
    });
    if (!res.ok) throw new Error(`WhatsApp media ${res.status}`);
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
