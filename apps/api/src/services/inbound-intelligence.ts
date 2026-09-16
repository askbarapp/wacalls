import pino from "pino";
import { prisma } from "@wacalls/database";
import { normalizePhone } from "@wacalls/shared";
import { sendWhatsAppText } from "./messaging.js";
import { resolveGeminiApiKey, hasGeminiApiKey } from "./sarvam-key.js";
import { createTaskWithReminders } from "./tasks/task-service.js";

const log = pino({ name: "inbound-intelligence" });

export interface ImportantMessageItem {
  index: number;
  contactName: string;
  contactPhone: string;
  category: "MEETING" | "DEAL" | "PAYMENT" | "COMPLAINT" | "INQUIRY";
  categoryLabel: string;
  categoryEmoji: string;
  customerMessage: string;
  summary: string;
  proposedDueAt?: string | null;
  proposedTimeLabel?: string | null;
  suggestedAction: string;
}

const CASUAL_PHRASES = new Set([
  "hi",
  "hello",
  "hey",
  "namaste",
  "hlo",
  "ok",
  "okay",
  "k",
  "kk",
  "good morning",
  "good afternoon",
  "good evening",
  "gm",
  "gn",
  "theek hai",
  "thik hai",
  "ji",
  "ha",
  "haan",
  "yes",
  "thanks",
  "thank you",
  "dhanyawad",
  "shukriya",
  "bye",
  "good night",
  "tc",
  "👍",
  "🙏",
  "👌",
  "😊",
  "👋",
]);

/**
 * Checks if a message is purely casual greeting/chit-chat without substantive business action.
 */
export function isCasualChitChat(text: string): boolean {
  const clean = text.toLowerCase().replace(/[^\w\s\u0900-\u097F]/gi, "").trim();
  if (!clean || clean.length <= 2) return true;
  if (CASUAL_PHRASES.has(clean)) return true;

  const words = clean.split(/\s+/);
  if (words.length <= 2 && words.every((w) => CASUAL_PHRASES.has(w))) {
    return true;
  }
  return false;
}

/**
 * Fast deterministic classifier for customer messages when AI is offline.
 */
export function classifyInboundMessage(text: string): {
  category: "MEETING" | "DEAL" | "PAYMENT" | "COMPLAINT" | "INQUIRY";
  isActionable: boolean;
  proposedTime?: { dueAt: Date; label: string } | null;
} {
  const lower = text.toLowerCase();

  // 1. Complaints / Escalation
  const isComplaint =
    lower.includes("fraud") ||
    lower.includes("scam") ||
    lower.includes("bekar") ||
    lower.includes("kharab") ||
    lower.includes("jawab nahi") ||
    lower.includes("bakwas") ||
    lower.includes("complaint") ||
    lower.includes("refund") ||
    lower.includes("not working") ||
    lower.includes("problem") ||
    lower.includes("issue");

  if (isComplaint) {
    return { category: "COMPLAINT", isActionable: true };
  }

  // 2. Meeting / Calls
  const isMeeting =
    lower.includes("meeting") ||
    lower.includes("meet") ||
    lower.includes("mil sakte") ||
    lower.includes("milna") ||
    lower.includes("milte hain") ||
    lower.includes("call me") ||
    lower.includes("call karna") ||
    lower.includes("office aao") ||
    lower.includes("office aa jao") ||
    lower.includes("appointment") ||
    lower.includes("demo session") ||
    ((lower.includes("baje") || lower.includes("pm") || lower.includes("am")) &&
      (lower.includes("kal") || lower.includes("aaj") || lower.includes("parso") || lower.includes("time")));

  if (isMeeting) {
    // Extract tentative meeting date/time
    const now = new Date();
    const targetDate = new Date(now);
    if (lower.includes("kal") || lower.includes("tomorrow")) {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (lower.includes("parso") || lower.includes("parson")) {
      targetDate.setDate(targetDate.getDate() + 2);
    }

    let hour = 16; // default 4 PM
    let minute = 0;
    const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(baje|बजे|am|pm)/i);
    if (timeMatch && timeMatch[1]) {
      hour = parseInt(timeMatch[1], 10);
      minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const isPm =
        lower.includes("shaam") ||
        lower.includes("शाम") ||
        lower.includes("pm") ||
        lower.includes("dopahar") ||
        lower.includes("दोपहर") ||
        lower.includes("raat");
      if (isPm && hour < 12) hour += 12;
    }

    const istDate = new Date(
      Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), hour - 5, minute - 30),
    );

    const dueAt = istDate > now ? istDate : new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const timeLabel = dueAt.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    return {
      category: "MEETING",
      isActionable: true,
      proposedTime: { dueAt, label: timeLabel },
    };
  }

  // 3. Payments
  const isPayment =
    lower.includes("payment") ||
    lower.includes("paid") ||
    lower.includes("pay") ||
    lower.includes("bhej diya") ||
    lower.includes("receipt") ||
    lower.includes("invoice") ||
    lower.includes("bill") ||
    lower.includes("upi") ||
    lower.includes("gpay") ||
    lower.includes("phonepe") ||
    lower.includes("scanner") ||
    lower.includes("bank account");

  if (isPayment) {
    return { category: "PAYMENT", isActionable: true };
  }

  // 4. Quotations & Deals
  const isDeal =
    lower.includes("quotation") ||
    lower.includes("quote") ||
    lower.includes("rate") ||
    lower.includes("price") ||
    lower.includes("pricing") ||
    lower.includes("cost") ||
    lower.includes("kharidna") ||
    lower.includes("buy") ||
    lower.includes("purchase") ||
    lower.includes("order") ||
    lower.includes("discount") ||
    lower.includes("deal");

  if (isDeal) {
    return { category: "DEAL", isActionable: true };
  }

  // Check if casual
  if (isCasualChitChat(text)) {
    return { category: "INQUIRY", isActionable: false };
  }

  return { category: "INQUIRY", isActionable: text.length > 20 };
}

/**
 * Scans recent inbound customer WhatsApp messages and produces an executive summary
 * with prioritized actionable items, meetings, and 1-tap reply/schedule controls.
 */
export async function summarizeImportantInboundMessages(input: {
  channel: any;
  inputPhone: string;
  commanderName?: string;
  hoursLimit?: number;
  showAll?: boolean;
}): Promise<void> {
  const { channel, inputPhone, commanderName, hoursLimit = 48, showAll = false } = input;

  const since = new Date(Date.now() - hoursLimit * 60 * 60 * 1000);

  // Fetch bot persona name
  const profile = await prisma.businessProfile.findFirst({
    where: { organizationId: channel.organizationId },
    select: { assistantName: true },
  });
  const botName = profile?.assistantName || "TenSy";

  // Build exclusion list of commander phones to only scan customers
  const commanders = await prisma.commanderMember.findMany({
    where: { channelId: channel.id, enabled: true },
    select: { phone: true },
  });
  const excludedPhones = [channel.ownerPhone, ...commanders.map((c) => c.phone)]
    .filter(Boolean)
    .map((p) => p.replace(/\D/g, "").slice(-10));

  // Query conversations with recent inbound messages
  const conversations = await prisma.chatConversation.findMany({
    where: {
      organizationId: channel.organizationId,
      channelId: channel.id,
      lastInboundAt: { gte: since },
    },
    include: {
      contact: { select: { id: true, name: true, phone: true } },
      messages: {
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
    orderBy: { lastInboundAt: "desc" },
    take: 30,
  });

  // Filter out internal commander numbers
  const customerConversations = conversations.filter((conv) => {
    const norm = conv.phone.replace(/\D/g, "").slice(-10);
    return !excludedPhones.some((p) => p.includes(norm) || norm.includes(p));
  });

  if (customerConversations.length === 0) {
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: inputPhone,
      body: `✨ *कोई नया महत्वपूर्ण ग्राहक संदेश नहीं है!* 🎉\n━━━━━━━━━━━━━━━━━━━━\nनमस्ते ${commanderName || "Sir"}! पिछले ${hoursLimit} घंटों में ग्राहकों की तरफ से कोई नया संदेश प्राप्त नहीं हुआ है।\n\nसारे चैट और संदेश देखने के लिए *https://wacall.in/chatbot* खोलें।`,
      chatSource: "bot",
    }).catch(() => undefined);
    return;
  }

  const importantItems: ImportantMessageItem[] = [];
  let casualCount = 0;

  for (const conv of customerConversations) {
    // Get latest customer inbound message
    const inboundMsg = conv.messages.find((m) => m.direction === "IN") || conv.messages[0];
    if (!inboundMsg || !inboundMsg.body) continue;

    const rawText = inboundMsg.body.trim();
    const classification = classifyInboundMessage(rawText);

    if (!classification.isActionable && !showAll) {
      casualCount++;
      continue;
    }

    const contactName =
      conv.contact?.name && conv.contact.name !== conv.phone
        ? conv.contact.name
        : conv.phone;

    let categoryLabel = "सामान्य पूछताछ";
    let categoryEmoji = "💬";
    let suggestedAction = "ग्राहक से फॉलो-अप करें";

    if (classification.category === "MEETING") {
      categoryLabel = "मीटिंग व कॉल प्रस्ताव";
      categoryEmoji = "🤝";
      suggestedAction = classification.proposedTime?.label
        ? `${classification.proposedTime.label} की मीटिंग शेड्यूल करें`
        : "मीटिंग का समय तय करें";
    } else if (classification.category === "DEAL") {
      categoryLabel = "कोटेशन व डील अनुरोध";
      categoryEmoji = "🔥";
      suggestedAction = "हॉट लीड — तुरंत कोटेशन या रेट साझा करें";
    } else if (classification.category === "PAYMENT") {
      categoryLabel = "पेमेंट व इनवॉइस";
      categoryEmoji = "💰";
      suggestedAction = "अकाउंट्स वेरिफिकेशन व पेमेंट रसीद भेजें";
    } else if (classification.category === "COMPLAINT") {
      categoryLabel = "ग्राहक समस्या / शिकायत";
      categoryEmoji = "🚨";
      suggestedAction = "प्राथमिकता समाधान — तुरंत कॉल या मैसेज करें";
    } else {
      categoryLabel = "सामान्य संदेश / पूछताछ";
      categoryEmoji = "💬";
      suggestedAction = "ज़रूरत होने पर रिप्लाई करें";
    }

    importantItems.push({
      index: importantItems.length + 1,
      contactName,
      contactPhone: conv.phone,
      category: classification.category,
      categoryLabel,
      categoryEmoji,
      customerMessage: rawText.replace(/\n+/g, " ").slice(0, 140),
      summary: rawText.slice(0, 80),
      proposedDueAt: classification.proposedTime?.dueAt?.toISOString() || null,
      proposedTimeLabel: classification.proposedTime?.label || null,
      suggestedAction,
    });

    if (importantItems.length >= 6) break;
  }

  if (importantItems.length === 0) {
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: inputPhone,
      body: `✨ *कोई गंभीर या लम्बित कार्य संदेश नहीं है!* 👍\n━━━━━━━━━━━━━━━━━━━━\nपिछले ${hoursLimit} घंटों में आए सभी ${customerConversations.length} संदेश सामान्य बातचीत (Hi/Hello/Thanks) थे। कोई मीटिंग, कोटेशन या पेमेंट संदेश लम्बित नहीं है।`,
      chatSource: "bot",
    }).catch(() => undefined);
    return;
  }

  // Create PendingAction for 1-Tap Execution
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  await prisma.pendingAction.create({
    data: {
      organizationId: channel.organizationId,
      channelId: channel.id,
      actionType: "INBOUND_MEETING_ACTION",
      summary: `Inbound customer messages & meeting summary (${importantItems.length} items)`,
      status: "PENDING",
      expiresAt,
      payload: { items: importantItems } as any,
    },
  }).catch(() => undefined);

  // Format WhatsApp Response Card
  const headerTitle = showAll
    ? `आज के सभी ग्राहक संदेश (${importantItems.length})`
    : `महत्वपूर्ण ग्राहक संदेश व मीटिंग सारांश (${importantItems.length})`;
  let card = `📬 *${botName} — ${headerTitle}*\n━━━━━━━━━━━━━━━━━━━━\n`;

  importantItems.forEach((item) => {
    card += `${item.index}. ${item.categoryEmoji} *${item.contactName}* (${item.contactPhone})\n`;
    card += `   📌 *श्रेणी:* ${item.categoryLabel}\n`;
    card += `   💬 *संदेश:* "${item.customerMessage}"\n`;
    if (item.proposedTimeLabel) {
      card += `   ⏰ *प्रस्तावित समय:* ${item.proposedTimeLabel}\n`;
    }
    card += `   💡 *TenSy सुझाव:* ${item.suggestedAction}\n`;
    if (item.category === "MEETING") {
      card += `   👉 *'Schedule ${item.index}'* लिखें (टास्क व रिमाइंडर हेतु)\n`;
    }
    card += `\n`;
  });

  card += `━━━━━━━━━━━━━━━━━━━━\n`;
  card += `📊 *कुल स्कैन वार्तालाप:* ${customerConversations.length} (${importantItems.length} महत्वपूर्ण, ${casualCount} सामान्य)\n\n`;
  card += `💡 *1-क्लिक ऐक्शन:* किसी भी ग्राहक को उत्तर देने के लिए लिखें:\n_उदा: "Reply 1 Haan kal 4 baje milte hain"_`;

  await sendWhatsAppText({
    organizationId: channel.organizationId,
    channelId: channel.id,
    phone: inputPhone,
    body: card,
    chatSource: "bot",
  }).catch(() => undefined);
}

/**
 * Handles replies to INBOUND_MEETING_ACTION (e.g. "Schedule 1", "Meeting 1", "1", "Reply 1 ...")
 */
export async function handleInboundActionExecution(input: {
  channel: any;
  pendingAction: any;
  text: string;
  commander: any;
}): Promise<boolean> {
  const { channel, pendingAction, text, commander } = input;
  const upper = text.toUpperCase().trim();
  const payload = pendingAction.payload as { items: ImportantMessageItem[] };
  const items = payload?.items || [];

  if (items.length === 0) return false;

  // 1. "Reply [number] [message]" -> Outbound reply to customer
  const replyMatch = text.match(/^reply\s+(\d+)\s+(.+)$/i);
  if (replyMatch && replyMatch[1] && replyMatch[2]) {
    const idx = parseInt(replyMatch[1], 10);
    const replyBody = replyMatch[2].trim();
    const targetItem = items.find((it) => it.index === idx);

    if (targetItem && targetItem.contactPhone) {
      await sendWhatsAppText({
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone: targetItem.contactPhone,
        body: replyBody,
        chatSource: "human_device",
      });

      await sendWhatsAppText({
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone: commander.phone,
        body: `✅ *संदेश सफलतापूर्वक भेज दिया गया!* 🚀\n━━━━━━━━━━━━━━━━━━━━\n👤 *प्राप्तकर्ता:* ${targetItem.contactName} (${targetItem.contactPhone})\n💬 *संदेश:* "${replyBody}"`,
        chatSource: "bot",
      });
      return true;
    }
  }

  // 2. "Schedule [number]" or single number "1", "2"
  let targetIndex = 1;
  const scheduleMatch = upper.match(/^(?:SCHEDULE|MEETING|TASK)?\s*(\d+)$/i);
  if (scheduleMatch && scheduleMatch[1]) {
    targetIndex = parseInt(scheduleMatch[1], 10);
  } else if (upper !== "YES" && upper !== "HAAN" && upper !== "SCHEDULE") {
    return false;
  }

  const targetItem = items.find((it) => it.index === targetIndex) || items[0];
  if (!targetItem) return false;

  const dueAtDate = targetItem.proposedDueAt
    ? new Date(targetItem.proposedDueAt)
    : new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow same time

  const createdTask = await createTaskWithReminders({
    organizationId: channel.organizationId,
    channelId: channel.id,
    title: `Meeting: ${targetItem.contactName} - ${targetItem.summary}`,
    description: `Created from WhatsApp Inbound Message: "${targetItem.customerMessage}"`,
    dueAt: dueAtDate,
    timezone: "Asia/Kolkata",
    priority: "HIGH",
    contactName: targetItem.contactName,
    contactPhone: targetItem.contactPhone,
    assignedTo: commander.name || "Me",
    assignedPhone: commander.phone,
    recurrence: "NEVER",
    reminderOffsets: [0, 15], // At time & 15 min prior
    source: "WHATSAPP",
  });

  await prisma.pendingAction.update({
    where: { id: pendingAction.id },
    data: { status: "APPROVED" },
  });

  const dueFormatted = new Date(createdTask.dueAt || dueAtDate).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const confirmMsg = `✅ *मीटिंग टास्क शेड्यूल हो गई है!* 🤝\n━━━━━━━━━━━━━━━━━━━━\n📌 *टास्क:* ${createdTask.title}\n👤 *क्लाइंट:* ${targetItem.contactName} (${targetItem.contactPhone})\n⏰ *समय:* ${dueFormatted}\n🔔 *रिमाइंडर:* समय पर व 15 मिनट पहले\n🎯 *प्राथमिकता:* HIGH\n━━━━━━━━━━━━━━━━━━━━\nTenSy मीटिंग से 15 मिनट पहले आपको WhatsApp पर सूचना देगा!`;

  await sendWhatsAppText({
    organizationId: channel.organizationId,
    channelId: channel.id,
    phone: commander.phone,
    body: confirmMsg,
    chatSource: "bot",
  });

  return true;
}
