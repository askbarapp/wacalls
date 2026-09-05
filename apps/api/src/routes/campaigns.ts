import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, hasCallTranscript, type Prisma } from "@wacalls/database";
import { CAMPAIGN_TYPES, ConflictError, NotFoundError, ok } from "@wacalls/shared";
import { campaignQueue } from "../queues.js";
import { enqueueWebhook } from "../services/webhooks.js";
import { STARTER_MESSAGE_TEMPLATES } from "./message-templates.js";

async function startCampaign(orgId: string, id: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: orgId },
    include: { campaignChannels: { include: { channel: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!campaign) throw new NotFoundError();
  const pool = campaign.campaignChannels.length
    ? campaign.campaignChannels.map((row) => row.channel)
    : [
        await prisma.whatsAppChannel.findFirst({
          where: { id: campaign.channelId, organizationId: orgId },
        }),
      ].filter((ch): ch is NonNullable<typeof ch> => Boolean(ch));
  const limit = campaign.rotationLimit > 0 ? Math.min(campaign.rotationLimit, pool.length) : pool.length;
  const rotating = pool.slice(0, Math.max(limit, 1));
  const voice = campaign.type !== "MESSAGE";
  const ready = rotating.filter((ch) => ch.status === "CONNECTED" && (!voice || ch.provider !== "CLOUD"));
  if (!ready.length) {
    throw new ConflictError(
      voice
        ? "Connect at least one WhatsApp Web line before starting. Scan QR from WhatsApp → Linked devices."
        : "Connect at least one WhatsApp number before starting this message campaign.",
    );
  }
  await prisma.campaign.update({ where: { id }, data: { status: "RUNNING" } });
  // Always enqueue a fresh run job so a stalled worker/redis cannot leave the campaign frozen.
  await campaignQueue.add(
    "run",
    { campaignId: id, organizationId: orgId },
    { jobId: `camp-${id}-${Date.now()}`, removeOnComplete: 100, removeOnFail: 50 },
  );
  await enqueueWebhook(orgId, "campaign.started", { campaign_id: id });
  return { status: "RUNNING" as const };
}

function parseSchedule(value?: string) {
  if (!value?.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ConflictError("Invalid schedule time.");
  return date;
}

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  app.get("/campaigns", async (req) => {
    const auth = await app.authenticate(req);
    const campaigns = await prisma.campaign.findMany({
      where: { organizationId: auth.orgId },
      include: {
        _count: { select: { campaignContacts: true, calls: true, messages: true } },
        channel: true,
        campaignChannels: {
          include: { channel: { select: { id: true, displayName: true, status: true, phoneNumber: true, provider: true } } },
          orderBy: { sortOrder: "asc" },
        },
        recording: { select: { id: true, name: true } },
        voiceTemplate: { select: { id: true, name: true } },
        messageTemplate: { select: { id: true, name: true } },
        contactList: { select: { id: true, name: true } },
        aiConfig: { select: { id: true, name: true, knowledgeBase: { select: { id: true, name: true } } } },
      },
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
        channelId: z.string().uuid().optional(),
        channelIds: z.array(z.string().uuid()).optional(),
        rotationLimit: z.number().int().min(0).max(50).optional(),
        contactListId: z.string().uuid(),
        type: z.enum(CAMPAIGN_TYPES).default("SEQUENTIAL"),
        maxAttempts: z.number().int().min(1).max(10).default(3),
        retryDelayMin: z.number().int().min(1).default(30),
        recordingId: z.string().uuid().optional(),
        voiceTemplateId: z.string().uuid().optional(),
        aiConfigId: z.string().uuid().optional(),
        afterRecording: z.enum(["HANGUP", "WAIT_FOR_RESPONSE", "TRANSFER_TO_AGENT"]).optional(),
        messageBody: z.string().optional(),
        messageTemplateId: z.string().optional(),
        scheduleAt: z.string().optional(),
        sendNow: z.boolean().optional(),
        ttsBody: z.string().optional(),
        ttsLanguage: z.string().optional(),
        ttsSpeaker: z.string().optional(),
        ttsPace: z.number().min(0.5).max(2).optional(),
        delayBetweenCallsSec: z.number().int().min(0).max(300).optional(),
        ringTimeoutSec: z.number().int().min(5).max(180).optional(),
        batchSize: z.number().int().min(0).max(500).optional(),
        sleepAfterBatchSec: z.number().int().min(0).max(3600).optional(),
      })
      .parse(req.body);

    if (body.type === "MESSAGE" && !body.messageBody?.trim() && !body.messageTemplateId) {
      throw new ConflictError("Pick a message template or write a message.");
    }
    if (body.type === "RECORDED" && !body.recordingId) {
      throw new ConflictError("Recorded campaigns need a recording. Upload one on Recordings first.");
    }
    if (body.type === "TTS" && !body.voiceTemplateId && !body.ttsBody?.trim()) {
      throw new ConflictError("Type a voice script for this campaign.");
    }
    if (body.type === "AI_VOICE" && !body.aiConfigId) {
      throw new ConflictError("AI calling campaigns need an AI agent.");
    }
    if (body.type === "TTS" || body.type === "AI_VOICE") {
      const { hasSarvamApiKey } = await import("../services/sarvam-key.js");
      if (!(await hasSarvamApiKey(auth.orgId))) {
        throw new ConflictError(
          "Add a Sarvam AI API key on AI calling before using text-to-speech or AI agents.",
        );
      }
    }
    if (body.type === "RECORDED") {
      const rec = await prisma.recording.findFirst({
        where: { id: body.recordingId, organizationId: auth.orgId },
      });
      if (!rec) throw new NotFoundError("Recording not found");
    }
    let voiceTemplateId = body.voiceTemplateId;
    if (body.type === "TTS" && !voiceTemplateId && body.ttsBody?.trim()) {
      const createdTpl = await prisma.voiceTemplate.create({
        data: {
          organizationId: auth.orgId,
          name: `${body.name.trim() || "Campaign"} script`,
          body: body.ttsBody.trim(),
          language: body.ttsLanguage?.trim() || "hi-IN",
          speaker: body.ttsSpeaker?.trim() || "shubh",
          pace: body.ttsPace ?? 1,
        },
      });
      voiceTemplateId = createdTpl.id;
    }
    if (voiceTemplateId) {
      const tpl = await prisma.voiceTemplate.findFirst({
        where: { id: voiceTemplateId, organizationId: auth.orgId },
      });
      if (!tpl) throw new NotFoundError("Voice template not found");
    }
    if (body.aiConfigId) {
      const agent = await prisma.aiConfig.findFirst({
        where: { id: body.aiConfigId, organizationId: auth.orgId },
      });
      if (!agent) throw new NotFoundError("AI agent not found");
      if (body.type === "AI_VOICE" && !agent.knowledgeBaseId) {
        throw new ConflictError("This AI agent has no knowledge base. Assign one before using it on a campaign.");
      }
    }

    let messageBody = body.messageBody?.trim() || "";
    let savedTemplateId: string | undefined;
    if (body.messageTemplateId) {
      const starter = STARTER_MESSAGE_TEMPLATES.find((t) => t.id === body.messageTemplateId);
      if (starter) {
        messageBody = starter.body;
        if (starter.kind !== "TEXT") {
          const cloned = await prisma.messageTemplate.create({
            data: {
              organizationId: auth.orgId,
              name: starter.name,
              kind: starter.kind,
              body: starter.body,
              header: "header" in starter ? starter.header : null,
              footer: "footer" in starter ? starter.footer : null,
              buttons: ("buttons" in starter ? starter.buttons : []) as Prisma.InputJsonValue,
              listButton: "listButton" in starter ? starter.listButton : null,
              sections: ("sections" in starter ? starter.sections : []) as Prisma.InputJsonValue,
            },
          });
          savedTemplateId = cloned.id;
        }
      } else {
        const tpl = await prisma.messageTemplate.findFirst({
          where: { id: body.messageTemplateId, organizationId: auth.orgId },
        });
        if (!tpl) throw new NotFoundError("Message template not found");
        messageBody = tpl.body;
        savedTemplateId = tpl.id;
      }
    }
    if (body.type === "MESSAGE" && !messageBody) {
      throw new ConflictError("Pick a message template or write a message.");
    }

    const scheduleAt = parseSchedule(body.scheduleAt);
    if (scheduleAt && scheduleAt.getTime() < Date.now() - 30_000) {
      throw new ConflictError("Schedule time is in the past.");
    }

    let requestedIds = [...new Set(body.channelIds?.length ? body.channelIds : body.channelId ? [body.channelId] : [])];
    if (!requestedIds.length) {
      const connected = await prisma.whatsAppChannel.findMany({
        where: {
          organizationId: auth.orgId,
          status: "CONNECTED",
          ...(body.type === "MESSAGE" ? {} : { provider: { not: "CLOUD" } }),
        },
        orderBy: { createdAt: "asc" },
      });
      requestedIds = connected.map((ch) => ch.id);
    }
    if (!requestedIds.length) {
      throw new ConflictError(
        body.type === "MESSAGE"
          ? "Connect at least one WhatsApp number before creating a campaign."
          : "Connect a WhatsApp Web line before creating a voice campaign. Scan QR from WhatsApp → Linked devices.",
      );
    }
    const selectedChannels = await prisma.whatsAppChannel.findMany({
      where: { organizationId: auth.orgId, id: { in: requestedIds } },
    });
    if (selectedChannels.length !== requestedIds.length) {
      throw new NotFoundError("One or more WhatsApp numbers were not found.");
    }
    if (body.type !== "MESSAGE" && selectedChannels.every((ch) => ch.provider === "CLOUD")) {
      throw new ConflictError("Voice campaigns need a WhatsApp Web line. Cloud API is for messaging only.");
    }
    const orderedIds = requestedIds.filter((id) => selectedChannels.some((ch) => ch.id === id));
    const rotationLimit = Math.min(body.rotationLimit ?? 0, orderedIds.length);

    const list = await prisma.contactList.findFirst({
      where: { id: body.contactListId, organizationId: auth.orgId },
      include: { members: { include: { contact: { select: { id: true, whatsappOn: true } } } } },
    });
    if (!list) throw new NotFoundError("List not found");
    if (body.type !== "MESSAGE" && list.members.length && list.members.every((m) => m.contact.whatsappOn === false)) {
      throw new ConflictError("None of these numbers are on WhatsApp. Verify numbers on Contacts first.");
    }

    const campaign = await prisma.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: {
          organizationId: auth.orgId,
          name: body.name,
          channelId: orderedIds[0]!,
          contactListId: body.contactListId,
          type: body.type,
          maxAttempts: body.maxAttempts,
          retryDelayMin: body.retryDelayMin,
          recordingId: body.recordingId,
          voiceTemplateId,
          aiConfigId: body.aiConfigId,
          afterRecording: body.afterRecording ?? "HANGUP",
          messageBody: messageBody || null,
          messageTemplateId: savedTemplateId,
          rotationLimit,
          delayBetweenCallsSec: body.delayBetweenCallsSec ?? 5,
          ringTimeoutSec: body.ringTimeoutSec ?? 60,
          batchSize: body.batchSize ?? 0,
          sleepAfterBatchSec: body.sleepAfterBatchSec ?? 0,
          scheduleAt,
          status: body.sendNow ? "DRAFT" : scheduleAt ? "SCHEDULED" : "DRAFT",
        },
      });
      await tx.campaignChannel.createMany({
        data: orderedIds.map((channelId, sortOrder) => ({
          campaignId: created.id,
          channelId,
          sortOrder,
        })),
      });
      if (list.members.length) {
        await tx.campaignContact.createMany({
          data: list.members.map((m) => ({
            campaignId: created.id,
            contactId: m.contactId,
            skipped: m.contact.whatsappOn === false,
          })),
        });
      }
      return created;
    });
    if (body.sendNow) {
      const started = await startCampaign(auth.orgId, campaign.id);
      return ok({ ...campaign, status: started.status });
    }
    if (scheduleAt) {
      await campaignQueue.add(
        "start",
        { campaignId: campaign.id, organizationId: auth.orgId },
        { delay: Math.max(0, scheduleAt.getTime() - Date.now()), jobId: `start-${campaign.id}` },
      );
    }
    return ok(campaign);
  });

  app.get("/campaigns/:id", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const q = z
      .object({
        contactsPage: z.coerce.number().int().min(1).default(1),
        contactsLimit: z.coerce.number().int().min(1).max(100).default(25),
        messagesPage: z.coerce.number().int().min(1).default(1),
        messagesLimit: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(req.query);
    const campaign = await prisma.campaign.findFirst({
      where: { id, organizationId: auth.orgId },
      include: {
        channel: { select: { id: true, displayName: true, status: true, phoneNumber: true } },
        campaignChannels: {
          include: { channel: { select: { id: true, displayName: true, status: true, phoneNumber: true } } },
          orderBy: { sortOrder: "asc" },
        },
        contactList: { select: { id: true, name: true } },
        recording: { select: { id: true, name: true } },
        voiceTemplate: { select: { id: true, name: true } },
        messageTemplate: { select: { id: true, name: true } },
        aiConfig: { select: { id: true, name: true } },
      },
    });
    if (!campaign) throw new NotFoundError();

    const contactsSkip = (q.contactsPage - 1) * q.contactsLimit;
    const messagesSkip = (q.messagesPage - 1) * q.messagesLimit;

    const [messageGroups, callGroups, contactGroups, connectedCalls, messagesTotal, contactsTotal, messages, campaignContacts] =
      await Promise.all([
        prisma.message.groupBy({
          by: ["status"],
          where: { campaignId: id, organizationId: auth.orgId },
          _count: { _all: true },
        }),
        prisma.call.groupBy({
          by: ["status"],
          where: { campaignId: id, organizationId: auth.orgId },
          _count: { _all: true },
        }),
        prisma.campaignContact.groupBy({
          by: ["status"],
          where: { campaignId: id },
          _count: { _all: true },
        }),
        prisma.call.count({
          where: {
            campaignId: id,
            organizationId: auth.orgId,
            OR: [{ answeredAt: { not: null } }, { status: "ANSWERED" }, { outcome: "ANSWERED" }],
          },
        }),
        prisma.message.count({ where: { campaignId: id, organizationId: auth.orgId } }),
        prisma.campaignContact.count({ where: { campaignId: id } }),
        prisma.message.findMany({
          where: { campaignId: id, organizationId: auth.orgId },
          orderBy: { createdAt: "desc" },
          skip: messagesSkip,
          take: q.messagesLimit,
          select: {
            id: true,
            phone: true,
            body: true,
            status: true,
            error: true,
            sentAt: true,
            createdAt: true,
            contact: { select: { name: true } },
          },
        }),
        prisma.campaignContact.findMany({
          where: { campaignId: id },
          include: {
            contact: { select: { id: true, name: true, phone: true } },
            calls: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                status: true,
                outcome: true,
                recordingPath: true,
                transcript: true,
                durationMs: true,
                answeredAt: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
          skip: contactsSkip,
          take: q.contactsLimit,
        }),
      ]);

    const msgTally = Object.fromEntries(messageGroups.map((row) => [row.status, row._count._all]));
    const callTally = Object.fromEntries(callGroups.map((row) => [row.status, row._count._all]));
    const contactTally = Object.fromEntries(contactGroups.map((row) => [row.status, row._count._all]));
    const messagesCount = Object.values(msgTally).reduce((sum, n) => sum + n, 0);
    const callsTotal = Object.values(callTally).reduce((sum, n) => sum + n, 0);
    const unanswered =
      (callTally.NO_ANSWER ?? 0) + (callTally.BUSY ?? 0) + (callTally.REJECTED ?? 0);
    const report = {
      contacts: Object.values(contactTally).reduce((sum, n) => sum + n, 0),
      messages: {
        total: messagesCount,
        sent: (msgTally.SENT ?? 0) + (msgTally.DELIVERED ?? 0) + (msgTally.READ ?? 0),
        failed: msgTally.FAILED ?? 0,
        queued: msgTally.QUEUED ?? 0,
      },
      calls: {
        total: callsTotal,
        connected: connectedCalls,
        unanswered,
        failed: callTally.FAILED ?? 0,
        inProgress:
          (callTally.QUEUED ?? 0) +
          (callTally.CONNECTING ?? 0) +
          (callTally.RINGING ?? 0) +
          (callTally.ANSWERED ?? 0),
      },
    };

    const contactsMeta = {
      page: q.contactsPage,
      limit: q.contactsLimit,
      total: contactsTotal,
      totalPages: Math.max(1, Math.ceil(contactsTotal / q.contactsLimit)),
    };
    const messagesMeta = {
      page: q.messagesPage,
      limit: q.messagesLimit,
      total: messagesTotal,
      totalPages: Math.max(1, Math.ceil(messagesTotal / q.messagesLimit)),
    };

    return ok({
      campaign,
      report,
      messages,
      contacts: campaignContacts.map((row) => {
        const last = row.calls[0];
        return {
          id: row.id,
          status: row.status,
          attempts: row.attempts,
          skipped: row.skipped,
          lastOutcome: row.lastOutcome,
          contact: row.contact,
          lastCall: last
            ? {
                id: last.id,
                status: last.status,
                outcome: last.outcome,
                durationMs: last.durationMs,
                answeredAt: last.answeredAt,
                hasRecording: Boolean(last.recordingPath),
                hasTranscript: hasCallTranscript(last.transcript),
              }
            : null,
        };
      }),
      contactsMeta,
      messagesMeta,
    });
  });

  app.post("/campaigns/:id/start", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const { id } = req.params as { id: string };
    return ok(await startCampaign(auth.orgId, id));
  });

  /** Re-queue dialing for a RUNNING campaign that looks frozen (pending, 0 calls). */
  app.post("/campaigns/:id/kick", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const { id } = req.params as { id: string };
    const campaign = await prisma.campaign.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { id: true, status: true, organizationId: true },
    });
    if (!campaign) throw new NotFoundError();
    if (campaign.status !== "RUNNING" && campaign.status !== "PAUSED") {
      throw new ConflictError("Only running or paused campaigns can be kicked.");
    }
    if (campaign.status === "PAUSED") {
      await prisma.campaign.update({ where: { id }, data: { status: "RUNNING" } });
    }
    // Reset contacts stuck in "calling" with no live call back to pending
    await prisma.campaignContact.updateMany({
      where: { campaignId: id, status: "calling", skipped: false },
      data: { status: "pending", nextAttemptAt: new Date() },
    });
    await campaignQueue.add(
      "run",
      { campaignId: id, organizationId: campaign.organizationId },
      { jobId: `camp-kick-${id}-${Date.now()}`, removeOnComplete: 100, removeOnFail: 50 },
    );
    return ok({ status: "RUNNING", kicked: true });
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
