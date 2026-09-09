import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { ConflictError, NotFoundError, ok } from "@wacalls/shared";
import { pageQuerySchema } from "../lib/pagination.js";
import {
  agentReply,
  getOrCreateChatBot,
  resumeBot,
  seedRecommendedKeywords,
} from "../services/chatbot.js";

const modeZ = z.enum(["RULES", "AI", "HYBRID"]);
const matchZ = z.enum(["EXACT", "CONTAINS"]);

const saveBotBody = z.object({
  channelId: z.string().uuid(),
  enabled: z.boolean().optional(),
  mode: modeZ.optional(),
  provider: z.string().trim().optional(),
  model: z.string().trim().nullable().optional(),
  knowledgeBaseId: z.string().uuid().nullable().optional(),
  aiConfigId: z.string().uuid().nullable().optional(),
  welcomeMessage: z.string().max(2000).optional(),
  fallbackMessage: z.string().max(2000).optional(),
  handoffMessage: z.string().max(2000).optional(),
  systemPrompt: z.string().max(8000).nullable().optional(),
});

const keywordBody = z.object({
  keyword: z.string().trim().min(1).max(80),
  reply: z.string().max(4000),
  matchType: matchZ.optional(),
  campaignId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  enabled: z.boolean().optional(),
});

export const chatbotRoutes: FastifyPluginAsync = async (app) => {
  app.get("/chatbot", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const q = z.object({ channelId: z.string().uuid().optional() }).parse(req.query);
    const channels = await prisma.whatsAppChannel.findMany({
      where: { organizationId: auth.orgId },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, phoneNumber: true, status: true, provider: true },
    });
    const channelId = q.channelId ?? channels[0]?.id;
    const bot = channelId ? await getOrCreateChatBot(auth.orgId, channelId) : null;
    const openCount = bot
      ? await prisma.chatConversation.count({
          where: { organizationId: auth.orgId, chatBotId: bot.id, status: { in: ["OPEN", "HANDOFF"] } },
        })
      : 0;
    return ok({ channels, bot, openCount });
  });

  app.put("/chatbot", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const body = saveBotBody.parse(req.body);
    await getOrCreateChatBot(auth.orgId, body.channelId);
    const data: Record<string, unknown> = {};
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.mode) data.mode = body.mode;
    if (body.provider) data.provider = body.provider;
    if (body.model !== undefined) data.model = body.model;
    if (body.knowledgeBaseId !== undefined) data.knowledgeBaseId = body.knowledgeBaseId;
    if (body.aiConfigId !== undefined) data.aiConfigId = body.aiConfigId;
    if (body.welcomeMessage) data.welcomeMessage = body.welcomeMessage;
    if (body.fallbackMessage) data.fallbackMessage = body.fallbackMessage;
    if (body.handoffMessage) data.handoffMessage = body.handoffMessage;
    if (body.systemPrompt !== undefined) data.systemPrompt = body.systemPrompt;

    const bot = await prisma.chatBot.update({
      where: { channelId: body.channelId },
      data,
      include: {
        channel: { select: { id: true, displayName: true, phoneNumber: true, status: true } },
        knowledgeBase: { select: { id: true, name: true } },
        aiConfig: { select: { id: true, name: true } },
        keywords: { orderBy: { sortOrder: "asc" } },
      },
    });
    return ok(bot);
  });

  app.post("/chatbot/keywords/seed", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const body = z.object({ channelId: z.string().uuid() }).parse(req.body);
    const bot = await getOrCreateChatBot(auth.orgId, body.channelId);
    const result = await seedRecommendedKeywords(bot.id);
    const keywords = await prisma.chatKeyword.findMany({
      where: { chatBotId: bot.id },
      orderBy: { sortOrder: "asc" },
    });
    return ok({ ...result, keywords });
  });

  app.post("/chatbot/keywords", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const body = keywordBody.extend({ channelId: z.string().uuid() }).parse(req.body);
    const bot = await getOrCreateChatBot(auth.orgId, body.channelId);
    const row = await prisma.chatKeyword.create({
      data: {
        chatBotId: bot.id,
        keyword: body.keyword,
        reply: body.reply,
        matchType: body.matchType ?? "EXACT",
        campaignId: body.campaignId ?? undefined,
        sortOrder: body.sortOrder ?? 0,
        enabled: body.enabled ?? true,
      },
    });
    return ok(row);
  });

  app.patch("/chatbot/keywords/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { id } = req.params as { id: string };
    const body = keywordBody.partial().parse(req.body);
    const existing = await prisma.chatKeyword.findFirst({
      where: { id },
      include: { chatBot: true },
    });
    if (!existing || existing.chatBot.organizationId !== auth.orgId) {
      throw new NotFoundError("Keyword not found");
    }
    const row = await prisma.chatKeyword.update({ where: { id }, data: body });
    return ok(row);
  });

  app.delete("/chatbot/keywords/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.chatKeyword.findFirst({
      where: { id },
      include: { chatBot: true },
    });
    if (!existing || existing.chatBot.organizationId !== auth.orgId) {
      throw new NotFoundError("Keyword not found");
    }
    await prisma.chatKeyword.delete({ where: { id } });
    return ok({ deleted: true });
  });

  app.get("/chatbot/conversations", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const q = pageQuerySchema
      .extend({
        channelId: z.string().uuid().optional(),
        status: z.enum(["OPEN", "HANDOFF", "CLOSED", "all"]).optional(),
      })
      .parse(req.query);
    const bot = q.channelId
      ? await prisma.chatBot.findFirst({ where: { channelId: q.channelId, organizationId: auth.orgId } })
      : await prisma.chatBot.findFirst({ where: { organizationId: auth.orgId }, orderBy: { updatedAt: "desc" } });
    if (!bot) return { success: true as const, data: [], meta: { page: q.page, limit: q.limit, total: 0, totalPages: 1 } };
    const where = {
      organizationId: auth.orgId,
      chatBotId: bot.id,
      ...(q.status && q.status !== "all" ? { status: q.status } : {}),
    };
    const skip = (q.page - 1) * q.limit;
    const [rows, total] = await Promise.all([
      prisma.chatConversation.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        skip,
        take: q.limit,
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      }),
      prisma.chatConversation.count({ where }),
    ]);
    return {
      success: true as const,
      data: rows.map((row) => ({
        ...row,
        preview: row.messages[0]?.body ?? "",
      })),
      meta: {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.limit)),
      },
    };
  });

  app.get("/chatbot/conversations/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const { id } = req.params as { id: string };
    const row = await prisma.chatConversation.findFirst({
      where: { id, organizationId: auth.orgId },
      include: { messages: { orderBy: { createdAt: "asc" }, take: 300 } },
    });
    if (!row) throw new NotFoundError("Conversation not found");
    return ok(row);
  });

  app.post("/chatbot/conversations/:id/reply", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const { id } = req.params as { id: string };
    const body = z.object({ text: z.string().trim().min(1).max(4096) }).parse(req.body);
    await agentReply({ organizationId: auth.orgId, conversationId: id, body: body.text });
    const row = await prisma.chatConversation.findFirst({
      where: { id, organizationId: auth.orgId },
      include: { messages: { orderBy: { createdAt: "asc" }, take: 300 } },
    });
    return ok(row);
  });

  app.post("/chatbot/conversations/:id/resume", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const { id } = req.params as { id: string };
    return ok(await resumeBot(auth.orgId, id));
  });

  app.post("/chatbot/conversations/:id/close", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const { id } = req.params as { id: string };
    const row = await prisma.chatConversation.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!row) throw new NotFoundError("Conversation not found");
    await prisma.chatConversation.update({ where: { id }, data: { status: "CLOSED", botPaused: true } });
    return ok({ closed: true });
  });
};
