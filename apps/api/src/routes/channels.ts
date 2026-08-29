import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { ok, NotFoundError } from "@wacalls/shared";
import { whatsappClient } from "../services/whatsapp-client.js";
import { ChannelWaitQueue } from "@wacalls/queue";
import { redis } from "../redis.js";

const waitQueue = new ChannelWaitQueue(redis);

export const channelRoutes: FastifyPluginAsync = async (app) => {
  app.get("/channels", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("channels.manage")(req).catch(async () => {
      await app.requirePermission("dialer.use")(req);
    });
    const channels = await prisma.whatsAppChannel.findMany({
      where: { organizationId: auth.orgId },
      orderBy: { createdAt: "desc" },
    });
    return ok(channels);
  });

  app.post("/channels", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("channels.manage")(req);
    const body = z.object({ displayName: z.string().min(1) }).parse(req.body);
    const channel = await prisma.whatsAppChannel.create({
      data: {
        organizationId: auth.orgId,
        displayName: body.displayName,
        callingEngine: process.env.CALLING_ENGINE ?? "selfhosted",
      },
    });
    await prisma.whatsAppSession.create({
      data: {
        channelId: channel.id,
        organizationId: auth.orgId,
        storagePath: `${auth.orgId}/${channel.id}`,
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: auth.orgId,
        userId: auth.sub,
        action: "channel.create",
        entity: "WhatsAppChannel",
        entityId: channel.id,
      },
    });
    return ok(channel);
  });

  app.post("/channels/:id/connect", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("channels.manage")(req);
    const { id } = req.params as { id: string };
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!channel) throw new NotFoundError("Channel not found");
    await prisma.whatsAppChannel.update({
      where: { id },
      data: { status: "CONNECTING" },
    });
    await whatsappClient.connect(id);
    return ok({ started: true });
  });

  app.get("/channels/:id/qr", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("channels.manage")(req);
    const { id } = req.params as { id: string };
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!channel) throw new NotFoundError();
    const qr = await whatsappClient.qr(id);
    return ok(qr);
  });

  app.post("/channels/:id/disconnect", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("channels.manage")(req);
    const { id } = req.params as { id: string };
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!channel) throw new NotFoundError();
    await whatsappClient.disconnect(id);
    await prisma.whatsAppChannel.update({
      where: { id },
      data: { status: "DISCONNECTED" },
    });
    return ok({ disconnected: true });
  });

  app.get("/channels/:id/live", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!channel) throw new NotFoundError();
    const current = await prisma.call.findFirst({
      where: {
        channelId: id,
        status: { in: ["CONNECTING", "RINGING", "ANSWERED"] },
      },
      include: { agent: true },
    });
    const queued = await waitQueue.snapshot(id);
    return ok({
      channel,
      currentCall: current,
      queue: queued.map((callId, i) => ({ position: i + 1, callId })),
    });
  });
};
