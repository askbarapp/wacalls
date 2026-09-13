import pino from "pino";
import { prisma } from "@wacalls/database";
import { redis } from "../redis.js";
import { sendWhatsAppText } from "./messaging.js";

const log = pino({ name: "daily-briefing" });

/**
 * Periodically called (every 60 seconds) to check if 9:00 AM IST or 8:00 PM IST has arrived,
 * and delivers the Morning Business Briefing or EOD Performance Report to the Business Owner.
 */
export async function processDailyBriefingTick(): Promise<void> {
  const now = new Date();
  // Compute Indian Standard Time (IST: UTC+5:30)
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffsetMs);

  const istHour = istTime.getUTCHours();
  const istMinutes = istTime.getUTCMinutes();
  const todayStr = istTime.toISOString().slice(0, 10); // YYYY-MM-DD

  // Morning Briefing window: 9:00 AM to 9:10 AM IST
  const isMorningWindow = istHour === 9 && istMinutes < 10;

  // EOD Report window: 8:00 PM (20:00) to 8:10 PM IST
  const isEodWindow = istHour === 20 && istMinutes < 10;

  if (!isMorningWindow && !isEodWindow) {
    return;
  }

  // Find all channels with an active ownerPhone
  const channels = await prisma.whatsAppChannel.findMany({
    where: {
      status: "CONNECTED",
      ownerPhone: { not: null },
    },
    include: {
      organization: true,
    },
  });

  for (const channel of channels) {
    if (!channel.ownerPhone) continue;

    // A. Deliver 9 AM Morning Briefing
    if (isMorningWindow) {
      const lockKey = `wacall:briefing:morning:${todayStr}:${channel.id}`;
      const alreadySent = await redis.get(lockKey);
      if (!alreadySent) {
        await sendMorningBriefing(channel, todayStr).catch((err) =>
          log.error({ err: err?.message, channelId: channel.id }, "Failed to send morning briefing"),
        );
        await redis.set(lockKey, "1", "EX", 20 * 3600); // 20 hours TTL
      }
    }

    // B. Deliver 8 PM EOD Report
    if (isEodWindow) {
      const lockKey = `wacall:briefing:eod:${todayStr}:${channel.id}`;
      const alreadySent = await redis.get(lockKey);
      if (!alreadySent) {
        await sendEodReport(channel, todayStr).catch((err) =>
          log.error({ err: err?.message, channelId: channel.id }, "Failed to send EOD report"),
        );
        await redis.set(lockKey, "1", "EX", 20 * 3600); // 20 hours TTL
      }
    }
  }
}

/**
 * Builds and sends the 9:00 AM Morning Executive Briefing.
 */
async function sendMorningBriefing(channel: any, todayStr: string): Promise<void> {
  const orgId = channel.organizationId;
  const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);
  const endOfDay = new Date(`${todayStr}T23:59:59.999Z`);

  const [pendingTasks, hotLeads, dueInvoices, appointments] = await Promise.all([
    // Today's pending tasks
    prisma.businessTask.findMany({
      where: {
        organizationId: orgId,
        status: "PENDING",
      },
      orderBy: { dueAt: "asc" },
      take: 5,
    }),
    // Hot leads awaiting action
    prisma.chatConversation.findMany({
      where: {
        organizationId: orgId,
        leadStage: "HOT",
        status: { not: "CLOSED" },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 4,
      include: { contact: true },
    }),
    // Invoices with payment due today or overdue
    prisma.businessInvoice.findMany({
      where: {
        organizationId: orgId,
        status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
      },
      take: 4,
    }),
    // Appointments scheduled
    prisma.appointment.findMany({
      where: {
        organizationId: orgId,
        status: "BOOKED",
        startsAt: { gte: startOfDay, lte: endOfDay },
      },
      take: 3,
    }),
  ]);

  const dateFormatted = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let card = `🌅 *WaCall — Morning Business Briefing (सुबह की रिपोर्ट)*
📅 ${dateFormatted}
━━━━━━━━━━━━━━━━━━━━\n`;

  // 1. Appointments
  if (appointments.length > 0) {
    card += `\n🤝 *आज की मीटिंग्स व डेमो (Appointments):*\n`;
    for (const appt of appointments) {
      const timeStr = new Date(appt.startsAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      });
      card += `• ${timeStr} — *${appt.contactName || appt.phone}* (${appt.notes || "Meeting"})\n`;
    }
  }

  // 2. Pending Tasks
  card += `\n📋 *आज के मुख्य कार्य (Priority Tasks):*\n`;
  if (pendingTasks.length === 0) {
    card += `• कोई पेंडिंग टास्क नहीं है। आप बिल्कुल फ्री हैं!\n`;
  } else {
    pendingTasks.forEach((t, i) => {
      card += `${i + 1}. *${t.title}*${t.amount ? ` (₹${t.amount.toLocaleString("en-IN")})` : ""}\n`;
    });
  }

  // 3. Hot Leads
  if (hotLeads.length > 0) {
    card += `\n🔥 *Hot Leads (तुरंत ध्यान देने योग्य ग्राहक):*\n`;
    for (const lead of hotLeads) {
      const name = lead.contact?.name || lead.phone;
      card += `• *${name}* (${lead.intent || "High Interest"})${lead.dealValue ? ` — ₹${lead.dealValue.toLocaleString("en-IN")}` : ""}\n`;
    }
  }

  // 4. Invoices & Payments
  if (dueInvoices.length > 0) {
    const totalPending = dueInvoices.reduce((sum, inv) => sum + (inv.total - inv.amountPaid), 0);
    card += `\n💰 *बकाया भुगतान (Collections to Follow):*\n`;
    card += `• कुल लंबित: ₹${totalPending.toLocaleString("en-IN")} (${dueInvoices.length} इनवॉइस)\n`;
  }

  card += `\n━━━━━━━━━━━━━━━━━━━━
💪 *शुभ प्रभात, Boss! आज का दिन सफल और बहुत उत्पादक रहे!*
(विवरण देखने के लिए किसी भी समय *"आज के काम"* या *"Hot leads"* भेजें)`;

  await sendWhatsAppText({
    organizationId: orgId,
    channelId: channel.id,
    phone: channel.ownerPhone,
    body: card,
    chatSource: "bot",
  });

  log.info({ channelId: channel.id, ownerPhone: channel.ownerPhone }, "Sent morning briefing to owner");
}

/**
 * Builds and sends the 8:00 PM End-of-Day (EOD) Performance Report.
 */
async function sendEodReport(channel: any, todayStr: string): Promise<void> {
  const orgId = channel.organizationId;
  const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);

  const [totalMessagesToday, leadsToday, completedTasksToday, callsToday, invoicesToday] =
    await Promise.all([
      // Total WhatsApp messages received today
      prisma.chatMessage.count({
        where: {
          organizationId: orgId,
          direction: "IN",
          createdAt: { gte: startOfDay },
        },
      }),
      // Hot leads active today
      prisma.chatConversation.count({
        where: {
          organizationId: orgId,
          leadStage: "HOT",
          lastMessageAt: { gte: startOfDay },
        },
      }),
      // Tasks completed today
      prisma.businessTask.count({
        where: {
          organizationId: orgId,
          status: "COMPLETED",
          updatedAt: { gte: startOfDay },
        },
      }),
      // AI voice calls placed today
      prisma.call.count({
        where: {
          organizationId: orgId,
          createdAt: { gte: startOfDay },
        },
      }),
      // Invoices/Quotations issued today
      prisma.businessInvoice.findMany({
        where: {
          organizationId: orgId,
          createdAt: { gte: startOfDay },
        },
      }),
    ]);

  const totalInvoiced = invoicesToday.reduce((sum, inv) => sum + inv.total, 0);
  const totalCollected = invoicesToday.reduce((sum, inv) => sum + inv.amountPaid, 0);

  const dateFormatted = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const card = `🌙 *WaCall — End of Day Performance Report (शाम का सारांश)*
📅 ${dateFormatted}
━━━━━━━━━━━━━━━━━━━━
📊 *आज दिन भर का बिजनेस स्कोरकार्ड:*

• 💬 *कुल ग्राहक संदेश (Inbound Chats):* ${totalMessagesToday}
• 🔥 *Hot Leads सक्रिय:* ${leadsToday}
• 🤖 *AI Voice Calls किए गए:* ${callsToday}
• ✅ *टास्क पूरे किए गए:* ${completedTasksToday}
• 📄 *नए इनवॉइस/कोटेशन:* ${invoicesToday.length}${totalInvoiced > 0 ? ` (₹${totalInvoiced.toLocaleString("en-IN")})` : ""}
• 💰 *आज जमा भुगतान (Collected):* ₹${totalCollected.toLocaleString("en-IN")}
━━━━━━━━━━━━━━━━━━━━
✨ *शानदार काम, Boss! आज का पूरा रिकॉर्ड सुरक्षित है। Relax & Good Night!* 😴`;

  await sendWhatsAppText({
    organizationId: orgId,
    channelId: channel.id,
    phone: channel.ownerPhone,
    body: card,
    chatSource: "bot",
  });

  log.info({ channelId: channel.id, ownerPhone: channel.ownerPhone }, "Sent EOD performance report to owner");
}
