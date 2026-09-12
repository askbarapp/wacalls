import pino from "pino";
import { prisma } from "@wacalls/database";
import { isGreetingText, normalizePhone } from "@wacalls/shared";
import {
  createVoiceAiClient,
  defaultModelForProvider,
  normalizeVoiceProvider,
} from "@wacalls/audio-engine";
import { sendWhatsAppText } from "./messaging.js";
import { resolveVoiceApiKey } from "./sarvam-key.js";
import { broadcast } from "../ws.js";

const log = pino({ name: "chatbot-engine" });

/**
 * Triggered when a message is sent from the physical WhatsApp device (phone/web)
 * or by an agent. Automatically marks the conversation as HANDOFF (Human Active)
 * and pauses the AI bot so it doesn't interfere.
 */
export async function handleOutboundChat(input: {
  channelId: string;
  phone: string;
  text: string;
  messageId?: string;
}): Promise<void> {
  const text = input.text.trim();
  if (!text) return;

  const phoneParsed = normalizePhone(input.phone);
  const phone = phoneParsed.ok ? phoneParsed.e164 : `+${input.phone.replace(/\D/g, "")}`;
  if (phone.length < 8) return;

  const channel = await prisma.whatsAppChannel.findUnique({
    where: { id: input.channelId },
  });
  if (!channel) return;

  // Ensure contact exists
  const contact = await prisma.contact.upsert({
    where: {
      organizationId_phone: {
        organizationId: channel.organizationId,
        phone,
      },
    },
    create: {
      organizationId: channel.organizationId,
      phone,
      name: phone,
    },
    update: {},
  });

  // Upsert conversation and mark as HANDOFF (Human agent active)
  const conversation = await prisma.chatConversation.upsert({
    where: {
      organizationId_channelId_phone: {
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone,
      },
    },
    create: {
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone,
      contactId: contact.id,
      status: "HANDOFF", // Human active -> AI chatbot paused
      lastMessageAt: new Date(),
    },
    update: {
      contactId: contact.id,
      status: "HANDOFF", // Automatically switch to human takeover
      lastMessageAt: new Date(),
    },
  });

  // Save message to conversation history
  const msg = await prisma.chatMessage.create({
    data: {
      organizationId: channel.organizationId,
      conversationId: conversation.id,
      direction: "OUT",
      source: "human_device",
      body: text,
      externalId: input.messageId || undefined,
    },
  });

  log.info(
    { channelId: channel.id, phone, conversationId: conversation.id },
    "Human agent sent message from physical phone; paused AI chatbot (HANDOFF)",
  );

  broadcast(channel.organizationId, {
    type: "chat.message",
    conversationId: conversation.id,
    status: "HANDOFF",
    message: msg,
  });
}

/**
 * Triggered when an incoming WhatsApp text message arrives from a customer.
 * Executes:
 * 1. Human Takeover Check: If HANDOFF, stays silent.
 * 2. Master ON/OFF Check: If disabled, stays silent.
 * 3. Keyword Matching: Exact & Contains triggers.
 * 4. AI LLM Knowledge Base Fallback: Sarvam or Gemini.
 */
export async function handleInboundChat(input: {
  channelId: string;
  phone: string;
  text: string;
  messageId?: string;
}): Promise<void> {
  const text = input.text.trim();
  if (!text) return;

  const phoneParsed = normalizePhone(input.phone);
  const phone = phoneParsed.ok ? phoneParsed.e164 : `+${input.phone.replace(/\D/g, "")}`;
  if (phone.length < 8) return;

  const channel = await prisma.whatsAppChannel.findUnique({
    where: { id: input.channelId },
  });
  if (!channel) return;

  // Ensure contact exists
  const contact = await prisma.contact.upsert({
    where: {
      organizationId_phone: {
        organizationId: channel.organizationId,
        phone,
      },
    },
    create: {
      organizationId: channel.organizationId,
      phone,
      name: phone,
    },
    update: {},
  });

  // Find or create conversation
  const conversation = await prisma.chatConversation.upsert({
    where: {
      organizationId_channelId_phone: {
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone,
      },
    },
    create: {
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone,
      contactId: contact.id,
      status: "OPEN",
      lastMessageAt: new Date(),
      lastInboundAt: new Date(),
    },
    update: {
      contactId: contact.id,
      lastMessageAt: new Date(),
      lastInboundAt: new Date(),
    },
  });

  // Deduplication
  if (input.messageId) {
    const dup = await prisma.chatMessage.findFirst({
      where: {
        conversationId: conversation.id,
        externalId: input.messageId,
      },
    });
    if (dup) return;
  }

  // Record incoming message
  const msg = await prisma.chatMessage.create({
    data: {
      organizationId: channel.organizationId,
      conversationId: conversation.id,
      direction: "IN",
      source: "whatsapp",
      body: text,
      externalId: input.messageId || undefined,
    },
  });

  // Notify inbox UI via WebSocket
  broadcast(channel.organizationId, {
    type: "chat.message",
    conversationId: conversation.id,
    status: conversation.status,
    message: msg,
  });

  const upperText = text.toUpperCase();

  // 1. Unsubscribe / Resubscribe handling
  if (upperText === "START" || upperText === "UNSTOP") {
    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { optOut: false, status: "OPEN" },
    });
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: conversation.phone,
      body: "You have resubscribed to WhatsApp messages. How can we help you today?",
      chatSource: "bot",
    }).catch(() => undefined);
    return;
  }

  if (conversation.optOut) {
    log.info({ phone }, "Customer opted out; skipping bot response");
    return;
  }

  // 2. Human Takeover Check (Auto-Pause)
  if (conversation.status === "HANDOFF") {
    log.info(
      { conversationId: conversation.id, phone },
      "Conversation in HANDOFF mode (human agent active); AI chatbot remains silent",
    );
    return;
  }

  // 3. Manual Handoff keywords
  if (upperText === "HUMAN" || upperText === "AGENT" || upperText === "OPERATOR") {
    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { status: "HANDOFF" },
    });
    const bot = await prisma.chatBot.findUnique({ where: { channelId: channel.id } });
    const reply = bot?.handoffMessage || "Connecting you with a teammate. You can keep messaging here.";
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: conversation.phone,
      body: reply,
      chatSource: "bot",
    }).catch(() => undefined);
    return;
  }

  // 4. Load ChatBot Configuration (Master ON/OFF Check)
  const bot = await prisma.chatBot.findUnique({
    where: { channelId: channel.id },
    include: {
      keywords: {
        where: { enabled: true },
        orderBy: { sortOrder: "asc" },
      },
      aiConfig: {
        include: {
          knowledgeBase: {
            include: { documents: { take: 40 } },
          },
        },
      },
      knowledgeBase: {
        include: { documents: { take: 40 } },
      },
    },
  });

  if (!bot || !bot.enabled) {
    log.info({ channelId: channel.id }, "ChatBot is disabled (OFF) for channel; skipping response");
    return;
  }

  // 5. Greeting Message & Inactivity Cooldown
  const isGreeting = isGreetingText(text);
  const cooldownDays = bot.greetingCooldownDays ?? 14;
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
  const lastGreetingTime = conversation.lastGreetingAt ? new Date(conversation.lastGreetingAt).getTime() : 0;
  const isGreetingDue =
    bot.greetingEnabled &&
    (!conversation.lastGreetingAt || Date.now() - lastGreetingTime >= cooldownMs);

  if (isGreetingDue) {
    const greetingMsg =
      bot.greetingMessage ||
      "नमस्ते! WaCalls में आपका स्वागत है। हम आपकी क्या सहायता कर सकते हैं?";
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: conversation.phone,
      body: greetingMsg,
      chatSource: "bot",
    }).catch(() => undefined);

    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { lastGreetingAt: new Date() },
    });

    log.info(
      { phone, conversationId: conversation.id, cooldownDays },
      "Sent welcome greeting; started cooldown timer",
    );

    // If customer only sent a greeting (e.g. "Hi", "Hello"), stop here
    if (isGreeting) {
      return;
    }
  } else if (isGreeting) {
    // Cooldown is still active and customer sent "Hi" again -> suppress duplicate greeting
    log.info(
      { phone, lastGreetingAt: conversation.lastGreetingAt, cooldownDays },
      "Greeting cooldown active; suppressing repeat welcome message",
    );

    // If AI is enabled, allow AI to reply contextually, otherwise give a brief friendly prompt
    if (!bot.aiEnabled || !bot.aiConfigId) {
      await sendWhatsAppText({
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone: conversation.phone,
        body: "हाँजी, बताइए मैं आपकी और क्या सहायता कर सकता हूँ?",
        chatSource: "bot",
      }).catch(() => undefined);
      return;
    }
  }

  // 6. Keyword Matching (Exact & Contains)
  for (const kw of bot.keywords) {
    const trigger = kw.trigger.trim().toUpperCase();

    // If user's message is a greeting but greeting was already handled above, skip greeting keywords
    if (isGreeting && (trigger === "HI" || trigger === "HELLO" || trigger === "HEY" || trigger === "START")) {
      continue;
    }

    let matched = false;
    if (kw.matchType === "exact") {
      matched = upperText === trigger;
    } else {
      matched = upperText.includes(trigger);
    }

    if (matched) {
      log.info({ trigger: kw.trigger, action: kw.action, phone }, "ChatBot keyword matched");

      if (kw.action === "handoff") {
        await prisma.chatConversation.update({
          where: { id: conversation.id },
          data: { status: "HANDOFF" },
        });
        await sendWhatsAppText({
          organizationId: channel.organizationId,
          channelId: channel.id,
          phone: conversation.phone,
          body: kw.reply || bot.handoffMessage,
          chatSource: "bot",
        }).catch(() => undefined);
        return;
      }

      if (kw.action === "opt_out") {
        await prisma.chatConversation.update({
          where: { id: conversation.id },
          data: { optOut: true },
        });
        await sendWhatsAppText({
          organizationId: channel.organizationId,
          channelId: channel.id,
          phone: conversation.phone,
          body: kw.reply || bot.optOutMessage,
          chatSource: "bot",
        }).catch(() => undefined);
        return;
      }

      // Action: reply
      await sendWhatsAppText({
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone: conversation.phone,
        body: kw.reply,
        chatSource: "bot",
      }).catch(() => undefined);
      return;
    }
  }

  // 6. AI LLM Knowledge Base Fallback
  if (bot.aiEnabled && bot.aiConfigId && bot.aiConfig) {
    try {
      const historyRows = await prisma.chatMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
        take: 12,
      });

      const history = historyRows
        .reverse()
        .map((m) => ({
          role: m.direction === "IN" ? ("user" as const) : ("assistant" as const),
          content: m.body,
        }));

      const kb = (bot.knowledgeBase?.documents ?? bot.aiConfig.knowledgeBase?.documents ?? [])
        .map((d) => `### ${d.title}\n${d.content}`)
        .join("\n\n")
        .slice(0, 4500);

      const systemPrompt = [
        bot.aiConfig.systemPrompt || "You are a professional customer support representative on WhatsApp.",
        `=== WHATSAPP CHATBOT GUIDELINES ===`,
        `1. You are having a real-time text chat with a customer on WhatsApp. Be warm, helpful, and natural.`,
        `2. Match the customer's language (Hindi, Hinglish, or English). If they text in Hindi/Hinglish, reply in natural conversational Hindi/Hinglish.`,
        `3. Keep replies concise and easy to read on a mobile phone screen (2-3 short sentences).`,
        `4. Do not output markdown tables, HTML tags, or asterisks bullet dumps. Simple text with line breaks is best.`,
        kb ? `Knowledge Base documents:\n${kb}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const provider = normalizeVoiceProvider(bot.aiConfig.provider);
      const { apiKey } = await resolveVoiceApiKey(channel.organizationId, provider);
      const client = createVoiceAiClient(provider, apiKey);

      const reply = await client.chat(
        [
          { role: "system", content: systemPrompt },
          ...history.slice(-10),
          { role: "user", content: text },
        ],
        {
          model: bot.aiConfig.model || defaultModelForProvider(provider),
          temperature: 0.3,
          maxTokens: 250,
        },
      );

      if (reply && reply.trim()) {
        log.info({ phone, reply: reply.slice(0, 60) }, "ChatBot AI reply generated");
        await sendWhatsAppText({
          organizationId: channel.organizationId,
          channelId: channel.id,
          phone: conversation.phone,
          body: reply.trim(),
          chatSource: "ai",
        }).catch(() => undefined);
        return;
      }
    } catch (err) {
      log.warn({ err, phone }, "ChatBot AI generation failed; attempting fallback");
    }
  }

  // 7. Fallback Message or Unknown Handoff
  if (bot.unknownHandoff) {
    await prisma.chatConversation.update({
      where: { id: conversation.id },
      data: { status: "HANDOFF" },
    });
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: conversation.phone,
      body: bot.handoffMessage,
      chatSource: "bot",
    }).catch(() => undefined);
  } else if (bot.fallbackMessage) {
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: conversation.phone,
      body: bot.fallbackMessage,
      chatSource: "bot",
    }).catch(() => undefined);
  }
}
