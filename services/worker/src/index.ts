import { Worker, Queue } from "bullmq";
import { Redis } from "ioredis";
import { createHmac, createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { prisma, setCallTranscript } from "@wacalls/database";
import {
  ChannelLock,
  ChannelWaitQueue,
  QUEUE_NAMES,
  channelLockIsStale,
  type PlaceCallJob,
} from "@wacalls/queue";
import { extractSarvamApiKey, renderVoiceScript, SarvamClient } from "@wacalls/audio-engine";
import {
  cloudInteractivePayload,
  composeSimpleBody,
  fillMessageTemplate,
  nativeMessagePayload,
  templateFromRecord,
} from "@wacalls/shared";
import { pickRotatedChannel, rotationPool } from "./rotation.js";
import { startNativeVoiceAgent } from "./voice-agent.js";

const log = pino({ name: "worker", level: process.env.LOG_LEVEL ?? "info" });
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const WHATSAPP_URL = process.env.WHATSAPP_URL ?? "http://whatsapp:4010";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? "";
const RECORDINGS_DIR = process.env.RECORDINGS_DIR ?? "/data/recordings";

const connection = { url: REDIS_URL };
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
redis.on("error", (err) => log.warn({ err: err.message }, "redis error"));
const lock = new ChannelLock(redis);
const waitQueue = new ChannelWaitQueue(redis);
const retryQueue = new Queue(QUEUE_NAMES.retries, { connection });
const callQ = new Queue<PlaceCallJob>(QUEUE_NAMES.calls, { connection });
const autoReplyQ = new Queue(QUEUE_NAMES.autoReplies, { connection });
const inboundSub = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
inboundSub.on("error", (err) => log.warn({ err: err.message }, "inbound redis error"));
void inboundSub.subscribe("wacalls:inbound").then(() => log.info("listening for inbound auto-answer"));
inboundSub.on("message", (_channel, raw) => {
  void (async () => {
    try {
      const data = JSON.parse(raw) as PlaceCallJob;
      if (!data.callId || !data.aiConfigId) return;
      await callQ.add(
        "inbound",
        { ...data, inbound: true, hangupAfterPlayback: false },
        { jobId: `inbound-${data.callId}`, removeOnComplete: 200, removeOnFail: 100 },
      );
    } catch (err) {
      log.warn({ err }, "inbound enqueue failed");
    }
  })();
});

async function wa<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${WHATSAPP_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-token": INTERNAL_TOKEN,
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error((json as any).error?.message ?? `whatsapp ${res.status}`);
  return json;
}

async function resolveSarvamApiKey(organizationId: string): Promise<string> {
  const row = await prisma.setting.findFirst({
    where: { organizationId, key: "sarvam_api_key" },
  });
  const key = extractSarvamApiKey(row?.value) || process.env.SARVAM_API_KEY || process.env.AI_API_KEY || "";
  if (!key) {
    throw new Error("Sarvam AI API key is missing. Add it in AI calling settings.");
  }
  return key;
}

async function prepareOutboundAudio(
  campaign: {
    type: string;
    organizationId: string;
    afterRecording: string;
    aiConfigId: string | null;
    recording: { filePath: string } | null;
    voiceTemplate: {
      id: string;
      body: string;
      language: string;
      speaker: string;
      pace: number;
    } | null;
  },
  contact: { name: string; phone: string; company: string | null; email: string | null },
): Promise<{
  recordingPath?: string;
  aiConfigId?: string;
  hangupAfterPlayback: boolean;
  spokenScript?: string;
  language?: string;
}> {
  const hangupAfterPlayback = campaign.afterRecording === "HANGUP";
  if (campaign.type === "AI_VOICE") {
    if (!campaign.aiConfigId) throw new Error("Attach an AI agent before starting this campaign.");
    await resolveSarvamApiKey(campaign.organizationId);
    return { aiConfigId: campaign.aiConfigId, hangupAfterPlayback: false };
  }
  if (campaign.type === "TTS") {
    const tpl = campaign.voiceTemplate;
    if (!tpl) throw new Error("Attach a voice template before starting this campaign.");
    const script = renderVoiceScript(tpl.body, contact);
    if (!script.trim()) throw new Error("Voice template is empty after filling contact fields.");
    const key = await resolveSarvamApiKey(campaign.organizationId);
    const hash = createHash("sha256")
      .update(`${tpl.id}:${tpl.speaker}:${tpl.language}:${tpl.pace}:${script}`)
      .digest("hex")
      .slice(0, 20);
    const dir = path.join(RECORDINGS_DIR, "tts", campaign.organizationId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${hash}.wav`);
    try {
      await access(filePath);
    } catch {
      const wav = await new SarvamClient(key).synthesize(script, {
        language: tpl.language,
        speaker: tpl.speaker,
        pace: tpl.pace,
        sampleRate: 16_000,
      });
      await writeFile(filePath, wav);
    }
    return { recordingPath: filePath, hangupAfterPlayback, spokenScript: script, language: tpl.language };
  }
  if (campaign.type === "RECORDED") {
    if (!campaign.recording?.filePath) throw new Error("Upload a recording before starting this campaign.");
    return { recordingPath: campaign.recording.filePath, hangupAfterPlayback };
  }
  return {
    recordingPath: campaign.recording?.filePath ?? undefined,
    hangupAfterPlayback: false,
  };
}

function digitsOnly(phone: string) {
  return phone.replace(/\D/g, "");
}

function fillMessage(body: string, contact: { name: string; company: string | null; phone?: string; email?: string | null }) {
  return body
    .replaceAll("{{name}}", contact.name)
    .replaceAll("{{phone}}", contact.phone ?? "")
    .replaceAll("{{email}}", contact.email?.trim() || "")
    .replaceAll("{{company}}", contact.company?.trim() || "");
}

function templatePreviewOrBody(
  filled: ReturnType<typeof fillMessageTemplate>,
  fallback: string | null,
  contact: { name: string; company: string | null; phone?: string; email?: string | null },
) {
  if (filled.kind === "SIMPLE") return composeSimpleBody(filled.header ?? "", filled.body, filled.footer ?? "");
  return filled.body || fillMessage(fallback ?? "", contact);
}

async function sendChannelText(input: {
  organizationId: string;
  channelId: string;
  phone: string;
  contactId?: string | null;
  contactName?: string | null;
  email?: string | null;
  company?: string | null;
  body: string;
  campaignId?: string | null;
  imagePath?: string | null;
  typingMs?: number;
  template?: {
    kind: string;
    header: string | null;
    body: string;
    footer: string | null;
    mediaPath: string | null;
    buttons: unknown;
    listButton: string | null;
    sections: unknown;
  } | null;
}) {
  const channel = await prisma.whatsAppChannel.findUnique({ where: { id: input.channelId } });
  if (!channel) throw new Error("channel missing");
  const vars = {
    name: input.contactName,
    phone: input.phone,
    company: input.company,
    email: input.email,
  };
  const filled = input.template
    ? fillMessageTemplate(templateFromRecord(input.template), vars)
    : fillMessageTemplate(
        {
          kind: input.imagePath ? "MEDIA" : "TEXT",
          body: input.body,
          mediaPath: input.imagePath,
        },
        vars,
      );
  const text = templatePreviewOrBody(filled, input.body, {
    name: input.contactName ?? "ji",
    company: input.company ?? null,
    phone: input.phone,
    email: input.email,
  });
  const row = await prisma.message.create({
    data: {
      organizationId: input.organizationId,
      channelId: input.channelId,
      contactId: input.contactId ?? undefined,
      campaignId: input.campaignId ?? undefined,
      phone: input.phone,
      body: text,
      provider: channel.provider,
      status: "QUEUED",
    },
  });
  try {
    let externalId: string | undefined;
    const native = nativeMessagePayload(filled);
    if (channel.provider === "CLOUD") {
      if (!channel.cloudPhoneNumberId || !channel.cloudAccessToken) {
        throw new Error("Cloud API credentials missing");
      }
      const to = digitsOnly(input.phone);
      const interactive = cloudInteractivePayload(filled);
      if (interactive) {
        const res = await fetch(`https://graph.facebook.com/v21.0/${channel.cloudPhoneNumberId}/messages`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${channel.cloudAccessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...interactive, to }),
        });
        const json = (await res.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
        if (!res.ok) throw new Error(json.error?.message ?? `Cloud API ${res.status}`);
        externalId = json.messages?.[0]?.id;
      } else if ((filled.kind === "MEDIA" && filled.mediaPath) || input.imagePath) {
        externalId = await sendCloudImage({
          phoneNumberId: channel.cloudPhoneNumberId,
          token: channel.cloudAccessToken,
          to,
          caption: text,
          imagePath: filled.mediaPath || input.imagePath || "",
        });
      } else {
        const res = await fetch(`https://graph.facebook.com/v21.0/${channel.cloudPhoneNumberId}/messages`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${channel.cloudAccessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: text },
          }),
        });
        const json = (await res.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
        if (!res.ok) throw new Error(json.error?.message ?? `Cloud API ${res.status}`);
        externalId = json.messages?.[0]?.id;
      }
    } else {
      const sent = await wa<{ id?: string; data?: { id?: string } }>("/internal/messages", {
        method: "POST",
        body: JSON.stringify({
          channelId: input.channelId,
          phone: input.phone,
          kind: native.kind,
          text: native.text,
          header: native.header,
          footer: native.footer,
          imagePath: native.imagePath || input.imagePath || undefined,
          buttons: native.buttons,
          listButton: native.listButton,
          sections: native.sections,
          typingMs: input.typingMs ?? 0,
        }),
      });
      externalId = sent.id ?? sent.data?.id;
    }
    await prisma.message.update({
      where: { id: row.id },
      data: { status: "SENT", externalId, sentAt: new Date() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    await prisma.message.update({ where: { id: row.id }, data: { status: "FAILED", error: message } });
    throw err;
  }
}

async function sendCloudImage(input: {
  phoneNumberId: string;
  token: string;
  to: string;
  caption: string;
  imagePath: string;
}) {
  const buf = await readFile(input.imagePath);
  const ext = path.extname(input.imagePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", mime);
          form.set("file", new Blob([new Uint8Array(buf)], { type: mime }), path.basename(input.imagePath));
  const up = await fetch(`https://graph.facebook.com/v21.0/${input.phoneNumberId}/media`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.token}` },
    body: form,
  });
  const uploaded = (await up.json()) as { id?: string; error?: { message?: string } };
  if (!up.ok || !uploaded.id) throw new Error(uploaded.error?.message ?? `Cloud media ${up.status}`);
  const res = await fetch(`https://graph.facebook.com/v21.0/${input.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "image",
      image: { id: uploaded.id, caption: input.caption },
    }),
  });
  const json = (await res.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Cloud API ${res.status}`);
  return json.messages?.[0]?.id;
}

function friendlyCallError(message: string) {
  if (/Connection Closed|conflict|replaced/i.test(message)) {
    return "WhatsApp dropped the session while starting the call. Wait until the line shows Connected, then try again.";
  }
  if (/not on WhatsApp/i.test(message)) {
    return message;
  }
  if (/resolve LID|resolve this WhatsApp identity/i.test(message)) {
    return "WhatsApp could not identify this number for calling. Send them a message from this line first, then call again.";
  }
  return message;
}

async function campaignPaceDelay(campaignId: string, countBatch = false) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { delayBetweenCallsSec: true, batchSize: true, sleepAfterBatchSec: true },
  });
  let delay = Math.max(500, (campaign?.delayBetweenCallsSec ?? 5) * 1000);
  if (countBatch && campaign && campaign.batchSize > 0) {
    const n = await redis.incr(`wacalls:campaign:${campaignId}:done`);
    if (n > 0 && n % campaign.batchSize === 0) {
      delay = Math.max(delay, Math.max(0, campaign.sleepAfterBatchSec) * 1000);
    }
  }
  return delay;
}

async function enqueueCampaignContinue(campaignId: string, organizationId: string, delay = 4000) {
  const campaignQ = new Queue(QUEUE_NAMES.campaigns, { connection });
  await campaignQ.add(
    "run",
    { campaignId, organizationId },
    { delay, jobId: `camp-${campaignId}-${Date.now()}` },
  );
  await campaignQ.close();
}

const TERMINAL_CALL_STATUSES = ["ENDED", "FAILED", "BUSY", "NO_ANSWER", "REJECTED", "CANCELLED"] as const;
const CALL_OUTCOMES = new Set([
  "ANSWERED",
  "NO_ANSWER",
  "BUSY",
  "REJECTED",
  "FAILED",
  "CALLBACK",
  "INTERESTED",
  "NOT_INTERESTED",
  "WRONG_NUMBER",
  "DO_NOT_CALL",
]);

type CallOutcomeValue =
  | "ANSWERED"
  | "NO_ANSWER"
  | "BUSY"
  | "REJECTED"
  | "FAILED"
  | "CALLBACK"
  | "INTERESTED"
  | "NOT_INTERESTED"
  | "WRONG_NUMBER"
  | "DO_NOT_CALL";

function asCallOutcome(value: string | null, fallback: "ANSWERED" | "FAILED"): CallOutcomeValue {
  if (value && CALL_OUTCOMES.has(value)) return value as CallOutcomeValue;
  return fallback;
}

function isTerminalCallStatus(status: string) {
  return TERMINAL_CALL_STATUSES.includes(status as (typeof TERMINAL_CALL_STATUSES)[number]);
}

function campaignContactClose(status: string, outcome: string | null) {
  if (status === "ENDED") return { status: "completed", lastOutcome: asCallOutcome(outcome, "ANSWERED") };
  if (status === "NO_ANSWER") return { status: "no_answer", lastOutcome: "NO_ANSWER" as const };
  if (status === "BUSY") return { status: "busy", lastOutcome: "BUSY" as const };
  if (status === "REJECTED") return { status: "rejected", lastOutcome: "REJECTED" as const };
  if (status === "CANCELLED") return { status: "cancelled", lastOutcome: asCallOutcome(outcome, "FAILED") };
  return { status: "failed", lastOutcome: asCallOutcome(outcome, "FAILED") };
}

type CampaignCallRow = {
  id: string;
  campaignId: string | null;
  campaignContactId: string | null;
  organizationId: string;
  status: string;
  outcome: string | null;
};

function autoReplyTriggerForCall(status: string) {
  if (status === "ENDED") return "ANSWERED" as const;
  if (status === "NO_ANSWER") return "NO_ANSWER" as const;
  if (status === "REJECTED") return "REJECTED" as const;
  if (status === "FAILED" || status === "BUSY" || status === "CANCELLED") return "NOT_CONNECTED" as const;
  return null;
}

async function enqueueAutoReplies(call: CampaignCallRow) {
  const trigger = autoReplyTriggerForCall(call.status);
  if (!trigger) return;
  const full = await prisma.call.findUnique({
    where: { id: call.id },
    select: { id: true, organizationId: true, campaignId: true, source: true },
  });
  if (!full || full.source === "inbound") return;
  const rules = await prisma.autoReplyRule.findMany({
    where: {
      organizationId: full.organizationId,
      enabled: true,
      trigger,
      OR: full.campaignId
        ? [{ campaignId: null }, { campaignId: full.campaignId }]
        : [{ campaignId: null }],
    },
    select: { id: true, delaySeconds: true },
  });
  for (const rule of rules) {
    await autoReplyQ
      .add(
        "send",
        { callId: full.id, ruleId: rule.id },
        {
          delay: Math.max(0, rule.delaySeconds) * 1000,
          jobId: `ar-${full.id}-${rule.id}`,
          removeOnComplete: 200,
          removeOnFail: 50,
        },
      )
      .catch((err) => log.warn({ err, ruleId: rule.id, callId: full.id }, "auto-reply already queued"));
  }
}

async function closeCampaignContactFromCall(call: CampaignCallRow) {
  if (!call.campaignContactId || !isTerminalCallStatus(call.status)) return;
  const campaign = call.campaignId
    ? await prisma.campaign.findUnique({
        where: { id: call.campaignId },
        select: { maxAttempts: true, retryDelayMin: true },
      })
    : null;
  const cc = await prisma.campaignContact.findUnique({ where: { id: call.campaignContactId } });
  if (!cc || !["calling", "pending", "retry"].includes(cc.status)) return;

  const closed = campaignContactClose(call.status, call.outcome);
  const retriable = ["NO_ANSWER", "BUSY", "FAILED", "REJECTED"].includes(call.status);
  if (retriable && campaign && cc.attempts < campaign.maxAttempts) {
    await prisma.campaignContact.update({
      where: { id: cc.id },
      data: {
        status: "retry",
        lastOutcome: closed.lastOutcome,
        nextAttemptAt: new Date(Date.now() + Math.max(1, campaign.retryDelayMin) * 60_000),
      },
    });
    return;
  }
  await prisma.campaignContact.update({
    where: { id: cc.id },
    data: closed,
  });
}

async function recoverStuckCalling(campaignId: string) {
  const stuck = await prisma.campaignContact.findMany({
    where: { campaignId, status: "calling" },
    include: { calls: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const staleBefore = new Date(Date.now() - 20 * 60_000);
  for (const row of stuck) {
    const call = row.calls[0];
    if (!call) {
      await prisma.campaignContact.update({
        where: { id: row.id },
        data: { status: "failed", lastOutcome: "FAILED" },
      });
      continue;
    }
    let current = call;
    const stale = Boolean(call.endedAt) || call.updatedAt < staleBefore;
    if (!isTerminalCallStatus(current.status) && stale) {
      current = await prisma.call.update({
        where: { id: call.id },
        data: {
          status: "FAILED",
          failureReason: call.failureReason ?? "campaign recovered a stuck call",
          endedAt: call.endedAt ?? new Date(),
        },
      });
    }
    if (!isTerminalCallStatus(current.status)) continue;
    await closeCampaignContactFromCall(current);
  }
}

async function finalizeCampaignCall(call: CampaignCallRow) {
  await enqueueAutoReplies(call).catch((err) =>
    log.warn({ err, callId: call.id }, "auto-reply enqueue failed"),
  );
  await closeCampaignContactFromCall(call);
  if (call.campaignId) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: call.campaignId },
      select: { status: true },
    });
    if (campaign?.status === "RUNNING") {
      const delay = await campaignPaceDelay(call.campaignId, true);
      await enqueueCampaignContinue(call.campaignId, call.organizationId, delay);
    }
  }
}

async function resumeRunningCampaigns() {
  const running = await prisma.campaign.findMany({
    where: { status: "RUNNING" },
    select: { id: true, organizationId: true },
  });
  for (const campaign of running) {
    await enqueueCampaignContinue(campaign.id, campaign.organizationId, 1500);
  }
  if (running.length) {
    log.info({ count: running.length }, "resumed running campaigns after worker start");
  }
}

type MessageChannel = {
  id: string;
  provider: string;
  status: string;
  displayName?: string | null;
  cloudPhoneNumberId: string | null;
  cloudAccessToken: string | null;
};

async function runMessageCampaign(
  campaign: {
    id: string;
    organizationId: string;
    channelId: string;
    rotationLimit: number;
    messageBody: string | null;
    messageTemplate?: {
      kind: string;
      header: string | null;
      body: string;
      footer: string | null;
      mediaPath: string | null;
      buttons: unknown;
      listButton: string | null;
      sections: unknown;
    } | null;
    campaignChannels: Array<{ channel: MessageChannel }>;
  },
  fallbackChannel: MessageChannel,
  org: { plan: { maxMessagesPerDay: number } | null },
) {
  if (!campaign.messageBody?.trim() && !campaign.messageTemplate) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "FAILED" } });
    return { skipped: true, reason: "empty_message" };
  }

  if (org.plan) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const sentToday = await prisma.message.count({
      where: {
        organizationId: campaign.organizationId,
        createdAt: { gte: start },
        status: { not: "FAILED" },
      },
    });
    if (sentToday >= org.plan.maxMessagesPerDay) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "PAUSED" } });
      return { skipped: true, reason: "message_quota" };
    }
  }

  const pool = rotationPool(
    campaign.campaignChannels.length
      ? campaign.campaignChannels.map((row) => row.channel)
      : [fallbackChannel],
    campaign.rotationLimit,
  );
  const next = await prisma.campaignContact.findFirst({
    where: {
      campaignId: campaign.id,
      skipped: false,
      status: { in: ["pending", "retry"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    include: { contact: true },
    orderBy: { createdAt: "asc" },
  });

    if (!next) {
      const inFlight = await prisma.campaignContact.count({
        where: { campaignId: campaign.id, skipped: false, status: { in: ["calling", "sending"] } },
      });
      if (inFlight > 0) return { kind: "message", waiting: true };

      const remaining = await prisma.campaignContact.count({
        where: { campaignId: campaign.id, skipped: false, status: { in: ["pending", "retry"] } },
      });
      if (remaining === 0) {
        await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "COMPLETED" } });
        return { kind: "message", done: true };
      }
      const soonest = await prisma.campaignContact.findFirst({
        where: {
          campaignId: campaign.id,
          skipped: false,
          status: { in: ["pending", "retry"] },
          nextAttemptAt: { not: null },
        },
        orderBy: { nextAttemptAt: "asc" },
        select: { nextAttemptAt: true },
      });
      const delay = soonest?.nextAttemptAt
        ? Math.max(1000, soonest.nextAttemptAt.getTime() - Date.now())
        : 4000;
      await enqueueCampaignContinue(campaign.id, campaign.organizationId, delay);
      return { kind: "message", waiting: true, retryLater: true };
    }

  const cursor = await redis.incr(`wacalls:campaign:${campaign.id}:rotate`);
  const channel = pickRotatedChannel(pool, cursor - 1, new Set());
  if (!channel) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "PAUSED" } });
    log.warn({ campaignId: campaign.id }, "message campaign paused: no connected WhatsApp number in rotation");
    return { skipped: true, reason: "channel_not_connected" };
  }

  const filled = fillMessageTemplate(
    campaign.messageTemplate
      ? templateFromRecord(campaign.messageTemplate)
      : { kind: "TEXT", body: campaign.messageBody ?? "" },
    {
      name: next.contact.name,
      phone: next.contact.phone,
      company: next.contact.company,
      email: next.contact.email,
    },
  );
  const body = templatePreviewOrBody(filled, campaign.messageBody, next.contact);

  await prisma.campaignContact.update({
    where: { id: next.id },
    data: { status: "sending", attempts: { increment: 1 } },
  });

  const row = await prisma.message.create({
    data: {
      organizationId: campaign.organizationId,
      channelId: channel.id,
      campaignId: campaign.id,
      contactId: next.contactId,
      phone: next.contact.phone,
      body,
      provider: channel.provider,
      status: "QUEUED",
    },
  });

  try {
    let externalId: string | undefined;
    const native = nativeMessagePayload(filled);
    if (channel.provider === "CLOUD") {
      if (!channel.cloudPhoneNumberId || !channel.cloudAccessToken) {
        throw new Error("Cloud API credentials are missing on this channel.");
      }
      const to = digitsOnly(next.contact.phone);
      const interactive = cloudInteractivePayload(filled);
      if (interactive) {
        const res = await fetch(`https://graph.facebook.com/v21.0/${channel.cloudPhoneNumberId}/messages`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${channel.cloudAccessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...interactive, to }),
        });
        const json = (await res.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
        if (!res.ok) throw new Error(json.error?.message ?? `Cloud API ${res.status}`);
        externalId = json.messages?.[0]?.id;
      } else if (filled.kind === "MEDIA" && filled.mediaPath) {
        externalId = await sendCloudImage({
          phoneNumberId: channel.cloudPhoneNumberId,
          token: channel.cloudAccessToken,
          to,
          caption: body,
          imagePath: filled.mediaPath,
        });
      } else {
        const res = await fetch(`https://graph.facebook.com/v21.0/${channel.cloudPhoneNumberId}/messages`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${channel.cloudAccessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body },
          }),
        });
        const json = (await res.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
        if (!res.ok) throw new Error(json.error?.message ?? `Cloud API ${res.status}`);
        externalId = json.messages?.[0]?.id;
      }
    } else {
      const sent = await wa<{ success?: boolean; id?: string; data?: { id?: string } }>("/internal/messages", {
        method: "POST",
        body: JSON.stringify({
          channelId: channel.id,
          phone: next.contact.phone,
          kind: native.kind,
          text: native.text,
          header: native.header,
          footer: native.footer,
          imagePath: native.imagePath || undefined,
          buttons: native.buttons,
          listButton: native.listButton,
          sections: native.sections,
        }),
      });
      externalId = sent.id ?? sent.data?.id;
    }
    await prisma.message.update({
      where: { id: row.id },
      data: { status: "SENT", externalId, sentAt: new Date() },
    });
    await prisma.campaignContact.update({ where: { id: next.id }, data: { status: "sent" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    await prisma.message.update({
      where: { id: row.id },
      data: { status: "FAILED", error: message },
    });
    await prisma.campaignContact.update({ where: { id: next.id }, data: { status: "failed" } });
  }

  await enqueueCampaignContinue(campaign.id, campaign.organizationId, 2500);
  return { kind: "message", contactId: next.contactId };
}

const callWorker = new Worker<PlaceCallJob>(
  QUEUE_NAMES.calls,
  async (job) => {
    const {
      callId,
      channelId,
      organizationId,
      phone,
      recordingPath,
      aiConfigId,
      hangupAfterPlayback,
      contactName,
      inbound,
      sendMessage,
      messageBody,
      messageWhen,
      campaignId,
    } = job.data;
    const owner = callId;
    let acquired = await lock.acquire(channelId, owner);
    if (!acquired) {
      const currentOwner = await lock.owner(channelId);
      if (currentOwner === owner) {
        acquired = true;
      }
    }
    if (!acquired) {
      const current = await prisma.call.findUnique({ where: { id: callId } });
      if (current && isTerminalCallStatus(current.status)) {
        await waitQueue.remove(channelId, callId);
        await finalizeCampaignCall(current);
        return { skipped: true };
      }
      const currentOwner = await lock.owner(channelId);
      const ownerCall = currentOwner ? await prisma.call.findUnique({ where: { id: currentOwner } }) : null;
      if (channelLockIsStale(ownerCall)) {
        if (ownerCall && ["QUEUED", "CONNECTING"].includes(ownerCall.status)) {
          await prisma.call
            .update({
              where: { id: ownerCall.id },
              data: {
                status: "FAILED",
                failureReason: "line recovered for a new call",
                endedAt: new Date(),
              },
            })
            .catch(() => undefined);
        }
        await lock.forceRelease(channelId);
        acquired = await lock.acquire(channelId, owner);
      }
      if (!acquired) throw new Error("CHANNEL_BUSY");
    }

    const row = await prisma.call.findUnique({ where: { id: callId } });
    if (!row || isTerminalCallStatus(row.status)) {
      await waitQueue.remove(channelId, callId);
      if (acquired) await lock.release(channelId, owner).catch(() => undefined);
      if (row) await finalizeCampaignCall(row);
      return { skipped: true };
    }

    await waitQueue.remove(channelId, callId);
    let agent: { stop: () => void; onAnswered?: () => void } | null = null;
    let noticeSent = false;
    const sendNotice = async (status: string) => {
      if (noticeSent || !sendMessage || !messageBody?.trim()) return;
      const when = messageWhen === "ringing" ? "ringing" : "answered";
      const ready =
        when === "ringing"
          ? ["CONNECTING", "RINGING", "ANSWERED"].includes(status)
          : status === "ANSWERED";
      if (!ready) return;
      noticeSent = true;
      await sendChannelText({
        organizationId,
        channelId,
        phone,
        contactId: row.contactId,
        contactName: contactName ?? row.contactName,
        body: messageBody,
      }).catch((err) => log.warn({ err, callId }, "inbound WhatsApp notice failed"));
    };
    try {
      if (!inbound) {
        await wa("/internal/calls", {
          method: "POST",
          body: JSON.stringify({
            callId,
            channelId,
            organizationId,
            phone,
            audioFilePath: recordingPath,
            aiConfigId,
            hangupAfterPlayback: Boolean(hangupAfterPlayback),
            contactName,
          }),
        });
      }
      await sendNotice(row.status);
      const heartbeat = setInterval(() => {
        void lock.renew(channelId, owner);
      }, 30_000);
      const started = Date.now();
      let ringStarted: number | null = null;
      let ringTimeoutMs = 60_000;
      if (campaignId) {
        const pacing = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { ringTimeoutSec: true },
        });
        if (pacing?.ringTimeoutSec && pacing.ringTimeoutSec > 0) {
          ringTimeoutMs = pacing.ringTimeoutSec * 1000;
        }
      }
      while (Date.now() - started < 15 * 60_000) {
        const call = await prisma.call.findUnique({ where: { id: callId } });
        if (call && isTerminalCallStatus(call.status)) {
          clearInterval(heartbeat);
          agent?.stop();
          await finalizeCampaignCall(call);
          return { status: call.status };
        }
        if (call) await sendNotice(call.status);
        if (call && (call.status === "RINGING" || call.status === "CONNECTING")) {
          ringStarted ??= Date.now();
          if (Date.now() - ringStarted >= ringTimeoutMs) {
            await wa(`/internal/calls/${call.engineCallId ?? call.id}/hangup`, { method: "POST" }).catch(
              () => undefined,
            );
            const timedOutRing = await prisma.call.update({
              where: { id: callId },
              data: {
                status: "NO_ANSWER",
                outcome: "NO_ANSWER",
                failureReason: "ring timeout",
                endedAt: new Date(),
              },
            });
            clearInterval(heartbeat);
            agent?.stop();
            await finalizeCampaignCall(timedOutRing);
            return { status: "NO_ANSWER" };
          }
        } else {
          ringStarted = null;
        }
        if (
          aiConfigId &&
          !agent &&
          call &&
          ["CONNECTING", "RINGING", "ANSWERED"].includes(call.status)
        ) {
          try {
            agent =
              (await startNativeVoiceAgent({
                callId,
                organizationId,
                phone,
                contactName,
                aiConfigId,
                redisUrl: REDIS_URL,
                whatsappUrl: WHATSAPP_URL,
                internalToken: INTERNAL_TOKEN,
                deferGreeting: call.status !== "ANSWERED",
              })) ?? { stop() {}, onAnswered() {} };
          } catch (err) {
            log.warn({ err, callId }, "voice agent failed to start; keeping call alive");
            agent = { stop() {}, onAnswered() {} };
          }
        }
        if (call?.status === "ANSWERED" && agent?.onAnswered) {
          agent.onAnswered();
          agent.onAnswered = undefined;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      clearInterval(heartbeat);
      agent?.stop();
      const timedOut = await prisma.call.update({
        where: { id: callId },
        data: { status: "FAILED", failureReason: "call timed out", endedAt: new Date() },
      });
      await finalizeCampaignCall(timedOut);
      return { status: "timeout" };
    } catch (err) {
      const raw = err instanceof Error ? err.message : "call failed";
      const current = await prisma.call.findUnique({ where: { id: callId } });
      if (current && isTerminalCallStatus(current.status)) {
        await finalizeCampaignCall(current);
        return { status: current.status };
      }
      const message = friendlyCallError(raw);
      const failed = await prisma.call.update({
        where: { id: callId },
        data: { status: "FAILED", failureReason: message, endedAt: new Date() },
      });
      await finalizeCampaignCall(failed);
      log.warn({ callId, message }, "call failed");
      return { failed: true, reason: message };
    } finally {
      agent?.stop();
      await lock.release(channelId, owner);
    }
  },
  {
    connection,
    concurrency: 20,
    settings: { backoffStrategy: (attempts) => Math.min(2000 * 2 ** attempts, 15_000) },
  },
);

callWorker.on("failed", (job, err) => {
  if (err.message === "CHANNEL_BUSY" && job) {
    log.info({ callId: job.data.callId }, "channel busy after retries");
  } else {
    log.error({ err, jobId: job?.id }, "call job failed");
  }
  if (!job) return;
  void prisma.call
    .findUnique({ where: { id: job.data.callId } })
    .then(async (call) => {
      if (!call) return;
      if (!isTerminalCallStatus(call.status)) {
        call = await prisma.call.update({
          where: { id: call.id },
          data: {
            status: "FAILED",
            failureReason: err.message === "CHANNEL_BUSY" ? "line was busy" : err.message,
            endedAt: new Date(),
          },
        });
      }
      await finalizeCampaignCall(call);
    })
    .catch((finalizeErr) => log.error({ err: finalizeErr, callId: job.data.callId }, "campaign finalize after call fail"));
});

const campaignWorker = new Worker(
  QUEUE_NAMES.campaigns,
  async (job) => {
    const { campaignId, organizationId } = job.data as { campaignId: string; organizationId: string };
    if (job.name === "start") {
      const existing = await prisma.campaign.findFirst({
        where: { id: campaignId, organizationId },
      });
      if (!existing) return { skipped: true };
      if (!["DRAFT", "SCHEDULED", "PAUSED"].includes(existing.status)) {
        return { skipped: true, reason: "not_startable" };
      }
      await prisma.campaign.update({ where: { id: campaignId }, data: { status: "RUNNING" } });
    }
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        recording: true,
        voiceTemplate: true,
        aiConfig: true,
        messageTemplate: true,
        channel: true,
        campaignChannels: { include: { channel: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!campaign || campaign.status !== "RUNNING") return { skipped: true };

    const org = await prisma.organization.findUnique({
      where: { id: campaign.organizationId },
      include: { plan: true },
    });
    if (!org || org.status === "SUSPENDED") {
      await prisma.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });
      return { skipped: true, reason: "org_suspended" };
    }

    const fallbackChannel = campaign.channel;
    if (!fallbackChannel) {
      await prisma.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });
      return { skipped: true, reason: "channel_not_connected" };
    }

    if (campaign.type === "MESSAGE") {
      return runMessageCampaign(campaign, fallbackChannel, org);
    }

    await recoverStuckCalling(campaignId);

    const pool = rotationPool(
      campaign.campaignChannels.length
        ? campaign.campaignChannels.map((row) => row.channel)
        : [fallbackChannel],
      campaign.rotationLimit,
    );
    const busy = new Set<string>();
    for (const line of pool) {
      if (await lock.owner(line.id)) busy.add(line.id);
    }
    const cursor = await redis.incr(`wacalls:campaign:${campaignId}:rotate`);
    const channel = pickRotatedChannel(pool, cursor - 1, busy, { voice: true });
    if (!channel) {
      const anyReady = pool.some((line) => line.status === "CONNECTED" && line.provider !== "CLOUD");
      if (!anyReady) {
        await prisma.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });
        log.warn({ campaignId }, "campaign paused: no connected WhatsApp Web line in rotation");
        return { skipped: true, reason: "channel_not_connected" };
      }
      await enqueueCampaignContinue(campaign.id, campaign.organizationId, 4000);
      return { waiting: true };
    }

    const next = await prisma.campaignContact.findFirst({
      where: {
        campaignId,
        skipped: false,
        status: { in: ["pending", "retry"] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        contact: { doNotCall: false, NOT: { whatsappOn: false } },
      },
      include: { contact: true },
      orderBy: { createdAt: "asc" },
    });

    if (!next) {
      const inFlight = await prisma.campaignContact.count({
        where: { campaignId, skipped: false, status: { in: ["calling", "sending"] } },
      });
      if (inFlight > 0) {
        await enqueueCampaignContinue(campaign.id, campaign.organizationId, 4000);
        return { waiting: true };
      }

      const remaining = await prisma.campaignContact.count({
        where: { campaignId, skipped: false, status: { in: ["pending", "retry"] } },
      });
      if (remaining === 0) {
        await prisma.campaign.update({ where: { id: campaignId }, data: { status: "COMPLETED" } });
        return { done: true };
      }
      const soonest = await prisma.campaignContact.findFirst({
        where: {
          campaignId,
          skipped: false,
          status: { in: ["pending", "retry"] },
          nextAttemptAt: { not: null },
        },
        orderBy: { nextAttemptAt: "asc" },
        select: { nextAttemptAt: true },
      });
      const delay = soonest?.nextAttemptAt
        ? Math.max(1000, soonest.nextAttemptAt.getTime() - Date.now())
        : 4000;
      await enqueueCampaignContinue(campaign.id, campaign.organizationId, delay);
      return { waiting: true, retryLater: true };
    }

    await prisma.campaignContact.update({
      where: { id: next.id },
      data: { status: "calling", attempts: { increment: 1 } },
    });

    const call = await prisma.call.create({
      data: {
        organizationId: campaign.organizationId,
        channelId: channel.id,
        campaignId: campaign.id,
        campaignContactId: next.id,
        contactId: next.contactId,
        phone: next.contact.phone,
        contactName: next.contact.name,
        source: "campaign",
        status: "QUEUED",
      },
    });

    const outbound = await prepareOutboundAudio(campaign, next.contact).catch(async (err) => {
      const message = err instanceof Error ? err.message : "campaign audio failed";
      await prisma.campaignContact.update({
        where: { id: next.id },
        data: { status: "failed", lastOutcome: "FAILED" },
      });
      await prisma.call.update({
        where: { id: call.id },
        data: { status: "FAILED", failureReason: message, endedAt: new Date() },
      });
      log.warn({ err, campaignId, contactId: next.contactId }, "campaign audio prepare failed");
      return null;
    });
    if (!outbound) {
      await enqueueCampaignContinue(campaign.id, campaign.organizationId, 2500);
      return { failed: true, contactId: next.contactId };
    }
    if (outbound.spokenScript) {
      await setCallTranscript(prisma, call.id, {
        source: "tts",
        language: outbound.language ?? null,
        turns: [{ role: "assistant", text: outbound.spokenScript, at: new Date().toISOString() }],
      }).catch((err) => log.warn({ err, callId: call.id }, "could not save voice script transcript"));
    }

    await waitQueue.enqueue(channel.id, call.id);
    const callQueue = new Queue(QUEUE_NAMES.calls, { connection });
    await callQueue.add(
      "place-call",
      {
        callId: call.id,
        organizationId: campaign.organizationId,
        channelId: channel.id,
        phone: next.contact.phone,
        contactName: next.contact.name,
        campaignId: campaign.id,
        recordingPath: outbound.recordingPath,
        aiConfigId: outbound.aiConfigId,
        hangupAfterPlayback: outbound.hangupAfterPlayback,
      },
      { jobId: call.id, attempts: 60, backoff: { type: "fixed", delay: 4000 } },
    );
    await callQueue.close();

    const extraLine = pickRotatedChannel(pool, cursor, new Set([...busy, channel.id]), { voice: true });
    if (extraLine) {
      await enqueueCampaignContinue(campaign.id, campaign.organizationId, 800);
    }
    return { enqueued: call.id };
  },
  { connection, concurrency: 4 },
);

campaignWorker.on("failed", (job, err) => {
  log.error({ err, jobId: job?.id }, "campaign job failed");
});

const webhookWorker = new Worker(
  QUEUE_NAMES.webhooks,
  async (job) => {
    const { webhookId, event, payload } = job.data as {
      webhookId: string;
      event: string;
      payload: Record<string, unknown>;
    };
    const hook = await prisma.webhook.findUnique({ where: { id: webhookId } });
    if (!hook || !hook.isActive) return;
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", hook.secret).update(body).digest("hex");
    const delivery = await prisma.webhookDelivery.create({
      data: { webhookId, event, payload: payload as any, attempts: job.attemptsMade + 1 },
    });
    try {
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wacalls-signature": signature,
          "x-wacalls-event": event,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { success: res.ok, statusCode: res.status },
      });
      if (!res.ok) throw new Error(`webhook ${res.status}`);
    } catch (err) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { success: false, lastError: err instanceof Error ? err.message : "error" },
      });
      throw err;
    }
  },
  { connection, concurrency: 8 },
);

const retryWorker = new Worker(
  QUEUE_NAMES.retries,
  async (job) => {
    const data = job.data as { campaignId: string; organizationId: string };
    const q = new Queue(QUEUE_NAMES.campaigns, { connection });
    await q.add("run", data);
    await q.close();
  },
  { connection },
);

const appointmentWorker = new Worker(
  QUEUE_NAMES.appointmentReminders,
  async (job) => {
    const { appointmentId } = job.data as { appointmentId: string };
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { aiConfig: true, channel: true },
    });
    if (!appt || appt.status !== "BOOKED" || appt.reminderSentAt) return { skipped: true };
    const { reminderBody } = await import("@wacalls/database");
    const body = reminderBody(appt.aiConfig.appointmentMessage, appt.contactName, appt.startsAt);
    const row = await prisma.message.create({
      data: {
        organizationId: appt.organizationId,
        channelId: appt.channelId,
        contactId: appt.contactId,
        phone: appt.phone,
        body,
        provider: appt.channel.provider,
        status: "QUEUED",
      },
    });
    try {
      let externalId: string | undefined;
      if (appt.channel.provider === "CLOUD") {
        if (!appt.channel.cloudPhoneNumberId || !appt.channel.cloudAccessToken) {
          throw new Error("Cloud API credentials missing");
        }
        const to = appt.phone.replace(/\D/g, "");
        const res = await fetch(`https://graph.facebook.com/v21.0/${appt.channel.cloudPhoneNumberId}/messages`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${appt.channel.cloudAccessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body },
          }),
        });
        const json = (await res.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
        if (!res.ok) throw new Error(json.error?.message ?? `Cloud API ${res.status}`);
        externalId = json.messages?.[0]?.id;
      } else {
        const sent = await wa<{ id?: string; data?: { id?: string } }>("/internal/messages", {
          method: "POST",
          body: JSON.stringify({ channelId: appt.channelId, phone: appt.phone, text: body }),
        });
        externalId = sent.id ?? sent.data?.id;
      }
      await prisma.message.update({
        where: { id: row.id },
        data: { status: "SENT", externalId, sentAt: new Date() },
      });
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { reminderSentAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "send failed";
      await prisma.message.update({ where: { id: row.id }, data: { status: "FAILED", error: message } });
      throw err;
    }
    return { sent: true };
  },
  { connection },
);

const autoReplyWorker = new Worker(
  QUEUE_NAMES.autoReplies,
  async (job) => {
    const { callId, ruleId } = job.data as { callId: string; ruleId: string };
    const rule = await prisma.autoReplyRule.findUnique({
      where: { id: ruleId },
      include: { messageTemplate: true },
    });
    if (!rule?.enabled) return { skipped: "disabled" };
    const call = await prisma.call.findUnique({
      where: { id: callId },
      include: { contact: true },
    });
    if (!call) return { skipped: "no-call" };
    if (call.source === "inbound") return { skipped: "inbound" };
    const digits = digitsOnly(call.phone);
    const existing = await prisma.autoReplySend.findUnique({
      where: { ruleId_callId: { ruleId, callId } },
    });
    if (existing?.status === "SENT") return { skipped: "already" };
    if (rule.cooldownMinutes > 0) {
      const since = new Date(Date.now() - rule.cooldownMinutes * 60_000);
      const recent = await prisma.autoReplySend.findFirst({
        where: { ruleId, phone: digits, status: "SENT", sentAt: { gte: since } },
      });
      if (recent) {
        await prisma.autoReplySend.upsert({
          where: { ruleId_callId: { ruleId, callId } },
          create: { ruleId, callId, phone: digits, status: "SKIPPED", error: "cooldown" },
          update: { status: "SKIPPED", error: "cooldown" },
        });
        return { skipped: "cooldown" };
      }
    }
    if (call.contact?.doNotCall) {
      await prisma.autoReplySend.upsert({
        where: { ruleId_callId: { ruleId, callId } },
        create: { ruleId, callId, phone: digits, status: "SKIPPED", error: "do_not_call" },
        update: { status: "SKIPPED", error: "do_not_call" },
      });
      return { skipped: "dnc" };
    }
    const send = await prisma.autoReplySend.upsert({
      where: { ruleId_callId: { ruleId, callId } },
      create: { ruleId, callId, phone: digits, status: "QUEUED" },
      update: { status: "QUEUED", error: null },
    });
    try {
      await sendChannelText({
        organizationId: call.organizationId,
        channelId: call.channelId,
        phone: call.phone,
        contactId: call.contactId,
        contactName: call.contactName ?? call.contact?.name,
        email: call.contact?.email,
        company: call.contact?.company,
        body: rule.body,
        campaignId: call.campaignId,
        imagePath: rule.imagePath,
        typingMs: rule.showTyping ? Math.max(0, rule.typingSeconds) * 1000 : 0,
        template: rule.messageTemplate,
      });
      await prisma.autoReplySend.update({
        where: { id: send.id },
        data: { status: "SENT", sentAt: new Date(), error: null },
      });
      return { sent: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "send failed";
      await prisma.autoReplySend.update({
        where: { id: send.id },
        data: { status: "FAILED", error: message },
      });
      throw err;
    }
  },
  { connection, concurrency: 6 },
);

const shutdown = async () => {
  await Promise.all([
    callWorker.close(),
    campaignWorker.close(),
    webhookWorker.close(),
    retryWorker.close(),
    appointmentWorker.close(),
    autoReplyWorker.close(),
    callQ.close(),
    autoReplyQ.close(),
  ]);
  await inboundSub.quit().catch(() => undefined);
  redis.disconnect();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("unhandledRejection", (reason) => {
  log.error({ err: reason }, "unhandled rejection");
});
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info("WaCalls worker started");
void resumeRunningCampaigns().catch((err) => {
  log.error({ err }, "failed to resume running campaigns");
});
