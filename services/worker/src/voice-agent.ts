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
    await this.saveTurns([{ role: "assistant", text: greeting }]);
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
      if (energy > 0.03) this.bargeSamples += pcm.length;
      else this.bargeSamples = 0;
      if (this.bargeSamples >= this.sampleRate * 0.55) {
        this.interrupt = true;
        this.speaking = false;
        this.bargeSamples = 0;
        this.pending = new Float32Array(pcm);
        this.speakingSamples = pcm.length;
        this.silenceSamples = 0;
      }
      return;
    }
    const merged = new Float32Array(this.pending.length + pcm.length);
    merged.set(this.pending);
    merged.set(pcm, this.pending.length);
    this.pending = merged;
    const energy = rms(pcm);
    if (energy > 0.016) {
      this.speakingSamples += pcm.length;
      this.silenceSamples = 0;
    } else if (this.speakingSamples > 0) {
      this.silenceSamples += pcm.length;
    }
    const speechMs = (this.speakingSamples / this.sampleRate) * 1000;
    const silenceMs = (this.silenceSamples / this.sampleRate) * 1000;
    const maxMs = (this.pending.length / this.sampleRate) * 1000;
    if ((speechMs >= 400 && silenceMs >= 550) || (speechMs >= 350 && maxMs >= 10_000)) {
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
      let reply = await this.sarvam.chat(
        [
          { role: "system", content: this.systemPrompt() },
          ...this.history.slice(-12),
          { role: "user", content: text },
        ],
        {
          model: this.ai.model || undefined,
          temperature: this.ai.temperature,
          // Voice replies are constrained to ~40 words; clamp tokens so the model returns faster.
          maxTokens: Math.min(this.ai.maxTokens, 180),
        },
      );
      if (!reply || this.stopped) return;
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
      if (this.history.length > 16) this.history = this.history.slice(-16);
      await this.saveTurns([
        { role: "user", text },
        { role: "assistant", text: reply },
      ]);
      await this.say(reply);
    } catch (err) {
      log.warn({ err, callId: this.cfg.callId }, "voice agent turn failed");
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
        language: this.ai.language,
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
    try {
      const pcm = await this.sarvam.synthesizePcm(text, {
        language: this.ai.language,
        speaker: this.ai.voice || "shubh",
        sampleRate: this.sampleRate,
      });
      if (this.stopped || this.interrupt) return;
      const frame = 1600;
      for (let i = 0; i < pcm.length; i += frame) {
        if (this.stopped || this.interrupt) return;
        await this.sendPcm(pcm.slice(i, i + frame));
        await sleep(Math.round((Math.min(frame, pcm.length - i) / this.sampleRate) * 1000));
      }
    } catch (err) {
      log.warn({ err, callId: this.cfg.callId }, "voice agent TTS failed");
    } finally {
      this.speaking = false;
      this.interrupt = false;
      await sleep(250);
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
