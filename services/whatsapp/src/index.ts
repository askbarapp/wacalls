import Fastify from "fastify";
import { Redis } from "ioredis";
import { prisma } from "@wacalls/database";
import { createCallingEngine, type CallingEngine } from "@wacalls/calling-engine";
import { pushAgentDownlink, startVoiceAgent, stopVoiceAgent } from "./voice-agent.js";

process.on("unhandledRejection", (reason) => {
  console.error("[whatsapp] unhandledRejection", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[whatsapp] uncaughtException", err);
});

const PORT = Number(process.env.WHATSAPP_PORT ?? 4010);
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? "";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const SESSION_DIR = process.env.SESSION_DIR ?? "./sessions";
const APP_ENV = process.env.APP_ENV ?? "production";
const CALLING_ENGINE = process.env.CALLING_ENGINE ?? "selfhosted";

const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

const engine: CallingEngine = createCallingEngine({
  name: CALLING_ENGINE,
  appEnv: APP_ENV,
  selfHosted: {
    sessionRoot: SESSION_DIR,
    organizationResolver: async (channelId) => {
      const ch = await prisma.whatsAppChannel.findUnique({ where: { id: channelId } });
      if (!ch) throw new Error("Unknown channel");
      return { organizationId: ch.organizationId };
    },
  },
});

const callIndex = new Map<
  string,
  {
    callId: string;
    channelId: string;
    organizationId: string;
    aiConfigId?: string;
    hangupAfterPlayback?: boolean;
    phone?: string;
    contactName?: string | null;
  }
>();

engine.onCallEvent(async (event) => {
  const channel = event.channelId
    ? await prisma.whatsAppChannel.findUnique({ where: { id: event.channelId } })
    : null;

  if (event.type === "qr" || event.type === "channel_status") {
    if (event.type === "qr" && event.channelId && event.qrDataUrl) {
      await redis.set(`wacalls:qr:${event.channelId}`, event.qrDataUrl, "EX", 180);
    }
    if (event.type === "channel_status" && event.channelId && event.status === "CONNECTED") {
      await redis.del(`wacalls:qr:${event.channelId}`);
    }
    if (channel && event.status) {
      await prisma.whatsAppChannel.update({
        where: { id: channel.id },
        data: {
          status: event.status,
          sessionStatus: event.status,
          phoneNumber: event.phoneNumber ?? channel.phoneNumber,
          displayName: event.displayName ?? channel.displayName,
          lastConnectedAt: event.status === "CONNECTED" ? new Date() : channel.lastConnectedAt,
          lastSeenAt: new Date(),
          lastError: event.reason ?? null,
        },
      });
    }
    await redis.publish(
      "wacalls:events",
      JSON.stringify({
        ...event,
        organizationId: channel?.organizationId,
      }),
    );
    return;
  }

  const mapped = event.callId ? callIndex.get(event.callId) : undefined;
  const callId = mapped?.callId ?? event.callId;

  if (event.type === "audio") {
    if (callId && event.pcm && event.pcm.length) {
      const buf = Buffer.from(event.pcm.buffer, event.pcm.byteOffset, event.pcm.byteLength);
      await redis.publish(`wacalls:pcm:${callId}`, buf);
      pushAgentDownlink(callId, event.pcm);
    }
    return;
  }

  if (event.type === "playback_done") {
    const meta = mapped ?? (callId ? callIndex.get(callId) : undefined);
    if (meta?.hangupAfterPlayback && callId) {
      await engine.hangup(callId).catch(() => undefined);
    }
    return;
  }

  if (event.type === "recording") {
    if (callId && event.recordingPath) {
      await prisma.call.updateMany({
        where: { id: callId },
        data: { recordingPath: event.recordingPath },
      });
    }
    return;
  }

  if (callId) {
    const statusMap: Record<string, string> = {
      connecting: "CONNECTING",
      ringing: "RINGING",
      answered: "ANSWERED",
      ended: "ENDED",
      failed: "FAILED",
      busy: "BUSY",
      no_answer: "NO_ANSWER",
      rejected: "REJECTED",
    };
    const status = statusMap[event.type];
    if (status) {
      const data: any = { status };
      if (event.type === "answered") data.answeredAt = new Date();
      if (event.type === "connecting") data.startedAt = new Date();
      if (["ended", "failed", "busy", "no_answer", "rejected"].includes(event.type)) {
        data.endedAt = new Date();
        data.durationMs = event.durationMs ?? 0;
        data.failureReason = event.reason;
        if (event.type !== "ended") data.outcome = status;
      }
      await prisma.call.updateMany({ where: { id: callId }, data });
      if (event.type === "answered") {
        const meta = mapped ?? callIndex.get(callId);
        if (meta?.aiConfigId) {
          const row = await prisma.call.findUnique({ where: { id: callId } });
          void startVoiceAgent(engine, {
            callId,
            engineCallId: event.callId ?? callId,
            organizationId: meta.organizationId,
            contactName: row?.contactName ?? meta.contactName,
            phone: row?.phone ?? meta.phone ?? "",
            aiConfigId: meta.aiConfigId,
          }).catch((err) => console.warn("[whatsapp] AI voice agent failed to start", err));
        }
      }
      if (["ended", "failed", "busy", "no_answer", "rejected"].includes(event.type)) {
        await stopVoiceAgent(callId);
        if (event.callId && event.callId !== callId) await stopVoiceAgent(event.callId);
        const endedCall = await prisma.call.findUnique({ where: { id: callId } });
        if (endedCall?.campaignContactId && event.type === "ended") {
          await prisma.campaignContact.updateMany({
            where: { id: endedCall.campaignContactId },
            data: { status: "completed", lastOutcome: endedCall.outcome ?? "ANSWERED" },
          });
        }
        const channelId = mapped?.channelId ?? event.channelId;
        if (channelId) {
          const lockKey = `lock:whatsapp-channel:${channelId}`;
          const owner = await redis.get(lockKey);
          if (owner === callId) await redis.del(lockKey);
        }
        for (const [key, value] of callIndex) {
          if (value.callId === callId) callIndex.delete(key);
        }
      }
    }
  }

  await redis.publish(
    "wacalls:events",
    JSON.stringify({
      ...event,
      organizationId: mapped?.organizationId ?? channel?.organizationId,
      callId,
    }),
  );
});

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
});

app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return;
  if (req.headers["x-internal-token"] !== INTERNAL_TOKEN) {
    return reply.status(401).send({ error: { message: "unauthorized" } });
  }
});

app.get("/health", async () => {
  await engine.warmup?.();
  return {
    status: "ok",
    engine: engine.name,
    capabilities: engine.capabilities,
  };
});

app.get("/internal/capabilities", async () => {
  await engine.warmup?.();
  return {
    name: engine.name,
    capabilities: engine.capabilities,
  };
});

app.post("/internal/channels/:id/connect", async (req) => {
  const { id } = req.params as { id: string };
  const forceQr = (req.body as { forceQr?: boolean } | undefined)?.forceQr === true;
  const channel = await prisma.whatsAppChannel.findUnique({ where: { id } });
  // Return immediately so the UI can poll for QR while Baileys starts pairing.
  void engine.connect(id, { forceQr }).catch(async (err) => {
    const message = err instanceof Error ? err.message : "connect failed";
    app.log.error({ err, id }, "channel connect failed");
    if (channel) {
      await prisma.whatsAppChannel.update({
        where: { id },
        data: { status: "ERROR", sessionStatus: "ERROR", lastError: message },
      });
      await redis.publish(
        "wacalls:events",
        JSON.stringify({
          type: "channel_status",
          channelId: id,
          organizationId: channel.organizationId,
          status: "ERROR",
          reason: message,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  });
  return { ok: true, started: true };
});

app.post("/internal/channels/:id/disconnect", async (req) => {
  const { id } = req.params as { id: string };
  await engine.disconnect(id);
  return { ok: true };
});

app.get("/internal/channels/:id/qr", async (req) => {
  const { id } = req.params as { id: string };
  const live = await engine.getQr(id);
  const cached = live ?? (await redis.get(`wacalls:qr:${id}`));
  const channel = await prisma.whatsAppChannel.findUnique({ where: { id } });
  return {
    qr: cached,
    status: await engine.getStatus(id),
    lastError: channel?.lastError ?? null,
    engine: engine.name,
  };
});

app.get("/internal/channels/:id/status", async (req) => {
  const { id } = req.params as { id: string };
  return { status: await engine.getStatus(id) };
});

app.post("/internal/messages", async (req, reply) => {
  const body = req.body as { channelId: string; phone: string; text: string };
  try {
    const session = await engine.sendText(body.channelId, body.phone, body.text);
    return { success: true, id: session.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    return reply.status(409).send({
      success: false,
      error: { message, code: (err as { code?: string }).code ?? "SEND_FAILED" },
    });
  }
});

app.post("/internal/calls", async (req, reply) => {
  const body = req.body as {
    callId: string;
    channelId: string;
    phone: string;
    organizationId: string;
    audioFilePath?: string;
    aiConfigId?: string;
    hangupAfterPlayback?: boolean;
    contactName?: string | null;
  };
    try {
      await prisma.call.update({
        where: { id: body.callId },
        data: { status: "CONNECTING", startedAt: new Date() },
      });
      const meta = {
        callId: body.callId,
        channelId: body.channelId,
        organizationId: body.organizationId,
        aiConfigId: body.aiConfigId,
        hangupAfterPlayback: Boolean(body.hangupAfterPlayback),
        phone: body.phone,
        contactName: body.contactName,
      };
      callIndex.set(body.callId, meta);
      const session = await engine.initiateCall(body.channelId, body.phone, {
        audioFilePath: body.audioFilePath,
        silence: false,
        clientCallId: body.callId,
        aiConfigId: body.aiConfigId,
        hangupAfterPlayback: body.hangupAfterPlayback,
      });
    const latest = await prisma.call.findUnique({ where: { id: body.callId } });
    if (latest && ["ENDED", "FAILED", "BUSY", "NO_ANSWER", "REJECTED", "CANCELLED"].includes(latest.status)) {
      await engine.hangup(session.engineCallId).catch(() => undefined);
      return { success: true, session, cancelled: true };
    }
    callIndex.set(session.callId, meta);
    callIndex.set(session.engineCallId, meta);
    await prisma.call.update({
      where: { id: body.callId },
      data: { engineCallId: session.engineCallId, status: "CONNECTING", startedAt: new Date() },
    });
    return { success: true, session };
  } catch (err) {
    const message = err instanceof Error ? err.message : "call failed";
    await prisma.call.update({
      where: { id: body.callId },
      data: { status: "FAILED", failureReason: message, endedAt: new Date() },
    });
    return reply.status(409).send({
      success: false,
      error: { message, code: (err as { code?: string }).code ?? "CALL_FAILED" },
    });
  }
});

app.get("/internal/channels/:id/avatar", async (req) => {
  const { id } = req.params as { id: string };
  const phone = String((req.query as { phone?: string }).phone ?? "");
  const cacheKey = `wacalls:avatar:${id}:${phone.replace(/\D/g, "")}`;
  const cached = await redis.get(cacheKey);
  if (cached) return { avatar: cached };
  const avatar = (await engine.getProfilePicture?.(id, phone)) ?? null;
  if (avatar) await redis.set(cacheKey, avatar, "EX", 1800);
  return { avatar };
});

app.post("/internal/calls/:id/pcm", async (req) => {
  const { id } = req.params as { id: string };
  const body = req.body as Buffer;
  if (!body || !Buffer.isBuffer(body) || body.byteLength < 4) return { ok: true };
  const aligned = Buffer.from(body);
  const pcm = new Float32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 4));
  await engine.sendAudio(id, pcm);
  return { ok: true };
});

app.post("/internal/calls/:id/hangup", async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    await engine.hangup(id);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "hangup failed";
    return reply.status(409).send({ success: false, error: { message } });
  }
});

app.post("/internal/calls/:id/mute", async (req) => {
  const { id } = req.params as { id: string };
  const { muted } = req.body as { muted: boolean };
  await engine.mute(id, muted);
  return { ok: true };
});

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await engine.warmup?.();
app.log.info(
  { outboundVoice: engine.capabilities.outboundVoice },
  "calling engine ready",
);
await app.listen({ port: PORT, host: "0.0.0.0" });

async function restoreSavedSessions() {
  const channels = await prisma.whatsAppChannel.findMany({
    where: { provider: "WEB", status: { in: ["CONNECTED", "RECONNECTING", "CONNECTING"] } },
    select: { id: true, status: true },
  });
  for (const ch of channels) {
    app.log.info({ channelId: ch.id, status: ch.status }, "restoring WhatsApp Web session");
    void engine.connect(ch.id, { forceQr: false }).catch((err) => {
      app.log.error({ err, channelId: ch.id }, "session restore failed");
    });
  }
}
void restoreSavedSessions();
