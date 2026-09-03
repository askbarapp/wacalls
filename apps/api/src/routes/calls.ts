import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, type Prisma, hasCallTranscript, parseCallTranscript } from "@wacalls/database";
import { CALL_OUTCOMES, CALL_STATUSES, ConflictError, NotFoundError, ok } from "@wacalls/shared";
import { enqueueCall, hangupCall, prepareDialerMedia } from "../services/calls.js";
import { whatsappClient } from "../services/whatsapp-client.js";
import { ChannelWaitQueue } from "@wacalls/queue";
import { redis } from "../redis.js";

const CALL_RESULTS = [
  "answered",
  "no_answer",
  "busy",
  "rejected",
  "failed",
  "cancelled",
  "in_progress",
  "missed",
] as const;

const optionalString = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().optional(),
);

function resultWhere(result: (typeof CALL_RESULTS)[number]): Prisma.CallWhereInput {
  switch (result) {
    case "answered":
      return {
        OR: [
          { answeredAt: { not: null } },
          { status: { in: ["ANSWERED", "ENDED"] } },
          { outcome: "ANSWERED" },
        ],
      };
    case "no_answer":
      return { status: "NO_ANSWER" };
    case "busy":
      return { status: "BUSY" };
    case "rejected":
      return { status: "REJECTED" };
    case "failed":
      return { status: "FAILED" };
    case "cancelled":
      return { status: "CANCELLED" };
    case "in_progress":
      return { status: { in: ["QUEUED", "CONNECTING", "RINGING", "ANSWERED"] } };
    case "missed":
      return { status: { in: ["NO_ANSWER", "BUSY", "REJECTED"] } };
    default:
      return {};
  }
}

const waitQueue = new ChannelWaitQueue(redis);

export const callRoutes: FastifyPluginAsync = async (app) => {
  app.post("/calls", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("dialer.use")(req);
    await app.requireScope("calls:write")(req);
    const body = z
      .object({
        channel_id: z.string().uuid(),
        phone: z.string().min(6),
        contact_name: z.string().optional(),
        campaign_id: z.string().uuid().optional(),
        contact_id: z.string().uuid().optional(),
        mode: z.enum(["live", "ai", "tts", "recording"]).optional(),
        ai_config_id: z.string().uuid().optional(),
        recording_id: z.string().uuid().optional(),
        tts_body: z.string().optional(),
        tts_language: z.string().optional(),
        tts_speaker: z.string().optional(),
      })
      .parse(req.body);
    const media = await prepareDialerMedia({
      organizationId: auth.orgId,
      mode: body.mode ?? "live",
      phone: body.phone,
      contactName: body.contact_name,
      aiConfigId: body.ai_config_id,
      recordingId: body.recording_id,
      ttsBody: body.tts_body,
      ttsLanguage: body.tts_language,
      ttsSpeaker: body.tts_speaker,
    });
    const { call, position } = await enqueueCall({
      organizationId: auth.orgId,
      channelId: body.channel_id,
      phone: body.phone,
      contactName: body.contact_name,
      campaignId: body.campaign_id,
      contactId: body.contact_id,
      agentId: auth.scopes?.length ? undefined : auth.sub,
      source: auth.scopes?.length ? "sdk" : "dialer",
      ...media,
    });
    return {
      success: true,
      call_id: call.id,
      status: call.status,
      queue_position: position,
    };
  });

  app.get("/calls", async (req) => {
    const auth = await app.authenticate(req);
    const q = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        status: z.preprocess(
          (v) => (v === "" || v == null ? undefined : v),
          z.enum(CALL_STATUSES).optional(),
        ),
        result: z.preprocess(
          (v) => (v === "" || v == null ? undefined : v),
          z.enum(CALL_RESULTS).optional(),
        ),
        source: optionalString,
        q: optionalString,
        channelId: z.preprocess(
          (v) => (v === "" || v == null ? undefined : v),
          z.string().uuid().optional(),
        ),
        campaignId: z.preprocess(
          (v) => (v === "" || v == null ? undefined : v),
          z.string().uuid().optional(),
        ),
        agentId: z.preprocess(
          (v) => (v === "" || v == null ? undefined : v),
          z.string().uuid().optional(),
        ),
        from: optionalString,
        to: optionalString,
      })
      .parse(req.query);

    const and: Prisma.CallWhereInput[] = [{ organizationId: auth.orgId }];
    if (auth.role === "AGENT") and.push({ agentId: auth.sub });
    if (q.status) and.push({ status: q.status });
    if (q.result) and.push(resultWhere(q.result));
    if (q.source) and.push({ source: q.source });
    if (q.channelId) and.push({ channelId: q.channelId });
    if (q.campaignId) and.push({ campaignId: q.campaignId });
    if (q.agentId && auth.role !== "AGENT") and.push({ agentId: q.agentId });
    if (q.q) {
      and.push({
        OR: [
          { phone: { contains: q.q, mode: "insensitive" } },
          { contactName: { contains: q.q, mode: "insensitive" } },
        ],
      });
    }
    const hasRecording = (req.query as Record<string, string | undefined>).hasRecording;
    if (hasRecording === "true" || hasRecording === "1") {
      and.push({ recordingPath: { not: null } });
    }
    const fromDate = q.from ? new Date(q.from) : null;
    const toDate = q.to ? new Date(q.to) : null;
    if (
      (fromDate && !Number.isNaN(fromDate.getTime())) ||
      (toDate && !Number.isNaN(toDate.getTime()))
    ) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (fromDate && !Number.isNaN(fromDate.getTime())) createdAt.gte = fromDate;
      if (toDate && !Number.isNaN(toDate.getTime())) {
        const end = new Date(toDate);
        if (q.to && q.to.length <= 10) end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
      and.push({ createdAt });
    }

    const where: Prisma.CallWhereInput = { AND: and };
    const skip = (q.page - 1) * q.limit;
    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: q.limit,
        include: {
          channel: { select: { id: true, displayName: true, phoneNumber: true } },
          campaign: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true } },
        },
      }),
      prisma.call.count({ where }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / q.limit));
    return {
      success: true as const,
      data: calls.map(({ transcript, ...call }) => ({
        ...call,
        hasTranscript: hasCallTranscript(transcript),
      })),
      meta: { page: q.page, limit: q.limit, total, totalPages },
    };
  });

  app.get("/calls/:id", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const call = await prisma.call.findFirst({
      where: { id, organizationId: auth.orgId },
      include: { attempts: true, channel: true },
    });
    if (!call) throw new NotFoundError();
    if (auth.role === "AGENT" && call.agentId !== auth.sub) throw new NotFoundError();
    const position =
      call.status === "QUEUED" ? await waitQueue.position(call.channelId, call.id) : null;
    return ok({ ...call, queuePosition: position || null, hasTranscript: hasCallTranscript(call.transcript) });
  });

  app.get("/calls/:id/transcript", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const call = await prisma.call.findFirst({
      where: { id, organizationId: auth.orgId },
      select: {
        id: true,
        phone: true,
        contactName: true,
        agentId: true,
        transcript: true,
        createdAt: true,
      },
    });
    if (!call) throw new NotFoundError();
    if (auth.role === "AGENT" && call.agentId !== auth.sub) throw new NotFoundError();
    const transcript = parseCallTranscript(call.transcript);
    if (!transcript?.turns.length) throw new NotFoundError("Transcript is not available yet");
    return ok({
      callId: call.id,
      phone: call.phone,
      contactName: call.contactName,
      createdAt: call.createdAt,
      source: transcript.source,
      language: transcript.language,
      turns: transcript.turns,
    });
  });

  app.get("/calls/:id/recording", async (req, reply) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const call = await prisma.call.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { recordingPath: true, agentId: true },
    });
    if (!call) throw new NotFoundError();
    if (auth.role === "AGENT" && call.agentId !== auth.sub) throw new NotFoundError();
    if (!call.recordingPath) throw new NotFoundError();
    const { createReadStream, existsSync, statSync } = await import("node:fs");
    if (!existsSync(call.recordingPath)) throw new NotFoundError();
    const stat = statSync(call.recordingPath);
    reply.header("content-type", "audio/wav");
    reply.header("content-length", String(stat.size));
    reply.header("content-disposition", `inline; filename="call-${id}.wav"`);
    reply.header("accept-ranges", "bytes");
    return reply.send(createReadStream(call.recordingPath));
  });

  app.post("/calls/:id/hangup", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    await hangupCall(auth.orgId, id);
    return ok({ hangingUp: true });
  });

  app.post("/calls/:id/mute", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const body = z.object({ muted: z.boolean() }).parse(req.body);
    const call = await prisma.call.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!call) throw new NotFoundError();
    try {
      await whatsappClient.mute(call.engineCallId ?? call.id, body.muted);
    } catch (err) {
      throw new ConflictError(err instanceof Error ? err.message : "Mute failed");
    }
    return ok({ muted: body.muted });
  });

  app.post("/calls/:id/result", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const body = z
      .object({
        outcome: z.enum(CALL_OUTCOMES),
        notes: z.string().optional(),
      })
      .parse(req.body);
    const call = await prisma.call.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!call) throw new NotFoundError();
    const updated = await prisma.call.update({
      where: { id },
      data: { outcome: body.outcome, notes: body.notes },
    });
    if (body.outcome === "DO_NOT_CALL" && call.contactId) {
      await prisma.contact.update({
        where: { id: call.contactId },
        data: { doNotCall: true },
      });
    }
    return ok(updated);
  });
};
