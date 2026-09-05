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
  type OpenSlot,
} from "@wacalls/database";
import {
  SarvamClient,
  extractSarvamApiKey,
  pcmFloatToWav,
  buildVoiceAgentGreeting,
  buildVoiceAgentSystemPrompt,
  inferSpokenLanguage,
  splitSpokenSentences,
  toBcp47,
  type ChatTurn,
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
}): Promise<AgentHandle | null> {
  const [ai, call] = await Promise.all([
    prisma.aiConfig.findUnique({
      where: { id: input.aiConfigId },
      include: { knowledgeBase: { include: { documents: { take: 40 } } } },
    }),
    prisma.call.findUnique({ where: { id: input.callId } }),
  ]);
  if (!ai) {
    log.warn({ callId: input.callId }, "AI config missing; skipping voice agent");
    return null;
  }
  const row = await prisma.setting.findFirst({
    where: { organizationId: input.organizationId, key: "sarvam_api_key" },
  });
  const key = extractSarvamApiKey(row?.value) || process.env.SARVAM_API_KEY || process.env.AI_API_KEY || "";
  if (!key) {
    log.warn({ callId: input.callId }, "Sarvam key missing; skipping voice agent");
    return null;
  }

  const slots = await listOpenSlots(prisma, ai.id);
  const agent = new NativeVoiceAgent(
    {
      ...input,
      channelId: call?.channelId ?? "",
      contactId: call?.contactId ?? null,
    },
    ai,
    new SarvamClient(key),
    slots,
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
  private systemPromptNotBooked: string;
  private systemPromptBooked: string;
  private pending = new Float32Array(0);
  private speakingSamples = 0;
  private silenceSamples = 0;
  private bargeSamples = 0;
  private booked = false;
  private activeLanguage: string;
  private turnBusy = false;
  private readonly sampleRate = 16_000;
  private readonly contactName: string;

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
      knowledgeBase: { name: string; documents: Array<{ title: string; content: string }> } | null;
    },
    private readonly sarvam: SarvamClient,
    private readonly slots: OpenSlot[],
  ) {
    this.contactName = cfg.contactName?.trim() || "there";
    this.activeLanguage = toBcp47(ai.language || "hi-IN");
    // Cache system prompts: rebuilding them every turn is expensive and adds avoidable latency.
    this.systemPromptNotBooked = buildVoiceAgentSystemPrompt(
      this.ai,
      { name: this.contactName, phone: this.cfg.phone },
      { slots: slotsPrompt(this.slots) },
    );
    this.systemPromptBooked = buildVoiceAgentSystemPrompt(
      this.ai,
      { name: this.contactName, phone: this.cfg.phone },
      { slots: "An appointment is already booked. Do not book another." },
    );
  }

  async greet() {
    if (this.greeted || this.stopped) return;
    this.greeted = true;
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
  }

  onDownlink(pcm: Float32Array) {
    if (this.stopped || !pcm.length) return;
    if (this.speaking) {
      const energy = rms(pcm);
      if (energy > 0.028) this.bargeSamples += pcm.length;
      else this.bargeSamples = 0;
      // Faster barge-in so the agent yields quickly when the caller talks over it.
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
    // Snappier end-of-turn: start STT sooner after the caller pauses.
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
    const started = Date.now();
    try {
      const wav = pcmFloatToWav(pcm, this.sampleRate, 1);
      // Auto-detect language so Hindi/English (and switches) follow the caller.
      const stt = await this.sarvam.transcribe(wav, "unknown");
      const text = stt.transcript;
      if (!text || this.stopped) return;
      this.activeLanguage = inferSpokenLanguage(text, stt.languageCode, this.activeLanguage);
      log.info(
        { callId: this.cfg.callId, text, language: this.activeLanguage, sttMs: Date.now() - started },
        "callee said",
      );

      const chatStarted = Date.now();
      let reply = await this.sarvam.chat(
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
          // Short voice turns — lower tokens = faster first reply.
          maxTokens: Math.min(this.ai.maxTokens || 120, 96),
        },
      );
      if (!reply || this.stopped) return;
      log.info({ callId: this.cfg.callId, chatMs: Date.now() - chatStarted }, "agent reply ready");

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
      // Persist transcript in parallel — do not block speaking.
      void this.saveTurns([
        { role: "user", text },
        { role: "assistant", text: reply },
      ]);
      await this.say(reply);
    } catch (err) {
      log.warn({ err, callId: this.cfg.callId }, "voice agent turn failed");
    } finally {
      this.turnBusy = false;
    }
  }

  private systemPrompt(): string {
    return this.booked ? this.systemPromptBooked : this.systemPromptNotBooked;
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

  private async say(text: string) {
    if (this.stopped || !text.trim()) return;
    this.speaking = true;
    this.interrupt = false;
    this.pending = new Float32Array(0);
    this.speakingSamples = 0;
    this.silenceSamples = 0;
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
