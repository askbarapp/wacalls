import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma, type Prisma } from "@wacalls/database";
import { ConflictError, normalizePhone, NotFoundError } from "@wacalls/shared";
import { ChannelLock, ChannelWaitQueue, channelLockIsStale } from "@wacalls/queue";
import { renderVoiceScript, SarvamClient } from "@wacalls/audio-engine";
import { callQueue } from "../queues.js";
import { redis } from "../redis.js";
import { env } from "../env.js";
import { enqueueWebhook } from "./webhooks.js";
import { assertCallQuota } from "./org.js";
import { resolveSarvamApiKey } from "./sarvam-key.js";
import { whatsappClient } from "./whatsapp-client.js";

const waitQueue = new ChannelWaitQueue(redis);
const lock = new ChannelLock(redis);

const TERMINAL = ["ENDED", "FAILED", "BUSY", "NO_ANSWER", "REJECTED", "CANCELLED"];

async function acquireLine(channelId: string, owner: string): Promise<boolean> {
  if (await lock.acquire(channelId, owner)) return true;
  const currentOwner = await lock.owner(channelId);
  if (!currentOwner) return lock.acquire(channelId, owner);
  if (currentOwner === owner) return true;
  const ownerCall = await prisma.call.findUnique({ where: { id: currentOwner } });
  if (!channelLockIsStale(ownerCall)) return false;
  if (ownerCall && !TERMINAL.includes(ownerCall.status)) {
    await whatsappClient.hangup(ownerCall.engineCallId ?? ownerCall.id).catch(() => undefined);
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
  return lock.acquire(channelId, owner);
}

async function cancelLeftoverQueued(channelId: string, keepCallId: string) {
  const leftover = await waitQueue.clear(channelId);
  for (const id of leftover) {
    if (id === keepCallId) continue;
    await prisma.call
      .updateMany({
        where: { id, status: "QUEUED" },
        data: { status: "CANCELLED", failureReason: "superseded", endedAt: new Date() },
      })
      .catch(() => undefined);
  }
}

function watchLockUntilDone(callId: string, channelId: string, owner: string) {
  const heartbeat = setInterval(() => {
    void lock.renew(channelId, owner);
  }, 30_000);
  const started = Date.now();
  const tick = setInterval(() => {
    void (async () => {
      const call = await prisma.call.findUnique({ where: { id: callId } });
      const done = call && TERMINAL.includes(call.status);
      const timeout = Date.now() - started > 15 * 60_000;
      if (done || timeout) {
        clearInterval(heartbeat);
        clearInterval(tick);
        await lock.release(channelId, owner);
      }
    })();
  }, 1000);
}

export async function prepareDialerMedia(input: {
  organizationId: string;
  mode: "live" | "ai" | "tts" | "recording";
  phone: string;
  contactName?: string;
  aiConfigId?: string;
  recordingId?: string;
  ttsBody?: string;
  ttsLanguage?: string;
  ttsSpeaker?: string;
}): Promise<{
  aiConfigId?: string;
  recordingPath?: string;
  hangupAfterPlayback?: boolean;
  transcript?: { source: "ai" | "tts"; language?: string | null; turns: Array<{ role: "user" | "assistant"; text: string; at: string }> };
}> {
  if (input.mode === "ai") {
    if (!input.aiConfigId) throw new ConflictError("Pick an AI agent before calling.");
    const agent = await prisma.aiConfig.findFirst({
      where: { id: input.aiConfigId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!agent) throw new NotFoundError("AI agent not found");
    await resolveSarvamApiKey(input.organizationId);
    return { aiConfigId: agent.id, hangupAfterPlayback: false };
  }
  if (input.mode === "recording") {
    if (!input.recordingId) throw new ConflictError("Upload or pick an audio file first.");
    const rec = await prisma.recording.findFirst({
      where: { id: input.recordingId, organizationId: input.organizationId },
    });
    if (!rec?.filePath) throw new NotFoundError("Recording not found");
    return { recordingPath: rec.filePath, hangupAfterPlayback: true };
  }
  if (input.mode === "tts") {
    const script = renderVoiceScript(input.ttsBody ?? "", {
      name: input.contactName,
      phone: input.phone,
    });
    if (!script.trim()) throw new ConflictError("Write a message for the caller to hear.");
    const key = await resolveSarvamApiKey(input.organizationId);
    const speaker = input.ttsSpeaker?.trim() || "shubh";
    const language = input.ttsLanguage?.trim() || "hi-IN";
    const hash = createHash("sha256").update(`${speaker}:${language}:${script}`).digest("hex").slice(0, 20);
    const dir = path.join(env.RECORDINGS_DIR, "tts", input.organizationId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `dialer-${hash}.wav`);
    const wav = await new SarvamClient(key).synthesize(script, {
      language,
      speaker,
      sampleRate: 16_000,
    });
    await writeFile(filePath, wav);
    return {
      recordingPath: filePath,
      hangupAfterPlayback: true,
      transcript: {
        source: "tts",
        language,
        turns: [{ role: "assistant", text: script, at: new Date().toISOString() }],
      },
    };
  }
  return {};
}

export async function enqueueCall(input: {
  organizationId: string;
  channelId: string;
  phone: string;
  contactName?: string;
  campaignId?: string;
  agentId?: string;
  contactId?: string;
  campaignContactId?: string;
  source?: string;
  recordingPath?: string;
  aiConfigId?: string;
  hangupAfterPlayback?: boolean;
  transcript?: {
    source: "ai" | "tts";
    language?: string | null;
    turns: Array<{ role: "user" | "assistant"; text: string; at: string }>;
  };
}) {
  const phone = normalizePhone(input.phone);
  if (!phone.ok) throw new ConflictError("Invalid phone number");

  const channel = await prisma.whatsAppChannel.findFirst({
    where: { id: input.channelId, organizationId: input.organizationId },
  });
  if (!channel) throw new NotFoundError("Channel not found");
  await assertCallQuota(input.organizationId);
  if (channel.provider === "CLOUD") {
    throw new ConflictError(
      "Cloud API channels send WhatsApp messages, not voice calls. Use a WhatsApp Web channel for calling.",
    );
  }

  const live = await whatsappClient.status(channel.id).catch(() => ({ status: channel.status }));
  if (live.status !== "CONNECTED") {
    throw new ConflictError(
      live.status === "RECONNECTING"
        ? "WhatsApp is reconnecting. Wait a few seconds, then call again."
        : "WhatsApp is not connected. Open WhatsApp → Reconnect, scan with Linked Devices, then call again.",
    );
  }

  if (input.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: input.organizationId },
    });
    if (contact?.doNotCall) throw new ConflictError("Contact is on DO_NOT_CALL");
  }

  const call = await prisma.call.create({
    data: {
      organizationId: input.organizationId,
      channelId: input.channelId,
      phone: phone.e164,
      contactName: input.contactName,
      campaignId: input.campaignId,
      agentId: input.agentId,
      contactId: input.contactId,
      campaignContactId: input.campaignContactId,
      source: input.source ?? "dialer",
      status: "QUEUED",
      ...(input.transcript ? { transcript: input.transcript as Prisma.InputJsonValue } : {}),
    },
  });

  try {
    const owner = call.id;
    const acquired = await acquireLine(input.channelId, owner);

    if (acquired) {
      await cancelLeftoverQueued(input.channelId, call.id);
      await prisma.call.update({
        where: { id: call.id },
        data: { status: "CONNECTING", startedAt: new Date() },
      });
      watchLockUntilDone(call.id, input.channelId, owner);
      const connectingCall = await prisma.call.findUnique({ where: { id: call.id } });
      const job = {
        callId: call.id,
        organizationId: input.organizationId,
        channelId: input.channelId,
        phone: phone.e164,
        contactName: input.contactName,
        campaignId: input.campaignId,
        recordingPath: input.recordingPath,
        aiConfigId: input.aiConfigId,
        hangupAfterPlayback: input.hangupAfterPlayback,
      };
      if (input.aiConfigId || input.recordingPath) {
        await callQueue.add("place-call", job, { jobId: call.id });
      } else {
        void whatsappClient
          .placeCall({
            callId: call.id,
            channelId: input.channelId,
            organizationId: input.organizationId,
            phone: phone.e164,
            audioFilePath: input.recordingPath,
          })
          .catch(async (err) => {
            const message = err instanceof Error ? err.message : "Call failed to start";
            await prisma.call
              .update({
                where: { id: call.id },
                data: { status: "FAILED", failureReason: message, endedAt: new Date() },
              })
              .catch(() => undefined);
            await lock.release(input.channelId, owner).catch(() => undefined);
          });
      }
      await enqueueWebhook(input.organizationId, "call.started", {
        call_id: call.id,
        channel_id: input.channelId,
        contact_id: input.contactId,
        status: "CONNECTING",
      });
      return { call: connectingCall ?? call, position: 1 };
    }

    if ((input.source ?? "dialer") === "dialer") {
      await prisma.call.update({
        where: { id: call.id },
        data: {
          status: "FAILED",
          failureReason: "A call is already in progress on this line",
          endedAt: new Date(),
        },
      });
      throw new ConflictError(
        "A call is already in progress on this WhatsApp line. End that call first, then dial again.",
      );
    }

    const position = await waitQueue.enqueue(input.channelId, call.id);
    await callQueue.add(
      "place-call",
      {
        callId: call.id,
        organizationId: input.organizationId,
        channelId: input.channelId,
        phone: phone.e164,
        contactName: input.contactName,
        campaignId: input.campaignId,
        recordingPath: input.recordingPath,
        aiConfigId: input.aiConfigId,
        hangupAfterPlayback: input.hangupAfterPlayback,
      },
      { jobId: call.id },
    );

    await enqueueWebhook(input.organizationId, "call.started", {
      call_id: call.id,
      channel_id: input.channelId,
      contact_id: input.contactId,
      status: "QUEUED",
      queue_position: position,
    });

    return { call, position };
  } catch (err) {
    await lock.release(input.channelId, call.id).catch(() => undefined);
    await prisma.call
      .update({
        where: { id: call.id },
        data: {
          status: "FAILED",
          failureReason: err instanceof Error ? err.message : "call failed",
          endedAt: new Date(),
        },
      })
      .catch(() => undefined);
    throw new ConflictError(err instanceof Error ? err.message : "Could not start the call");
  }
}

export async function hangupCall(organizationId: string, callId: string) {
  const call = await prisma.call.findFirst({
    where: { id: callId, organizationId },
  });
  if (!call) throw new NotFoundError();

  await whatsappClient.hangup(call.engineCallId ?? call.id).catch(() => undefined);

  if (!TERMINAL.includes(call.status)) {
    const now = Date.now();
    const start = call.answeredAt ?? call.startedAt;
    const durationMs = start ? Math.max(0, now - new Date(start).getTime()) : 0;
    const status = call.status === "ANSWERED" ? "ENDED" : "CANCELLED";
    await prisma.call.update({
      where: { id: call.id },
      data: {
        status,
        endedAt: new Date(),
        durationMs,
        failureReason: status === "CANCELLED" ? "hangup" : call.failureReason,
      },
    });
  }

  await waitQueue.remove(call.channelId, call.id).catch(() => undefined);
  const owner = await lock.owner(call.channelId);
  const ownerCall = owner ? await prisma.call.findUnique({ where: { id: owner } }) : null;
  if (!owner || owner === call.id || channelLockIsStale(ownerCall)) {
    await lock.forceRelease(call.channelId);
    const leftover = await waitQueue.clear(call.channelId);
    for (const id of leftover) {
      if (id === call.id) continue;
      await prisma.call
        .updateMany({
          where: { id, status: "QUEUED" },
          data: { status: "CANCELLED", failureReason: "line freed", endedAt: new Date() },
        })
        .catch(() => undefined);
    }
  } else {
    await lock.release(call.channelId, call.id).catch(() => undefined);
  }
}
