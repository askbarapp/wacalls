import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { CALL_OUTCOMES, NotFoundError, ok } from "@wacalls/shared";
import { enqueueCall } from "../services/calls.js";
import { whatsappClient } from "../services/whatsapp-client.js";
import { ChannelWaitQueue } from "@wacalls/queue";
import { redis } from "../redis.js";

const waitQueue = new ChannelWaitQueue(redis);

export const callRoutes: FastifyPluginAsync = async (app) => {
  app.post("/calls", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("dialer.use")(req);
    const body = z
      .object({
        channel_id: z.string().uuid(),
        phone: z.string().min(6),
        contact_name: z.string().optional(),
        campaign_id: z.string().uuid().optional(),
        contact_id: z.string().uuid().optional(),
      })
      .parse(req.body);
    const { call, position } = await enqueueCall({
      organizationId: auth.orgId,
      channelId: body.channel_id,
      phone: body.phone,
      contactName: body.contact_name,
      campaignId: body.campaign_id,
      contactId: body.contact_id,
      agentId: auth.sub,
    });
    return {
      success: true,
      call_id: call.id,
      status: "QUEUED",
      queue_position: position,
    };
  });

  app.get("/calls", async (req) => {
    const auth = await app.authenticate(req);
    const q = req.query as Record<string, string | undefined>;
    const where: any = { organizationId: auth.orgId };
    if (auth.role === "AGENT") where.agentId = auth.sub;
    if (q.status) where.status = q.status;
    if (q.channelId) where.channelId = q.channelId;
    if (q.campaignId) where.campaignId = q.campaignId;
    if (q.agentId && auth.role !== "AGENT") where.agentId = q.agentId;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) where.createdAt.lte = new Date(q.to);
    }
    const calls = await prisma.call.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { channel: true, campaign: true, agent: { select: { id: true, name: true } } },
    });
    return ok(calls);
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
    const position = await waitQueue.position(call.channelId, call.id);
    return ok({ ...call, queuePosition: position || null });
  });

  app.post("/calls/:id/hangup", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const call = await prisma.call.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!call) throw new NotFoundError();
    await whatsappClient.hangup(call.engineCallId ?? call.id);
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
    await whatsappClient.mute(call.engineCallId ?? call.id, body.muted);
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
