import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, hasCallTranscript } from "@wacalls/database";
import { ConflictError, NotFoundError, ok } from "@wacalls/shared";

const DEFAULT_INBOUND_MESSAGE =
  "Namaste {{name}}, aapki WhatsApp call connect ho gayi hai. Main AI assistant hoon — kaise madad kar sakta hoon?";

const saveBody = z.object({
  enabled: z.boolean(),
  aiConfigId: z.string().uuid().nullable().optional(),
  sendMessage: z.boolean().default(false),
  messageBody: z.string().optional(),
  messageWhen: z.enum(["answered", "ringing"]).default("answered"),
});

export const incomingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/incoming-answer", async (req) => {
    const auth = await app.authenticate(req);
    const [channels, agents, recent] = await Promise.all([
      prisma.whatsAppChannel.findMany({
        where: { organizationId: auth.orgId },
        include: { incomingAnswer: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.aiConfig.findMany({
        where: { organizationId: auth.orgId },
        select: { id: true, name: true, language: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.call.findMany({
        where: { organizationId: auth.orgId, source: "inbound" },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          phone: true,
          contactName: true,
          status: true,
          durationMs: true,
          createdAt: true,
          recordingPath: true,
          transcript: true,
          channelId: true,
        },
      }),
    ]);
    return ok({
      defaultMessage: DEFAULT_INBOUND_MESSAGE,
      agents,
      channels: channels.map((ch) => ({
        id: ch.id,
        displayName: ch.displayName,
        phoneNumber: ch.phoneNumber,
        status: ch.status,
        provider: ch.provider,
        config: {
          enabled: ch.incomingAnswer?.enabled ?? false,
          aiConfigId: ch.incomingAnswer?.aiConfigId ?? "",
          sendMessage: ch.incomingAnswer?.sendMessage ?? false,
          messageBody: ch.incomingAnswer?.messageBody ?? DEFAULT_INBOUND_MESSAGE,
          messageWhen: ch.incomingAnswer?.messageWhen === "ringing" ? "ringing" : "answered",
        },
      })),
      recent: recent.map(({ recordingPath, transcript, ...row }) => ({
        ...row,
        hasRecording: Boolean(recordingPath),
        hasTranscript: hasCallTranscript(transcript),
      })),
    });
  });

  app.put("/incoming-answer/:channelId", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { channelId } = req.params as { channelId: string };
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id: channelId, organizationId: auth.orgId },
    });
    if (!channel) throw new NotFoundError("WhatsApp channel not found");
    const body = saveBody.parse(req.body);
    const aiConfigId = body.aiConfigId || null;
    if (body.enabled && !aiConfigId) {
      throw new ConflictError("Pick an AI agent before turning auto-answer on.");
    }
    if (aiConfigId) {
      const agent = await prisma.aiConfig.findFirst({
        where: { id: aiConfigId, organizationId: auth.orgId },
      });
      if (!agent) throw new NotFoundError("AI agent not found");
    }
    const messageBody = body.messageBody?.trim() || DEFAULT_INBOUND_MESSAGE;
    const row = await prisma.incomingAnswerConfig.upsert({
      where: { channelId },
      update: {
        enabled: body.enabled,
        aiConfigId,
        sendMessage: body.sendMessage,
        messageBody,
        messageWhen: body.messageWhen,
      },
      create: {
        organizationId: auth.orgId,
        channelId,
        enabled: body.enabled,
        aiConfigId,
        sendMessage: body.sendMessage,
        messageBody,
        messageWhen: body.messageWhen,
      },
    });
    return ok(row);
  });
};
