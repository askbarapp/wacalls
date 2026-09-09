import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import {
  CHAT_KEYWORD_ACTIONS,
  CHAT_MATCH_TYPES,
  ConflictError,
  DEFAULT_CHAT_KEYWORDS,
  NotFoundError,
  ok,
} from "@wacalls/shared";
import { okPage, pageMeta, pageQuerySchema, pageSkip } from "../lib/pagination.js";
import { sendWhatsAppText } from "../services/messaging.js";

const botBody = z.object({
  channelId: z.string().uuid(),
  enabled: z.boolean().optional(),
  aiEnabled: z.boolean().optional(),
  aiConfigId: z.string().uuid().nullable().optional(),
  knowledgeBaseId: z.string().uuid().nullable().optional(),
  fallbackMessage: z.string().trim().min(1).max(4096).optional(),
  optOutMessage: z.string().trim().min(1).max(4096).optional(),
  handoffMessage: z.string().trim().min(1).max(4096).optional(),
  unknownHandoff: z.boolean().optional(),
});

const keywordBody = z.object({
  trigger: z.string().trim().min(1).max(80),
  matchType: z.enum(CHAT_MATCH_TYPES).optional(),
  reply: z.string().trim().min(1).max(4096),
  action: z.enum(CHAT_KEYWORD_ACTIONS).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const botInclude = {
  keywords: { orderBy: { sortOrder: "asc" as const } },
  channel: { select: { id: true, displayName: true, status: true, provider: true } },
  aiConfig: { select: { id: true, name: true, provider: true } },
  knowledgeBase: { select: { id: true, name: true } },
};

async function ensureBot(organizationId: string, channelId: string) {
  const channel = await prisma.whatsAppChannel.findFirst({
    where: { id: channelId, organizationId },
  });
  if (!channel) throw new NotFoundError("Channel not found");
  const existing = await prisma.chatBot.findUnique({
    where: { channelId },
    include: botInclude,
  });
  if (existing) return existing;
  const firstAi = await prisma.aiConfig.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, knowledgeBaseId: true },
  });
  return prisma.chatBot.create({
    data: {
      organizationId,
      channelId,
      enabled: true,
      aiEnabled: true,
      aiConfigId: firstAi?.id ?? null,
      knowledgeBaseId: firstAi?.knowledgeBaseId ?? null,
      keywords: {
        create: DEFAULT_CHAT_KEYWORDS.map((k) => ({
          organizationId,
          trigger: k.trigger,
          matchType: k.matchType,
          action: k.action,
          reply: k.reply,
          sortOrder: k.sortOrder,
        })),
      },
    },
    include: botInclude,
  });
}

export const chatbotRoutes: FastifyPluginAsync = async (app) => {
  app.get("/chatbots", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.manage")(req).catch(async () => {
      await app.requirePermission("chatbot.inbox")(req);
    });
    const q = z.object({ channelId: z.string().uuid().optional() }).parse(req.query);
    if (q.channelId) {
      return ok(await ensureBot(auth.orgId, q.channelId));
    }
    const rows = await prisma.chatBot.findMany({
      where: { organizationId: auth.orgId },
      include: botInclude,
      orderBy: { updatedAt: "desc" },
    });
    return ok(rows);
  });

  app.put("/chatbots", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.manage")(req);
    const body = botBody.parse(req.body);
    const bot = await ensureBot(auth.orgId, body.channelId);
    if (body.aiConfigId) {
      const ai = await prisma.aiConfig.findFirst({
        where: { id: body.aiConfigId, organizationId: auth.orgId },
      });
      if (!ai) throw new NotFoundError("AI agent not found");
    }
    if (body.knowledgeBaseId) {
      const kb = await prisma.knowledgeBase.findFirst({
        where: { id: body.knowledgeBaseId, organizationId: auth.orgId },
      });
      if (!kb) throw new NotFoundError("Knowledge base not found");
    }
    const { channelId: _channelId, ...patch } = body;
    return ok(
      await prisma.chatBot.update({
        where: { id: bot.id },
        data: patch,
        include: botInclude,
      }),
    );
  });

  app.post("/chatbots/:id/keywords", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.manage")(req);
    const { id } = req.params as { id: string };
    const bot = await prisma.chatBot.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!bot) throw new NotFoundError("Chatbot not found");
    const body = keywordBody.parse(req.body);
    const trigger = body.trigger.trim().toUpperCase();
    const matchType = body.matchType ?? "exact";
    const dup = await prisma.chatKeyword.findFirst({
      where: { chatBotId: id, trigger, matchType },
    });
    if (dup) throw new ConflictError("That keyword already exists on this bot.");
    const max = await prisma.chatKeyword.aggregate({
      where: { chatBotId: id },
      _max: { sortOrder: true },
    });
    return ok(
      await prisma.chatKeyword.create({
        data: {
          organizationId: auth.orgId,
          chatBotId: id,
          trigger,
          matchType,
          reply: body.reply,
          action: body.action ?? "reply",
          enabled: body.enabled ?? true,
          sortOrder: body.sortOrder ?? (max._max.sortOrder ?? 0) + 10,
        },
      }),
    );
  });

  app.patch("/chat-keywords/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.manage")(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.chatKeyword.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!existing) throw new NotFoundError("Keyword not found");
    const body = keywordBody.partial().parse(req.body);
    return ok(
      await prisma.chatKeyword.update({
        where: { id },
        data: {
          ...body,
          ...(body.trigger ? { trigger: body.trigger.trim().toUpperCase() } : {}),
        },
      }),
    );
  });

  app.delete("/chat-keywords/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.manage")(req);
    const { id } = req.params as { id: string };
    await prisma.chatKeyword.deleteMany({ where: { id, organizationId: auth.orgId } });
    return ok({ deleted: true });
  });

  app.get("/chat/conversations", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.inbox")(req);
    const q = pageQuerySchema
      .extend({
        channelId: z.string().uuid().optional(),
        status: z.enum(["OPEN", "HANDOFF", "CLOSED"]).optional(),
        search: z.string().optional(),
      })
      .parse(req.query);
    const where = {
      organizationId: auth.orgId,
      ...(q.channelId ? { channelId: q.channelId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search?.trim()
        ? { phone: { contains: q.search.trim(), mode: "insensitive" as const } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.chatConversation.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        skip: pageSkip(q.page, q.limit),
        take: q.limit,
        include: {
          channel: { select: { displayName: true } },
          contact: { select: { id: true, name: true, phone: true } },
          assignee: { select: { id: true, name: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      }),
      prisma.chatConversation.count({ where }),
    ]);
    return okPage(rows, pageMeta(q.page, q.limit, total));
  });

  app.get("/chat/conversations/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.inbox")(req);
    const { id } = req.params as { id: string };
    const row = await prisma.chatConversation.findFirst({
      where: { id, organizationId: auth.orgId },
      include: {
        channel: { select: { id: true, displayName: true, status: true } },
        contact: { select: { id: true, name: true, phone: true } },
        assignee: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!row) throw new NotFoundError("Conversation not found");
    return ok(row);
  });

  app.post("/chat/conversations/:id/reply", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.inbox")(req);
    const { id } = req.params as { id: string };
    const body = z.object({ text: z.string().trim().min(1).max(4096) }).parse(req.body);
    const convo = await prisma.chatConversation.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!convo) throw new NotFoundError("Conversation not found");
    const sent = await sendWhatsAppText({
      organizationId: auth.orgId,
      channelId: convo.channelId,
      phone: convo.phone,
      body: body.text,
      contactId: convo.contactId ?? undefined,
      chatSource: "agent",
    });
    return ok(sent);
  });

  app.post("/chat/conversations/:id/handoff", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.inbox")(req);
    const { id } = req.params as { id: string };
    const convo = await prisma.chatConversation.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!convo) throw new NotFoundError("Conversation not found");
    return ok(
      await prisma.chatConversation.update({
        where: { id },
        data: { status: "HANDOFF", assignedUserId: z.string().uuid().safeParse(auth.sub).success ? auth.sub : undefined },
      }),
    );
  });

  app.post("/chat/conversations/:id/resume", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.inbox")(req);
    const { id } = req.params as { id: string };
    const convo = await prisma.chatConversation.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!convo) throw new NotFoundError("Conversation not found");
    return ok(
      await prisma.chatConversation.update({
        where: { id },
        data: { status: "OPEN", optOut: false },
      }),
    );
  });

  app.post("/chat/conversations/:id/assign", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.inbox")(req);
    const { id } = req.params as { id: string };
    const body = z.object({ userId: z.string().uuid().nullable() }).parse(req.body);
    const convo = await prisma.chatConversation.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!convo) throw new NotFoundError("Conversation not found");
    if (body.userId) {
      const member = await prisma.organizationUser.findFirst({
        where: { organizationId: auth.orgId, userId: body.userId },
      });
      if (!member) throw new NotFoundError("User not in this organization");
    }
    return ok(
      await prisma.chatConversation.update({
        where: { id },
        data: { assignedUserId: body.userId },
      }),
    );
  });
};
