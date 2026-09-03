import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { ok, NotFoundError, ConflictError } from "@wacalls/shared";
import { whatsappClient } from "../services/whatsapp-client.js";
import { ChannelWaitQueue } from "@wacalls/queue";
import { redis } from "../redis.js";
import { assertChannelQuota } from "../services/org.js";

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
    return ok(
      channels.map(({ cloudAccessToken, ...ch }) => ({
        ...ch,
        hasCloudToken: Boolean(cloudAccessToken),
      })),
    );
  });

  app.post("/channels", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("channels.manage")(req);
    const body = z
      .object({
        displayName: z.string().min(1),
        provider: z.enum(["WEB", "CLOUD"]).default("WEB"),
        phoneNumber: z.string().optional(),
        cloudPhoneNumberId: z.string().optional(),
        cloudAccessToken: z.string().optional(),
      })
      .parse(req.body);
    await assertChannelQuota(auth.orgId);
    if (body.provider === "CLOUD") {
      const org = await prisma.organization.findUnique({
        where: { id: auth.orgId },
        include: { plan: true },
      });
      if (org?.plan && !org.plan.allowCloudApi) {
        throw new ConflictError("Cloud API is not included in the current plan.");
      }
      if (!body.cloudPhoneNumberId || !body.cloudAccessToken) {
        throw new ConflictError("Cloud API needs phone number ID and access token.");
      }
    }
    const channel = await prisma.whatsAppChannel.create({
      data: {
        organizationId: auth.orgId,
        displayName: body.displayName,
        callingEngine: process.env.CALLING_ENGINE ?? "selfhosted",
        provider: body.provider,
        phoneNumber: body.phoneNumber,
        cloudPhoneNumberId: body.cloudPhoneNumberId,
        cloudAccessToken: body.cloudAccessToken,
        status: body.provider === "CLOUD" ? "CONNECTED" : "DISCONNECTED",
        sessionStatus: body.provider === "CLOUD" ? "CONNECTED" : "DISCONNECTED",
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
    const { cloudAccessToken: _token, ...safe } = channel;
    return ok({ ...safe, hasCloudToken: Boolean(_token) });
  });

  app.post("/channels/:id/connect", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("channels.manage")(req);
    const { id } = req.params as { id: string };
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!channel) throw new NotFoundError("Channel not found");
    if (channel.provider === "CLOUD") {
      return ok({ started: true, provider: "CLOUD" });
    }
    const body = z.object({ forceQr: z.boolean().optional() }).parse(req.body ?? {});
    await prisma.whatsAppChannel.update({
      where: { id },
      data: { status: "CONNECTING", lastError: null },
    });
    try {
      await whatsappClient.connect(id, { forceQr: body.forceQr === true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "WhatsApp engine unreachable";
      await prisma.whatsAppChannel.update({
        where: { id },
        data: { status: "ERROR", lastError: message },
      });
      throw new ConflictError(message);
    }
    return ok({ started: true });
  });

  app.post("/channels/:id/pair", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("channels.manage")(req);
    const { id } = req.params as { id: string };
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!channel) throw new NotFoundError("Channel not found");
    if (channel.provider === "CLOUD") {
      throw new ConflictError("Pairing code is only for WhatsApp Web lines");
    }
    const body = z.object({ phone: z.string().min(8).max(20) }).parse(req.body ?? {});
    await prisma.whatsAppChannel.update({
      where: { id },
      data: { status: "CONNECTING", lastError: null },
    });
    try {
      const result = await whatsappClient.pair(id, body.phone);
      return ok({ started: true, code: result.code });
    } catch (err) {
      const message = err instanceof Error ? err.message : "WhatsApp engine unreachable";
      await prisma.whatsAppChannel.update({
        where: { id },
        data: { status: "ERROR", lastError: message },
      });
      throw new ConflictError(message);
    }
  });

  app.get("/channels/:id/qr", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("channels.manage")(req);
    const { id } = req.params as { id: string };
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!channel) throw new NotFoundError();
    try {
      const qr = await whatsappClient.qr(id);
      return ok({
        qr: qr.qr,
        code: qr.code ?? null,
        pairingCode: qr.pairingCode ?? null,
        status: qr.status,
        lastError: qr.lastError ?? channel.lastError,
        engine: qr.engine,
      });
    } catch (err) {
      return ok({
        qr: null,
        code: null,
        pairingCode: null,
        status: channel.status,
        lastError: err instanceof Error ? err.message : "WhatsApp engine unreachable",
        engine: null,
      });
    }
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

  app.delete("/channels/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("channels.manage")(req);
    const { id } = req.params as { id: string };
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!channel) throw new NotFoundError("Channel not found");
    await whatsappClient.disconnect(id).catch(() => undefined);
    await prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({ where: { channelId: id } });
      await tx.call.deleteMany({ where: { channelId: id } });
      const campaigns = await tx.campaign.findMany({
        where: { channelId: id },
        select: { id: true },
      });
      const campaignIds = campaigns.map((c) => c.id);
      if (campaignIds.length) {
        await tx.campaignContact.deleteMany({ where: { campaignId: { in: campaignIds } } });
        await tx.campaign.deleteMany({ where: { id: { in: campaignIds } } });
      }
      await tx.whatsAppSession.deleteMany({ where: { channelId: id } });
      await tx.whatsAppChannel.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          organizationId: auth.orgId,
          userId: auth.sub,
          action: "channel.delete",
          entity: "WhatsAppChannel",
          entityId: id,
        },
      });
    });
    return ok({ deleted: true });
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
    const { cloudAccessToken: _token, ...safeChannel } = channel;
    return ok({
      channel: { ...safeChannel, hasCloudToken: Boolean(_token) },
      currentCall: current,
      queue: queued.map((callId, i) => ({ position: i + 1, callId })),
    });
  });

  app.get("/channels/:id/avatar", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("dialer.use")(req);
    const { id } = req.params as { id: string };
    const phone = z.string().min(6).parse((req.query as { phone?: string }).phone);
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!channel) throw new NotFoundError();
    try {
      const r = await whatsappClient.avatar(id, phone);
      return ok({ avatar: r.avatar ?? null, name: r.name ?? "" });
    } catch {
      return ok({ avatar: null, name: "" });
    }
  });
};
