import { prisma } from "@wacalls/database";
import {
  createVoiceAiClient,
  extractGeminiApiKey,
  extractSarvamApiKey,
  normalizeVoiceProvider,
  type ChatTurn,
} from "@wacalls/audio-engine";
import {
  DEFAULT_CHAT_KEYWORDS,
  digitsOnly,
  isHandoffCommand,
  isStartCommand,
  isStopCommand,
  matchChatKeyword,
  normalizePhone,
} from "@wacalls/shared";
import type { ChatInboundJob } from "@wacalls/queue";
import pino from "pino";

const log = pino({ name: "chatbot", level: process.env.LOG_LEVEL ?? "info" });
const WHATSAPP_URL = process.env.WHATSAPP_URL ?? "http://whatsapp:4010";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? "";

async function resolveProviderKey(organizationId: string, provider: string) {
  const id = normalizeVoiceProvider(provider);
  if (id === "gemini") {
    const row = await prisma.setting.findFirst({
      where: { organizationId, key: "gemini_api_key" },
    });
    const key = extractGeminiApiKey(row?.value) || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    if (!key) throw new Error("Gemini API key missing");
    return { provider: id, key };
  }
  const row = await prisma.setting.findFirst({
    where: { organizationId, key: "sarvam_api_key" },
  });
  const key = extractSarvamApiKey(row?.value) || process.env.SARVAM_API_KEY || process.env.AI_API_KEY || "";
  if (!key) throw new Error("Sarvam API key missing");
  return { provider: id, key };
}

async function waSend(channelId: string, phone: string, text: string): Promise<string | undefined> {
  const res = await fetch(`${WHATSAPP_URL}/internal/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": INTERNAL_TOKEN,
    },
    body: JSON.stringify({ channelId, phone, text }),
  });
  const json = (await res.json()) as { id?: string; data?: { id?: string }; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `whatsapp ${res.status}`);
  return json.id ?? json.data?.id;
}

export async function ensureChatBot(organizationId: string, channelId: string) {
  const existing = await prisma.chatBot.findUnique({
    where: { channelId },
    include: { keywords: { orderBy: { sortOrder: "asc" } } },
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
    include: { keywords: { orderBy: { sortOrder: "asc" } } },
  });
}

async function ensureContact(organizationId: string, e164: string) {
  return prisma.contact.upsert({
    where: { organizationId_phone: { organizationId, phone: e164 } },
    create: { organizationId, phone: e164, name: e164 },
    update: {},
  });
}

export async function ensureConversation(input: {
  organizationId: string;
  channelId: string;
  phone: string;
  contactId?: string | null;
}) {
  const parsed = normalizePhone(input.phone);
  const phone = parsed.ok ? parsed.e164 : `+${digitsOnly(input.phone)}`;
  const contact = input.contactId
    ? { id: input.contactId }
    : await ensureContact(input.organizationId, phone);
  return prisma.chatConversation.upsert({
    where: {
      organizationId_channelId_phone: {
        organizationId: input.organizationId,
        channelId: input.channelId,
        phone,
      },
    },
    create: {
      organizationId: input.organizationId,
      channelId: input.channelId,
      phone,
      contactId: contact.id,
      status: "OPEN",
    },
    update: { contactId: contact.id },
  });
}

export async function recordChatMessage(input: {
  organizationId: string;
  conversationId: string;
  direction: "IN" | "OUT";
  source: string;
  body: string;
  keywordId?: string | null;
  externalId?: string | null;
}) {
  const now = new Date();
  const [row] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        direction: input.direction,
        source: input.source,
        body: input.body,
        keywordId: input.keywordId ?? undefined,
        externalId: input.externalId ?? undefined,
      },
    }),
    prisma.chatConversation.update({
      where: { id: input.conversationId },
      data: {
        lastMessageAt: now,
        ...(input.direction === "IN" ? { lastInboundAt: now } : {}),
      },
    }),
  ]);
  return row;
}

async function sendAndLog(input: {
  organizationId: string;
  channelId: string;
  conversationId: string;
  phone: string;
  body: string;
  source: string;
  keywordId?: string | null;
  contactId?: string | null;
}) {
  const channel = await prisma.whatsAppChannel.findUnique({ where: { id: input.channelId } });
  if (!channel) throw new Error("channel missing");
  const message = await prisma.message.create({
    data: {
      organizationId: input.organizationId,
      channelId: input.channelId,
      contactId: input.contactId ?? undefined,
      phone: input.phone,
      body: input.body,
      provider: channel.provider,
      status: "QUEUED",
    },
  });
  try {
    let externalId: string | undefined;
    if (channel.provider === "CLOUD") {
      if (!channel.cloudPhoneNumberId || !channel.cloudAccessToken) {
        throw new Error("Cloud API credentials missing");
      }
      const res = await fetch(`https://graph.facebook.com/v21.0/${channel.cloudPhoneNumberId}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${channel.cloudAccessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: digitsOnly(input.phone),
          type: "text",
          text: { body: input.body },
        }),
      });
      const json = (await res.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? `Cloud API ${res.status}`);
      externalId = json.messages?.[0]?.id;
    } else {
      externalId = await waSend(input.channelId, input.phone, input.body);
    }
    await prisma.message.update({
      where: { id: message.id },
      data: { status: "SENT", externalId, sentAt: new Date() },
    });
    await recordChatMessage({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      direction: "OUT",
      source: input.source,
      body: input.body,
      keywordId: input.keywordId,
      externalId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "send failed";
    await prisma.message.update({ where: { id: message.id }, data: { status: "FAILED", error: msg } });
    throw err;
  }
}

function kbSnippet(docs: Array<{ title: string; content: string }>) {
  let out = "";
  for (const d of docs) {
    const chunk = `${d.title}\n${d.content}\n\n`;
    if (out.length + chunk.length > 12000) break;
    out += chunk;
  }
  return out.trim();
}

async function aiReply(input: {
  organizationId: string;
  conversationId: string;
  bot: { aiConfigId: string | null; knowledgeBaseId: string | null };
  userText: string;
}): Promise<string | null> {
  if (!input.bot.aiConfigId) return null;
  const ai = await prisma.aiConfig.findUnique({
    where: { id: input.bot.aiConfigId },
    include: { knowledgeBase: { include: { documents: { take: 40 } } } },
  });
  if (!ai) return null;
  const kbId = input.bot.knowledgeBaseId ?? ai.knowledgeBaseId;
  const extraDocs =
    kbId && kbId !== ai.knowledgeBaseId
      ? await prisma.knowledgeBaseDocument.findMany({ where: { knowledgeBaseId: kbId }, take: 40 })
      : [];
  const docs = extraDocs.length ? extraDocs : (ai.knowledgeBase?.documents ?? []);
  const knowledge = kbSnippet(docs);
  const history = await prisma.chatMessage.findMany({
    where: { conversationId: input.conversationId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const turns: ChatTurn[] = [
    {
      role: "system",
      content: [
        "You are a WhatsApp text assistant (not a phone call). Keep replies short (1–4 sentences).",
        "Use only the knowledge base when answering product questions. If you do not know, say so briefly.",
        ai.systemPrompt,
        ai.objective ? `Objective: ${ai.objective}` : "",
        knowledge ? `Knowledge base:\n${knowledge}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    ...history
      .slice()
      .reverse()
      .map((m) => ({
        role: (m.direction === "IN" ? "user" : "assistant") as "user" | "assistant",
        content: m.body,
      })),
    { role: "user", content: input.userText },
  ];
  const resolved = await resolveProviderKey(input.organizationId, ai.provider);
  const client = createVoiceAiClient(resolved.provider, resolved.key);
  const reply = await client.chat(turns, {
    model: ai.model,
    temperature: ai.temperature,
    maxTokens: Math.min(ai.maxTokens || 400, 400),
  });
  return reply.trim() || null;
}

export async function processChatInbound(job: ChatInboundJob) {
  const parsed = normalizePhone(job.phone);
  const phone = parsed.ok ? parsed.e164 : `+${digitsOnly(job.phone)}`;
  const text = job.text.trim();
  if (!text) return { skipped: "empty" };

  const bot = await ensureChatBot(job.organizationId, job.channelId);
  const conversation = await ensureConversation({
    organizationId: job.organizationId,
    channelId: job.channelId,
    phone,
  });

  await recordChatMessage({
    organizationId: job.organizationId,
    conversationId: conversation.id,
    direction: "IN",
    source: "inbound",
    body: text,
    externalId: job.externalId,
  });

  if (!bot.enabled) return { skipped: "disabled" };

  const keyword = matchChatKeyword(text, bot.keywords);
  const stop = isStopCommand(text) || keyword?.action === "opt_out";
  const start = isStartCommand(text);
  const handoffCmd = isHandoffCommand(text) || keyword?.action === "handoff";

  if (stop) {
    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { optOut: true, status: "CLOSED" },
    });
    const body = keyword?.reply || bot.optOutMessage;
    await sendAndLog({
      organizationId: job.organizationId,
      channelId: job.channelId,
      conversationId: conversation.id,
      phone,
      body,
      source: "keyword",
      keywordId: keyword?.id,
      contactId: conversation.contactId,
    });
    return { action: "opt_out" };
  }

  if (conversation.optOut && !start) {
    return { skipped: "opt_out" };
  }

  if (conversation.optOut && start) {
    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { optOut: false, status: "OPEN" },
    });
  }

  const live = await prisma.chatConversation.findUnique({ where: { id: conversation.id } });
  if (live?.status === "HANDOFF") {
    return { skipped: "handoff" };
  }

  if (handoffCmd) {
    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { status: "HANDOFF" },
    });
    const body = keyword?.reply || bot.handoffMessage;
    await sendAndLog({
      organizationId: job.organizationId,
      channelId: job.channelId,
      conversationId: conversation.id,
      phone,
      body,
      source: "keyword",
      keywordId: keyword?.id,
      contactId: conversation.contactId,
    });
    return { action: "handoff" };
  }

  if (keyword && keyword.action === "reply" && keyword.reply?.trim()) {
    await sendAndLog({
      organizationId: job.organizationId,
      channelId: job.channelId,
      conversationId: conversation.id,
      phone,
      body: keyword.reply,
      source: "keyword",
      keywordId: keyword.id,
      contactId: conversation.contactId,
    });
    return { action: "keyword" };
  }

  if (bot.aiEnabled) {
    try {
      const reply = await aiReply({
        organizationId: job.organizationId,
        conversationId: conversation.id,
        bot,
        userText: text,
      });
      if (reply) {
        await sendAndLog({
          organizationId: job.organizationId,
          channelId: job.channelId,
          conversationId: conversation.id,
          phone,
          body: reply,
          source: "ai",
          contactId: conversation.contactId,
        });
        return { action: "ai" };
      }
    } catch (err) {
      log.warn({ err, channelId: job.channelId }, "chatbot AI reply failed");
    }
  }

  await sendAndLog({
    organizationId: job.organizationId,
    channelId: job.channelId,
    conversationId: conversation.id,
    phone,
    body: bot.fallbackMessage,
    source: "fallback",
    contactId: conversation.contactId,
  });
  if (bot.unknownHandoff) {
    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { status: "HANDOFF" },
    });
  }
  return { action: "fallback" };
}
