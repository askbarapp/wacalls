import { prisma } from "@wacalls/database";
import { ConflictError, NotFoundError, normalizePhone } from "@wacalls/shared";
import { sendWhatsAppText } from "./messaging.js";
import { publishEvent } from "./events.js";

export const DEFAULT_KEYWORDS = [
  { keyword: "HI", reply: "Hello! Welcome. How can we help you today?", matchType: "EXACT" as const },
  { keyword: "HELLO", reply: "Hello! Welcome. How can we help you today?", matchType: "EXACT" as const },
  { keyword: "MENU", reply: "Reply PRICE for pricing, DEMO for a demo, or AGENT to talk to our team.", matchType: "EXACT" as const },
  { keyword: "PRICE", reply: "Share your requirement and our team will send pricing details shortly.", matchType: "EXACT" as const },
  { keyword: "DEMO", reply: "Thanks! Our team will schedule a demo with you soon.", matchType: "EXACT" as const },
  { keyword: "SUPPORT", reply: "", matchType: "EXACT" as const },
  { keyword: "AGENT", reply: "", matchType: "EXACT" as const },
  { keyword: "HUMAN", reply: "", matchType: "EXACT" as const },
  { keyword: "STOP", reply: "You have been unsubscribed.", matchType: "EXACT" as const },
  { keyword: "UNSUBSCRIBE", reply: "You have been unsubscribed.", matchType: "EXACT" as const },
];

export async function getOrCreateChatBot(organizationId: string, channelId: string) {
  const channel = await prisma.whatsAppChannel.findFirst({
    where: { id: channelId, organizationId },
  });
  if (!channel) throw new NotFoundError("Channel not found");

  const existing = await prisma.chatBot.findUnique({
    where: { channelId },
    include: {
      channel: { select: { id: true, displayName: true, phoneNumber: true, status: true } },
      knowledgeBase: { select: { id: true, name: true } },
      aiConfig: { select: { id: true, name: true } },
      keywords: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (existing) return existing;

  return prisma.chatBot.create({
    data: { organizationId, channelId },
    include: {
      channel: { select: { id: true, displayName: true, phoneNumber: true, status: true } },
      knowledgeBase: { select: { id: true, name: true } },
      aiConfig: { select: { id: true, name: true } },
      keywords: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function seedRecommendedKeywords(chatBotId: string) {
  const bot = await prisma.chatBot.findUnique({ where: { id: chatBotId } });
  if (!bot) throw new NotFoundError("Chatbot not found");
  const count = await prisma.chatKeyword.count({ where: { chatBotId } });
  if (count > 0) return { created: 0 };
  await prisma.chatKeyword.createMany({
    data: DEFAULT_KEYWORDS.map((row, i) => ({
      chatBotId,
      keyword: row.keyword,
      reply: row.reply,
      matchType: row.matchType,
      sortOrder: i,
    })),
  });
  return { created: DEFAULT_KEYWORDS.length };
}

export async function logOutboundToConversation(input: {
  organizationId: string;
  channelId: string;
  phone: string;
  body: string;
  sender?: string;
  source?: string;
  contactName?: string | null;
}) {
  const bot = await prisma.chatBot.findFirst({
    where: { channelId: input.channelId, organizationId: input.organizationId },
  });
  if (!bot) return null;

  const phoneNorm = normalizePhone(input.phone);
  const phone = phoneNorm.ok ? phoneNorm.e164 : input.phone;

  const contact = await prisma.contact.upsert({
    where: { organizationId_phone: { organizationId: input.organizationId, phone } },
    create: {
      organizationId: input.organizationId,
      name: input.contactName?.trim() || phone,
      phone,
      tags: ["chatbot"],
    },
    update: input.contactName?.trim() ? { name: input.contactName.trim() } : {},
  });

  let conversation = await prisma.chatConversation.findFirst({
    where: { chatBotId: bot.id, phone, status: { in: ["OPEN", "HANDOFF"] } },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.chatConversation.create({
      data: {
        organizationId: input.organizationId,
        chatBotId: bot.id,
        channelId: input.channelId,
        contactId: contact.id,
        phone,
        name: contact.name,
        welcomeSent: true,
      },
    });
  }

  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      organizationId: input.organizationId,
      sender: input.sender ?? "agent",
      body: input.body,
      source: input.source ?? "api",
    },
  });
  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date(), contactId: contact.id },
  });
  await publishEvent({
    type: "chatbot.message",
    organizationId: input.organizationId,
    conversationId: conversation.id,
  }).catch(() => undefined);
  return conversation.id;
}

export async function agentReply(input: {
  organizationId: string;
  conversationId: string;
  body: string;
}) {
  const conversation = await prisma.chatConversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    include: { chatBot: true, contact: true },
  });
  if (!conversation) throw new NotFoundError("Conversation not found");
  const body = input.body.trim();
  if (!body) throw new ConflictError("Message cannot be empty");

  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      organizationId: input.organizationId,
      sender: "agent",
      body,
      source: "inbox",
    },
  });
  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date(), status: "HANDOFF", botPaused: true },
  });

  await sendWhatsAppText({
    organizationId: input.organizationId,
    channelId: conversation.channelId,
    phone: conversation.phone,
    body,
    contactId: conversation.contactId ?? undefined,
    contactName: conversation.name,
  });

  await publishEvent({
    type: "chatbot.message",
    organizationId: input.organizationId,
    conversationId: conversation.id,
  }).catch(() => undefined);

  return conversation.id;
}

export async function resumeBot(organizationId: string, conversationId: string) {
  const conversation = await prisma.chatConversation.findFirst({
    where: { id: conversationId, organizationId },
  });
  if (!conversation) throw new NotFoundError("Conversation not found");
  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { status: "OPEN", botPaused: false },
  });
  return { ok: true };
}
