import type { PrismaClient } from "@wacalls/database";
import {
  buildVoiceAgentSystemPrompt,
  createVoiceAiClient,
  defaultModelForProvider,
  extractGeminiApiKey,
  extractSarvamApiKey,
  normalizeIntentPlaybook,
  normalizeVoiceProvider,
} from "@wacalls/audio-engine";
import type { ChatInboundJob } from "@wacalls/queue";
import { digitsOnly, normalizePhone } from "@wacalls/shared";
import type pino from "pino";

const STOP_WORDS = new Set(["stop", "unsubscribe", "optout", "opt-out", "opt out"]);
const HANDOFF_WORDS = new Set(["agent", "human", "support", "person", "representative"]);

type SendTextFn = (input: {
  organizationId: string;
  channelId: string;
  phone: string;
  contactId?: string | null;
  contactName?: string | null;
  body: string;
}) => Promise<void>;

export async function processChatInbound(
  prisma: PrismaClient,
  job: ChatInboundJob,
  sendText: SendTextFn,
  log: pino.Logger,
) {
  const text = job.text.trim();
  if (!text) return { skipped: "empty" };

  const bot = await prisma.chatBot.findFirst({
    where: { channelId: job.channelId, enabled: true },
    include: {
      keywords: { where: { enabled: true }, orderBy: { sortOrder: "asc" }, include: { campaign: true } },
      knowledgeBase: { include: { documents: { take: 40 } } },
      aiConfig: { include: { knowledgeBase: { include: { documents: { take: 40 } } } } },
    },
  });
  if (!bot) return { skipped: "no-bot" };

  const phoneNorm = normalizePhone(job.phone);
  const phone = phoneNorm.ok ? phoneNorm.e164 : job.phone;
  const digits = digitsOnly(phone);

  if (job.messageId) {
    const dup = await prisma.chatMessage.findFirst({
      where: { whatsappId: job.messageId, organizationId: bot.organizationId },
    });
    if (dup) return { skipped: "duplicate" };
  }

  const contact = await prisma.contact.upsert({
    where: { organizationId_phone: { organizationId: bot.organizationId, phone } },
    create: {
      organizationId: bot.organizationId,
      name: job.displayName?.trim() || phone,
      phone,
      tags: ["chatbot"],
    },
    update: job.displayName?.trim() ? { name: job.displayName.trim() } : {},
  });

  let conversation = await prisma.chatConversation.findFirst({
    where: {
      chatBotId: bot.id,
      phone,
      status: { in: ["OPEN", "HANDOFF"] },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  if (!conversation) {
    conversation = await prisma.chatConversation.create({
      data: {
        organizationId: bot.organizationId,
        chatBotId: bot.id,
        channelId: job.channelId,
        contactId: contact.id,
        phone,
        name: contact.name,
      },
    });
  }

  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      organizationId: bot.organizationId,
      sender: "user",
      body: text,
      source: "inbound",
      whatsappId: job.messageId,
    },
  });
  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date(), name: contact.name, contactId: contact.id },
  });

  const normalized = text.toLowerCase().replace(/[^\w\s]/g, " ").trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const isStop = tokens.some((t: string) => STOP_WORDS.has(t)) || STOP_WORDS.has(normalized);
  const isHandoff =
    tokens.some((t: string) => HANDOFF_WORDS.has(t)) ||
    HANDOFF_WORDS.has(normalized) ||
    normalized.includes("talk to");

  if (isStop) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { doNotCall: true, status: "opted_out" },
    });
    await prisma.contactMemory.upsert({
      where: { organizationId_phone: { organizationId: bot.organizationId, phone: digits } },
      create: { organizationId: bot.organizationId, phone: digits, optOut: true },
      update: { optOut: true },
    });
    const reply = "You have been unsubscribed. Reply HI anytime to start again.";
    await replyAndLog(prisma, sendText, bot, conversation, contact, phone, reply, "stop");
    return { handled: "stop" };
  }

  if (contact.doNotCall) return { skipped: "opted_out" };

  if (isHandoff || conversation.status === "HANDOFF" || conversation.botPaused) {
    if (isHandoff && conversation.status !== "HANDOFF") {
      await prisma.chatConversation.update({
        where: { id: conversation.id },
        data: { status: "HANDOFF", botPaused: true },
      });
      await replyAndLog(prisma, sendText, bot, conversation, contact, phone, bot.handoffMessage, "handoff");
    }
    return { handled: "handoff" };
  }

  const keywordHit = matchKeyword(bot.keywords, normalized, tokens);
  if (keywordHit) {
    if (keywordHit.handoff) {
      await prisma.chatConversation.update({
        where: { id: conversation.id },
        data: { status: "HANDOFF", botPaused: true },
      });
    }
    const reply = keywordHit.handoff
      ? bot.handoffMessage
      : keywordHit.reply || keywordHit.campaign?.messageBody || bot.fallbackMessage;
    await replyAndLog(prisma, sendText, bot, conversation, contact, phone, reply, "keyword");
    return { handled: "keyword" };
  }

  if (!conversation.welcomeSent && bot.welcomeMessage.trim()) {
    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { welcomeSent: true },
    });
    await replyAndLog(prisma, sendText, bot, conversation, contact, phone, bot.welcomeMessage, "welcome");
    if (bot.mode === "RULES") return { handled: "welcome" };
  }

  if (bot.mode === "RULES") {
    await replyAndLog(prisma, sendText, bot, conversation, contact, phone, bot.fallbackMessage, "fallback");
    return { handled: "fallback" };
  }

  const aiReply = await generateAiReply(prisma, bot, conversation.id, contact.name, phone);
  if (aiReply) {
    await replyAndLog(prisma, sendText, bot, conversation, contact, phone, aiReply, "ai");
    return { handled: "ai" };
  }

  await replyAndLog(prisma, sendText, bot, conversation, contact, phone, bot.fallbackMessage, "fallback");
  return { handled: "fallback" };
}

function matchKeyword(
  keywords: Array<{
    keyword: string;
    reply: string;
    matchType: string;
    campaign: { messageBody: string | null } | null;
  }>,
  normalized: string,
  tokens: string[],
) {
  for (const row of keywords) {
    const key = row.keyword.toLowerCase().trim();
    if (!key) continue;
    const hit =
      row.matchType === "CONTAINS"
        ? normalized.includes(key) || tokens.includes(key)
        : normalized === key || tokens.includes(key);
    if (!hit) continue;
    const handoff = ["agent", "human", "support"].includes(key);
    return { reply: row.reply, campaign: row.campaign, handoff };
  }
  return null;
}

async function replyAndLog(
  prisma: PrismaClient,
  sendText: SendTextFn,
  bot: { organizationId: string; channelId: string },
  conversation: { id: string },
  contact: { id: string; name: string },
  phone: string,
  body: string,
  source: string,
) {
  const trimmed = body.trim();
  if (!trimmed) return;
  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      organizationId: bot.organizationId,
      sender: "bot",
      body: trimmed,
      source,
    },
  });
  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });
  await sendText({
    organizationId: bot.organizationId,
    channelId: bot.channelId,
    phone,
    contactId: contact.id,
    contactName: contact.name,
    body: trimmed,
  });
}

async function generateAiReply(
  prisma: PrismaClient,
  bot: {
    organizationId: string;
    provider: string;
    model: string | null;
    systemPrompt: string | null;
    knowledgeBase: { name: string; documents: Array<{ title: string; content: string }> } | null;
    aiConfig: {
      provider: string;
      model: string;
      systemPrompt: string;
      objective: string | null;
      questions: string | null;
      disallowed: string | null;
      language: string;
      intentPlaybook: unknown;
      maxCallDurationSec: number;
      wrapUpSec: number;
      knowledgeBase: { name: string; documents: Array<{ title: string; content: string }> } | null;
    } | null;
  },
  conversationId: string,
  name: string,
  phone: string,
) {
  const ai = bot.aiConfig;
  const provider = normalizeVoiceProvider(ai?.provider ?? bot.provider);
  const apiKey = await resolveApiKey(prisma, bot.organizationId, provider);
  if (!apiKey) return "";

  const historyRows = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 14,
  });
  const history = historyRows
    .reverse()
    .filter((m) => m.sender === "user" || m.sender === "bot")
    .map((m) => ({
      role: m.sender === "user" ? ("user" as const) : ("assistant" as const),
      content: m.body,
    }));

  const kb = ai?.knowledgeBase ?? bot.knowledgeBase;
  const kbForPrompt = kb ? { name: kb.name, documents: kb.documents } : null;
  const system = ai
    ? buildVoiceAgentSystemPrompt(
        {
          systemPrompt: ai.systemPrompt,
          objective: ai.objective,
          questions: ai.questions,
          disallowed: ai.disallowed,
          language: ai.language,
          knowledgeBase: kbForPrompt,
          intentPlaybook: normalizeIntentPlaybook(ai.intentPlaybook),
          maxCallDurationSec: ai.maxCallDurationSec,
          wrapUpSec: ai.wrapUpSec,
        },
        { name, phone },
      )
    : [
        bot.systemPrompt?.trim() ||
          "You are a helpful WhatsApp support assistant. Answer briefly in Hindi, English, or Hinglish as the user prefers.",
        kb?.documents?.length
          ? `\nKnowledge base:\n${kb.documents.map((d) => `## ${d.title}\n${d.content}`).join("\n\n")}`
          : "",
        "Only answer from the knowledge base when possible. If unsure, say you will connect them to a human.",
      ].join("\n");

  const last = history[history.length - 1];
  const prior = history.slice(0, -1);
  try {
    return await createVoiceAiClient(provider, apiKey).chat(
      [{ role: "system", content: system }, ...prior.slice(-10), last ?? { role: "user", content: "Hello" }],
      { model: ai?.model || bot.model || defaultModelForProvider(provider), maxTokens: 500 },
    );
  } catch {
    return "";
  }
}

async function resolveApiKey(prisma: PrismaClient, organizationId: string, provider: "gemini" | "sarvam") {
  const keyName = provider === "gemini" ? "gemini_api_key" : "sarvam_api_key";
  const row = await prisma.setting.findFirst({ where: { organizationId, key: keyName } });
  if (provider === "gemini") {
    return extractGeminiApiKey(row?.value) || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  }
  return extractSarvamApiKey(row?.value) || process.env.SARVAM_API_KEY || process.env.AI_API_KEY || "";
}
