import pino from "pino";
import { prisma } from "@wacalls/database";
import { normalizePhone } from "@wacalls/shared";
import {
  createVoiceAiClient,
  defaultModelForProvider,
  normalizeVoiceProvider,
} from "@wacalls/audio-engine";
import { sendWhatsAppText } from "./messaging.js";
import { resolveVoiceApiKey } from "./sarvam-key.js";
import { broadcast } from "../ws.js";

const log = pino({ name: "business-assistant" });

/**
 * Checks if a given incoming/outbound sender phone number belongs to the Business Owner.
 */
export async function isOwnerPhone(channelId: string, rawPhone: string): Promise<boolean> {
  const channel = await prisma.whatsAppChannel.findUnique({
    where: { id: channelId },
    select: { ownerPhone: true, phoneNumber: true },
  });
  if (!channel) return false;

  const phoneParsed = normalizePhone(rawPhone);
  const normalizedSender = phoneParsed.ok ? phoneParsed.e164.replace(/\D/g, "") : rawPhone.replace(/\D/g, "");

  // Match against ownerPhone if configured
  if (channel.ownerPhone) {
    const ownerParsed = normalizePhone(channel.ownerPhone);
    const normalizedOwner = ownerParsed.ok ? ownerParsed.e164.replace(/\D/g, "") : channel.ownerPhone.replace(/\D/g, "");
    if (normalizedSender === normalizedOwner) return true;
  }

  // Match against channel's own paired phone (self-chat / message yourself)
  if (channel.phoneNumber) {
    const channelPhone = channel.phoneNumber.replace(/\D/g, "");
    if (normalizedSender === channelPhone) return true;
  }

  return false;
}

/**
 * Handles incoming WhatsApp commands and forwards from the Business Owner.
 * Returns true if the message was handled as an owner command.
 */
export async function handleOwnerCommand(input: {
  channelId: string;
  phone: string;
  text: string;
  messageId?: string;
}): Promise<boolean> {
  const text = input.text.trim();
  if (!text) return false;

  const channel = await prisma.whatsAppChannel.findUnique({
    where: { id: input.channelId },
    include: { organization: true },
  });
  if (!channel) return false;

  const upperText = text.toUpperCase();

  // -------------------------------------------------------------
  // 1. Check for Active Pending Action (The 🟡 "Ask First" Loop)
  // -------------------------------------------------------------
  const pendingAction = await prisma.pendingAction.findFirst({
    where: {
      channelId: channel.id,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (pendingAction) {
    // Check Affirmative responses
    const isYes = [
      "YES",
      "Y",
      "HAAN",
      "HA",
      "HAA",
      "1",
      "CONFIRM",
      "OK",
      "SAHI HAI",
      "THEEK HAI",
      "DONE",
      "KAR DO",
      "BHEJ DO",
    ].includes(upperText);

    // Check Negative responses
    const isNo = [
      "NO",
      "N",
      "NAHI",
      "NA",
      "CANCEL",
      "RUKO",
      "MAT KARO",
      "REJECT",
      "2",
    ].includes(upperText);

    if (isYes) {
      await executePendingAction(channel, pendingAction);
      return true;
    } else if (isNo) {
      await prisma.pendingAction.update({
        where: { id: pendingAction.id },
        data: { status: "REJECTED" },
      });
      await sendWhatsAppText({
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone: input.phone,
        body: "❌ Action cancelled. Anything else I can assist you with, Boss?",
        chatSource: "bot",
      }).catch(() => undefined);
      return true;
    }
  }

  // -------------------------------------------------------------
  // 2. "Forward to WaCall" / Chat Forwarding Detection
  // -------------------------------------------------------------
  const isForwarded =
    text.includes("[") && text.includes("]") && (text.includes(":") || text.includes("/"));
  const hasForwardSignals =
    isForwarded ||
    text.toLowerCase().includes("mil sakte") ||
    text.toLowerCase().includes("quotation bhej") ||
    text.toLowerCase().includes("quote") ||
    text.toLowerCase().includes("kal 4 baje") ||
    text.toLowerCase().includes("call me") ||
    text.toLowerCase().includes("visiting card");

  if (hasForwardSignals && text.length > 15) {
    const extracted = await parseForwardedContent(channel.organizationId, text);
    if (extracted && extracted.actionType) {
      // Create Pending Action
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 mins
      await prisma.pendingAction.create({
        data: {
          organizationId: channel.organizationId,
          channelId: channel.id,
          actionType: extracted.actionType,
          summary: extracted.summary,
          payload: extracted.payload as any,
          status: "PENDING",
          expiresAt,
        },
      });

      // Send proposal card to Owner
      await sendWhatsAppText({
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone: input.phone,
        body: extracted.confirmationCard,
        chatSource: "bot",
      }).catch(() => undefined);

      log.info({ channelId: channel.id, actionType: extracted.actionType }, "Forwarded content parsed; pending action sent to owner");
      return true;
    }
  }

  // -------------------------------------------------------------
  // 3. Natural Language Commands
  // -------------------------------------------------------------

  // A. "Today's Work" / "आज के सारे काम बताओ" / "Summary"
  if (
    upperText.includes("KAAM") ||
    upperText.includes("TASKS") ||
    upperText.includes("SUMMARY") ||
    upperText.includes("TODAY") ||
    upperText.includes("STATUS") ||
    upperText.includes("SABHI KAAM")
  ) {
    const summaryCard = await generateDailyWorkSummary(channel.organizationId, channel.id);
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: input.phone,
      body: summaryCard,
      chatSource: "bot",
    }).catch(() => undefined);
    return true;
  }

  // B. "Hot Leads" / "Deals"
  if (upperText.includes("LEAD") || upperText.includes("HOT") || upperText.includes("DEAL")) {
    const leadsCard = await generateHotLeadsSummary(channel.organizationId, channel.id);
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: input.phone,
      body: leadsCard,
      chatSource: "bot",
    }).catch(() => undefined);
    return true;
  }

  // C. Call Command (e.g. "Call Rahul", "Call +919876543210")
  if (upperText.startsWith("CALL ") || upperText.startsWith("CALL KARO ")) {
    const target = text.replace(/^(call|call karo)\s+/i, "").trim();
    const callCard = await handleCallCommand(channel, target);
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: input.phone,
      body: callCard,
      chatSource: "bot",
    }).catch(() => undefined);
    return true;
  }

  // Default Assistant Response to Owner
  await sendWhatsAppText({
    organizationId: channel.organizationId,
    channelId: channel.id,
    phone: input.phone,
    body: `👋 *WaCall Assistant Active*\n\nआप मुझसे WhatsApp पर सीधे पूछ सकते हैं:\n• *"आज के सारे काम बताओ"*\n• *"Hot leads निकालो"*\n• *"Call [Name/Number]"*\n• या किसी भी ग्राहक का मैसेज मुझे *Forward* कर दीजिए!`,
    chatSource: "bot",
  }).catch(() => undefined);

  return true;
}

/**
 * Executes a verified PendingAction after Owner confirms YES.
 */
async function executePendingAction(channel: any, action: any): Promise<void> {
  const payload = action.payload as Record<string, any>;

  await prisma.pendingAction.update({
    where: { id: action.id },
    data: { status: "APPROVED" },
  });

  if (action.actionType === "BOOK_APPOINTMENT") {
    // Find or create contact
    const contact = payload.phone
      ? await prisma.contact.upsert({
          where: {
            organizationId_phone: {
              organizationId: channel.organizationId,
              phone: payload.phone,
            },
          },
          create: {
            organizationId: channel.organizationId,
            phone: payload.phone,
            name: payload.contactName || payload.phone,
          },
          update: { name: payload.contactName || undefined },
        })
      : null;

    // Resolve or find first aiConfig
    const firstAi = await prisma.aiConfig.findFirst({
      where: { organizationId: channel.organizationId },
    });

    if (firstAi) {
      const startsAt = payload.dateTime ? new Date(payload.dateTime) : new Date(Date.now() + 24 * 3600 * 1000);
      const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

      await prisma.appointment.create({
        data: {
          organizationId: channel.organizationId,
          aiConfigId: firstAi.id,
          channelId: channel.id,
          contactId: contact?.id,
          phone: payload.phone || channel.phoneNumber,
          contactName: payload.contactName || "Client",
          startsAt,
          endsAt,
          notes: payload.notes || action.summary,
          status: "BOOKED",
        },
      });

      // Also create a business task
      await prisma.businessTask.create({
        data: {
          organizationId: channel.organizationId,
          channelId: channel.id,
          title: `Appointment with ${payload.contactName || "Client"}`,
          description: payload.notes || action.summary,
          contactName: payload.contactName,
          contactPhone: payload.phone,
          dueAt: startsAt,
          priority: "HIGH",
          status: "PENDING",
          source: "forward_whatsapp",
        },
      });
    }

    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: channel.ownerPhone || channel.phoneNumber,
      body: `✅ *Appointment Confirmed!*\n\n• *Customer*: ${payload.contactName || "Client"}\n• *Date & Time*: ${payload.formattedTime || "Tomorrow"}\n• *Notes*: ${payload.notes || "Meeting scheduled"}\n\nCalendar task has been created. Reminder will be sent automatically.`,
      chatSource: "bot",
    }).catch(() => undefined);
    return;
  }

  if (action.actionType === "CREATE_TASK" || action.actionType === "QUOTATION_TASK") {
    await prisma.businessTask.create({
      data: {
        organizationId: channel.organizationId,
        channelId: channel.id,
        title: payload.title || action.summary,
        description: payload.description || action.summary,
        contactName: payload.contactName,
        contactPhone: payload.phone,
        amount: payload.amount ? parseFloat(payload.amount) : undefined,
        dueAt: payload.dueAt ? new Date(payload.dueAt) : new Date(Date.now() + 24 * 3600 * 1000),
        priority: payload.priority || "MEDIUM",
        status: "PENDING",
        source: "forward_whatsapp",
      },
    });

    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: channel.ownerPhone || channel.phoneNumber,
      body: `✅ *Task Created Successfully!*\n\n📋 *Task*: ${payload.title || action.summary}\n👤 *Contact*: ${payload.contactName || "Client"}\n💰 *Amount*: ${payload.amount ? `₹${payload.amount}` : "N/A"}\n\nTask has been assigned to your Work Inbox.`,
      chatSource: "bot",
    }).catch(() => undefined);
    return;
  }

  // Default acknowledgement
  await sendWhatsAppText({
    organizationId: channel.organizationId,
    channelId: channel.id,
    phone: channel.ownerPhone || channel.phoneNumber,
    body: `✅ *Action Approved & Executed!*\n\n${action.summary}`,
    chatSource: "bot",
  }).catch(() => undefined);
}

/**
 * Uses LLM to parse forwarded messages (Appointment requests, Quotation requests, etc.)
 */
async function parseForwardedContent(
  organizationId: string,
  rawText: string,
): Promise<{
  actionType: string;
  summary: string;
  payload: Record<string, any>;
  confirmationCard: string;
} | null> {
  try {
    const { apiKey } = await resolveVoiceApiKey(organizationId, "sarvam");
    const client = createVoiceAiClient("sarvam", apiKey);

    const prompt = `You are a smart WhatsApp business assistant. A business owner forwarded a customer's message to you.
Analyze the text and extract business entities:
1. Is it an APPOINTMENT request? (meeting time, date, person name)
2. Is it a QUOTATION request? (product, quantity, budget, person name)
3. Is it a general TASK or FOLLOW-UP?

Return valid JSON strictly matching this schema:
{
  "actionType": "BOOK_APPOINTMENT" | "QUOTATION_TASK" | "CREATE_TASK",
  "contactName": string or null,
  "phone": string or null,
  "formattedTime": string (e.g. "Tomorrow at 4:00 PM" or "Tuesday"),
  "itemOrProduct": string or null,
  "amount": number or null,
  "notes": string,
  "summary": string
}

Input text:
"${rawText.slice(0, 800)}"`;

    const res = await client.chat(
      [
        { role: "system", content: "You are a precise JSON extractor. Output ONLY JSON." },
        { role: "user", content: prompt },
      ],
      { temperature: 0.1, maxTokens: 400 },
    );

    const cleaned = res.replace(/```json/gi, "").replace(/```/g, "").trim();
    const data = JSON.parse(cleaned);

    let confirmationCard = "";
    if (data.actionType === "BOOK_APPOINTMENT") {
      confirmationCard = `📅 *Appointment Request Detected*\n\n• *Customer*: ${data.contactName || "Client"}\n• *Scheduled Time*: ${data.formattedTime || "Upcoming"}\n• *Notes*: ${data.notes || "Discussion"}\n\n*Appointment create kar doon?*\n👉 Reply *'YES'* to confirm or *'NO'* to cancel.`;
    } else if (data.actionType === "QUOTATION_TASK") {
      confirmationCard = `📄 *Quotation Request Detected*\n\n• *Customer*: ${data.contactName || "Client"}\n• *Product/Plan*: ${data.itemOrProduct || "General Service"}\n• *Estimated Amount*: ${data.amount ? `₹${data.amount}` : "As per pricing"}\n\n*Quotation task bana kar send queue me dal doon?*\n👉 Reply *'YES'* to confirm or *'NO'* to cancel.`;
    } else {
      confirmationCard = `📋 *Task Detected*\n\n• *Task*: ${data.summary || "Follow up"}\n• *Contact*: ${data.contactName || "Client"}\n\n*Work Inbox me task save kar doon?*\n👉 Reply *'YES'* to confirm or *'NO'* to cancel.`;
    }

    return {
      actionType: data.actionType || "CREATE_TASK",
      summary: data.summary || "Business Action",
      payload: data,
      confirmationCard,
    };
  } catch (err) {
    log.warn({ err }, "LLM forward parse failed; falling back to heuristic");
    return null;
  }
}

/**
 * Generates the "Today's Work" briefing card for the Owner.
 */
async function generateDailyWorkSummary(organizationId: string, channelId: string): Promise<string> {
  const [tasks, hotLeads, appointments] = await Promise.all([
    prisma.businessTask.findMany({
      where: { organizationId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.chatConversation.findMany({
      where: { organizationId, leadStage: "HOT", status: { not: "CLOSED" } },
      orderBy: { lastMessageAt: "desc" },
      take: 5,
      include: { contact: true },
    }),
    prisma.appointment.findMany({
      where: {
        organizationId,
        status: "BOOKED",
        startsAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
      orderBy: { startsAt: "asc" },
      take: 3,
    }),
  ]);

  const lines = [
    `📋 *WaCall — Today's Work Overview*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🔥 *Hot Leads (${hotLeads.length})*:`,
  ];

  if (hotLeads.length === 0) {
    lines.push(`_No active hot leads at the moment._`);
  } else {
    for (const l of hotLeads) {
      const name = l.contact?.name || l.phone;
      const val = l.dealValue ? `(₹${l.dealValue.toLocaleString()})` : "";
      lines.push(`• *${name}* ${val} — ${l.intent || "Interest shown"}`);
    }
  }

  lines.push(`\n📅 *Today's Appointments (${appointments.length})*:`);
  if (appointments.length === 0) {
    lines.push(`_No meetings scheduled today._`);
  } else {
    for (const a of appointments) {
      const time = a.startsAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      lines.push(`• *${time}* — ${a.contactName || a.phone} (${a.notes || "Call"})`);
    }
  }

  lines.push(`\n📋 *Pending Action Tasks (${tasks.length})*:`);
  if (tasks.length === 0) {
    lines.push(`_All tasks completed! 👍_`);
  } else {
    for (const t of tasks) {
      lines.push(`• *${t.title}* [${t.priority}]`);
    }
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`💡 *Quick Command*: Type *'Call [Name]'* to connect any client immediately via AI.`);

  return lines.join("\n");
}

/**
 * Generates Hot Leads summary for the Owner.
 */
async function generateHotLeadsSummary(organizationId: string, channelId: string): Promise<string> {
  const hotLeads = await prisma.chatConversation.findMany({
    where: {
      organizationId,
      OR: [{ leadStage: "HOT" }, { leadStage: "WARM" }],
      status: { not: "CLOSED" },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 8,
    include: {
      contact: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (hotLeads.length === 0) {
    return `🔥 *Hot Leads*: Abhi koi high-intent leads pending nahi hain. Naye incoming messages aate hi main automatically classify kar doonga.`;
  }

  const lines = [
    `🔥 *WaCall — Top Active Leads*`,
    `━━━━━━━━━━━━━━━━━━━━`,
  ];

  for (const l of hotLeads) {
    const name = l.contact?.name || l.phone;
    const badge = l.leadStage === "HOT" ? "🔥 HOT" : "⚡ WARM";
    const lastMsg = l.messages[0]?.body ? `_"${l.messages[0].body.slice(0, 50)}"_` : "";
    lines.push(`• *${name}* [${badge}]`);
    if (l.dealValue) lines.push(`  Deal: ₹${l.dealValue.toLocaleString()}`);
    if (lastMsg) lines.push(`  Last: ${lastMsg}`);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`Reply *'Call [Name]'* to reach any lead.`);
  return lines.join("\n");
}

/**
 * Handles "Call [Target]" command from Owner.
 */
async function handleCallCommand(channel: any, target: string): Promise<string> {
  // Find contact by name or phone
  const contact = await prisma.contact.findFirst({
    where: {
      organizationId: channel.organizationId,
      OR: [
        { name: { contains: target, mode: "insensitive" } },
        { phone: { contains: target } },
      ],
    },
  });

  const phone = contact?.phone || target;
  const name = contact?.name || target;

  return `☎️ *Initiate AI Call?*\n\n• *Target*: ${name}\n• *Phone*: ${phone}\n\nCalling queue me schedule kar doon?\n👉 Reply *'YES'* to connect now or *'NO'* to cancel.`;
}

/**
 * Autonomous Customer Message Classifier.
 * Runs in background on every customer message to tag Lead Stage, Intent, Sentiment,
 * and dispatch 🚨 Escalation Alerts to the Owner if customer is angry or urgent.
 */
export async function classifyAndEscalateCustomerMessage(input: {
  channel: any;
  conversation: any;
  text: string;
}): Promise<void> {
  const { channel, conversation, text } = input;
  const lower = text.toLowerCase();

  let leadStage = conversation.leadStage || "NEW";
  let intent = conversation.intent || "GENERAL";
  let sentiment = "NEUTRAL";
  let isEscalation = false;

  // 1. Angry / Escalation Keywords
  const angryTriggers = [
    "fraud",
    "scam",
    "bekar",
    "kharab",
    "jawab nahi",
    "bakwas",
    "cheating",
    "police",
    "consumer court",
    "worst",
    "terrible",
    "3 din",
    "do din",
    "loot",
    "chutiya",
    "ghatia",
    "fake",
    "complaint",
  ];

  for (const trig of angryTriggers) {
    if (lower.includes(trig)) {
      sentiment = "ANGRY";
      intent = "COMPLAINT";
      isEscalation = true;
      break;
    }
  }

  // 2. High Intent / Buying Signals
  if (!isEscalation) {
    const buyTriggers = [
      "kharidna",
      "buy",
      "purchase",
      "payment",
      "pay",
      "account number",
      "upi",
      "scanner",
      "deal",
      "confirm order",
      "book now",
      "ready to pay",
    ];
    for (const trig of buyTriggers) {
      if (lower.includes(trig)) {
        leadStage = "HOT";
        intent = "PAYMENT";
        break;
      }
    }

    const priceTriggers = ["price", "pricing", "cost", "kitne ka", "charge", "rate", "quote", "quotation"];
    for (const trig of priceTriggers) {
      if (lower.includes(trig) && leadStage !== "HOT") {
        leadStage = "WARM";
        intent = "PRICE";
        break;
      }
    }
  }

  // 3. Update Conversation record
  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: {
      leadStage,
      intent,
      sentiment,
      workCategory: isEscalation ? "PRIORITY" : leadStage === "HOT" ? "SALES" : "LEAD",
    },
  });

  // 4. If Urgent Escalation -> Send WhatsApp Alert to Owner immediately!
  if (isEscalation && channel.ownerPhone) {
    const alertMsg = [
      `🚨 *URGENT CUSTOMER ESCALATION*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `• *Customer*: ${conversation.contact?.name || conversation.phone}`,
      `• *Message*: _"${text.slice(0, 120)}"_`,
      `• *Detected*: Customer Discontent / Complaint`,
      `• *Priority*: 🔴 HIGH`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `👉 Reply *'CALL ${conversation.phone}'* to reach them, or message directly from your phone.`,
    ].join("\n");

    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: channel.ownerPhone,
      body: alertMsg,
      chatSource: "bot",
    }).catch(() => undefined);

    log.warn(
      { phone: conversation.phone, ownerPhone: channel.ownerPhone },
      "Sent urgent customer escalation alert to business owner",
    );
  }
}
