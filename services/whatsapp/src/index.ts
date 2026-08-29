import Fastify from "fastify";
import { Redis } from "ioredis";
import { prisma } from "@wacalls/database";
import { createCallingEngine, type CallingEngine } from "@wacalls/calling-engine";

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

const callIndex = new Map<string, { callId: string; channelId: string; organizationId: string }>();

engine.onCallEvent(async (event) => {
  const channel = event.channelId
    ? await prisma.whatsAppChannel.findUnique({ where: { id: event.channelId } })
    : null;

  if (event.type === "qr" || event.type === "channel_status") {
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

app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return;
  if (req.headers["x-internal-token"] !== INTERNAL_TOKEN) {
    return reply.status(401).send({ error: { message: "unauthorized" } });
  }
});

app.get("/health", async () => ({
  status: "ok",
  engine: engine.name,
  capabilities: engine.capabilities,
}));

app.get("/internal/capabilities", async () => ({
  name: engine.name,
  capabilities: engine.capabilities,
}));

app.post("/internal/channels/:id/connect", async (req) => {
  const { id } = req.params as { id: string };
  await engine.connect(id);
  return { ok: true };
});

app.post("/internal/channels/:id/disconnect", async (req) => {
  const { id } = req.params as { id: string };
  await engine.disconnect(id);
  return { ok: true };
});

app.get("/internal/channels/:id/qr", async (req) => {
  const { id } = req.params as { id: string };
  return { qr: await engine.getQr(id), status: await engine.getStatus(id) };
});

app.get("/internal/channels/:id/status", async (req) => {
  const { id } = req.params as { id: string };
  return { status: await engine.getStatus(id) };
});

app.post("/internal/calls", async (req, reply) => {
  const body = req.body as {
    callId: string;
    channelId: string;
    phone: string;
    organizationId: string;
    audioFilePath?: string;
  };
  try {
    const session = await engine.initiateCall(body.channelId, body.phone, {
      audioFilePath: body.audioFilePath,
      silence: !body.audioFilePath,
    });
    callIndex.set(session.callId, {
      callId: body.callId,
      channelId: body.channelId,
      organizationId: body.organizationId,
    });
    callIndex.set(session.engineCallId, {
      callId: body.callId,
      channelId: body.channelId,
      organizationId: body.organizationId,
    });
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

app.post("/internal/calls/:id/hangup", async (req) => {
  const { id } = req.params as { id: string };
  await engine.hangup(id);
  return { ok: true };
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

await app.listen({ port: PORT, host: "0.0.0.0" });
