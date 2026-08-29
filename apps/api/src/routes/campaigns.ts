import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { CAMPAIGN_TYPES, ConflictError, NotFoundError, ok } from "@wacalls/shared";
import { campaignQueue } from "../queues.js";
import { enqueueWebhook } from "../services/webhooks.js";
import { whatsappClient } from "../services/whatsapp-client.js";

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  app.get("/campaigns", async (req) => {
    const auth = await app.authenticate(req);
    const campaigns = await prisma.campaign.findMany({
      where: { organizationId: auth.orgId },
      include: { _count: { select: { campaignContacts: true, calls: true } }, channel: true },
      orderBy: { createdAt: "desc" },
    });
    return ok(campaigns);
  });

  app.post("/campaigns", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const body = z
      .object({
        name: z.string(),
        channelId: z.string().uuid(),
        contactListId: z.string().uuid(),
        type: z.enum(CAMPAIGN_TYPES).default("SEQUENTIAL"),
        maxAttempts: z.number().int().min(1).max(10).default(3),
        retryDelayMin: z.number().int().min(1).default(30),
        recordingId: z.string().uuid().optional(),
        aiConfigId: z.string().uuid().optional(),
        afterRecording: z.enum(["HANGUP", "WAIT_FOR_RESPONSE", "TRANSFER_TO_AGENT"]).optional(),
        scheduleAt: z.string().datetime().optional(),
      })
      .parse(req.body);

    if (body.type === "RECORDED" || body.type === "AI_VOICE") {
      const caps = await whatsappClient.capabilities();
      if (body.type === "RECORDED" && !caps.capabilities.recordedPlayback) {
        throw new ConflictError(
          "Recorded playback is not available on the current calling engine. See docs/CALLING_ENGINE.md.",
        );
      }
      if (body.type === "AI_VOICE" && !caps.capabilities.realtimeAi) {
        throw new ConflictError(
          "Real-time AI voice is experimental and not enabled on this engine.",
        );
      }
    }

    const list = await prisma.contactList.findFirst({
      where: { id: body.contactListId, organizationId: auth.orgId },
      include: { members: true },
    });
    if (!list) throw new NotFoundError("List not found");

    const campaign = await prisma.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: {
          organizationId: auth.orgId,
          name: body.name,
          channelId: body.channelId,
          contactListId: body.contactListId,
          type: body.type,
          maxAttempts: body.maxAttempts,
          retryDelayMin: body.retryDelayMin,
          recordingId: body.recordingId,
          aiConfigId: body.aiConfigId,
          afterRecording: body.afterRecording ?? "HANGUP",
          scheduleAt: body.scheduleAt ? new Date(body.scheduleAt) : null,
          status: body.scheduleAt ? "SCHEDULED" : "DRAFT",
        },
      });
      if (list.members.length) {
        await tx.campaignContact.createMany({
          data: list.members.map((m) => ({
            campaignId: created.id,
            contactId: m.contactId,
          })),
        });
      }
      return created;
    });
    return ok(campaign);
  });

  app.post("/campaigns/:id/start", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const { id } = req.params as { id: string };
    const campaign = await prisma.campaign.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!campaign) throw new NotFoundError();
    await prisma.campaign.update({ where: { id }, data: { status: "RUNNING" } });
    await campaignQueue.add("run", { campaignId: id, organizationId: auth.orgId }, { jobId: `camp-${id}` });
    await enqueueWebhook(auth.orgId, "campaign.started", { campaign_id: id });
    return ok({ status: "RUNNING" });
  });

  app.post("/campaigns/:id/pause", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const { id } = req.params as { id: string };
    await prisma.campaign.updateMany({
      where: { id, organizationId: auth.orgId },
      data: { status: "PAUSED" },
    });
    return ok({ status: "PAUSED" });
  });

  app.post("/campaigns/:id/stop", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const { id } = req.params as { id: string };
    await prisma.campaign.updateMany({
      where: { id, organizationId: auth.orgId },
      data: { status: "CANCELLED" },
    });
    return ok({ status: "CANCELLED" });
  });

  app.post("/campaigns/:id/skip", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const { id } = req.params as { id: string };
    const body = z.object({ campaignContactId: z.string().uuid() }).parse(req.body);
    await prisma.campaignContact.updateMany({
      where: { id: body.campaignContactId, campaign: { id, organizationId: auth.orgId } },
      data: { skipped: true, status: "skipped" },
    });
    return ok({ skipped: true });
  });

  app.post("/campaigns/:id/retry", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const { id } = req.params as { id: string };
    const body = z.object({ campaignContactId: z.string().uuid() }).parse(req.body);
    await prisma.campaignContact.updateMany({
      where: { id: body.campaignContactId, campaign: { id, organizationId: auth.orgId } },
      data: { status: "pending", skipped: false, nextAttemptAt: new Date() },
    });
    await campaignQueue.add("run", { campaignId: id, organizationId: auth.orgId });
    return ok({ retried: true });
  });
};
