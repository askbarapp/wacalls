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
  const currentSlotTime = `${String(istHour).padStart(2, "0")}:${String(istMinutes).padStart(2, "0")}`;
  const todayStr = istTime.toISOString().slice(0, 10); // YYYY-MM-DD

  // Find all channels with an active ownerPhone or active commander members
  const channels = await prisma.whatsAppChannel.findMany({
    where: {
      status: "CONNECTED",
      OR: [
        { ownerPhone: { not: null } },
        { commanderMembers: { some: { enabled: true } } },
      ],
    },
    include: {
      organization: true,
      commanderMembers: { where: { enabled: true } },
    },
  });

  for (const channel of channels) {
    // Check customized schedule slots from BusinessProfile
    const profile = await prisma.businessProfile.findFirst({
      where: { organizationId: channel.organizationId },
    });

    const morningSlot = profile?.morningSlot || "09:00";
    const morningEnabled = profile?.morningEnabled !== false;
    const eodSlot = profile?.eodSlot || "20:00";
    const eodEnabled = profile?.eodEnabled !== false;

    const [mH = 9, mM = 0] = morningSlot.split(":").map(Number);
    const [eH = 20, eM = 0] = eodSlot.split(":").map(Number);

    // Slot match within a 10-minute window
    const isMorningWindow = morningEnabled && istHour === mH && istMinutes >= mM && istMinutes < mM + 10;
    const isEodWindow = eodEnabled && istHour === eH && istMinutes >= eM && istMinutes < eM + 10;

    if (!isMorningWindow && !isEodWindow) {
      continue;
    }

    // Compile distinct authorized recipients
    const recipientsMap = new Map<string, { phone: string; name: string; role: string; dailyMorning: boolean; dailyEod: boolean }>();

    if (channel.ownerPhone) {
      recipientsMap.set(channel.ownerPhone.replace(/\D/g, ""), {
        phone: channel.ownerPhone,
        name: "Boss",
        role: "OWNER",
        dailyMorning: true,
        dailyEod: true,
      });
    }

    for (const m of channel.commanderMembers) {
      const clean = m.phone.replace(/\D/g, "");
      if (!recipientsMap.has(clean)) {
        recipientsMap.set(clean, {
          phone: m.phone,
          name: m.name,
          role: m.role,
          dailyMorning: m.dailyMorning,
          dailyEod: m.dailyEod,
        });
      }
    }

    const recipients = Array.from(recipientsMap.values());

    // A. Deliver 9 AM Morning Briefing
    if (isMorningWindow) {
      for (const rec of recipients) {
        if (!rec.dailyMorning) continue;
        const cleanPhone = rec.phone.replace(/\D/g, "");
        const lockKey = `wacall:briefing:morning:${todayStr}:${channel.id}:${cleanPhone}`;
        const alreadySent = await redis.get(lockKey);
        if (!alreadySent) {
          await sendMorningBriefing(channel, todayStr, rec).catch((err) =>
            log.error({ err: err?.message, channelId: channel.id, phone: rec.phone }, "Failed to send morning briefing"),
          );
          await redis.set(lockKey, "1", "EX", 20 * 3600); // 20 hours TTL
        }
      }
    }

    // B. Deliver 8 PM EOD Report
    if (isEodWindow) {
      for (const rec of recipients) {
        if (!rec.dailyEod) continue;
        const cleanPhone = rec.phone.replace(/\D/g, "");
        const lockKey = `wacall:briefing:eod:${todayStr}:${channel.id}:${cleanPhone}`;
        const alreadySent = await redis.get(lockKey);
        if (!alreadySent) {
          await sendEodReport(channel, todayStr, rec).catch((err) =>
            log.error({ err: err?.message, channelId: channel.id, phone: rec.phone }, "Failed to send EOD report"),
          );
          await redis.set(lockKey, "1", "EX", 20 * 3600); // 20 hours TTL
        }
      }
    }
  }
}

/**
 * Builds and sends the 9:00 AM Morning Executive Briefing tailored to the commander's role.
 */
export async function sendMorningBriefing(
  channel: any,
  todayStr: string,
  recipient: { phone: string; name: string; role: string },
): Promise<void> {
  const orgId = channel.organizationId;
  const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);
  const endOfDay = new Date(`${todayStr}T23:59:59.999Z`);

  const [pendingTasks, hotLeads, dueInvoices, appointments, importantEmails] = await Promise.all([
    // Today's pending tasks
    prisma.businessTask.findMany({
      where: {
        organizationId: orgId,
        status: { in: ["TODO", "IN_PROGRESS", "PENDING"] },
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
    recipient.role !== "SALES_MANAGER"
      ? prisma.businessInvoice.findMany({
          where: {
            organizationId: orgId,
            status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
          },
          take: 4,
        })
      : Promise.resolve([]),
    // Appointments scheduled
    prisma.appointment.findMany({
      where: {
        organizationId: orgId,
        status: "BOOKED",
        startsAt: { gte: startOfDay, lte: endOfDay },
      },
      take: 3,
    }),
    // Recent Urgent/Important Emails
    prisma.emailMessage.findMany({
      where: {
        organizationId: orgId,
        priority: { in: ["URGENT", "IMPORTANT"] },
        date: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { date: "desc" },
      take: 3,
    }),
  ]);

  const dateFormatted = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let card = `🌅 *WaCall — Morning Business Briefing (सुबह की रिपोर्ट)*\n📅 ${dateFormatted}\n━━━━━━━━━━━━━━━━━━━━\n`;

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
  if (recipient.role !== "ACCOUNTS") {
    card += `\n📋 *आज के मुख्य कार्य (Priority Tasks):*\n`;
    if (pendingTasks.length === 0) {
      card += `• कोई पेंडिंग टास्क नहीं है। आप बिल्कुल फ्री हैं!\n`;
    } else {
      pendingTasks.forEach((t, i) => {
        card += `${i + 1}. *${t.title}*${t.amount && recipient.role === "OWNER" ? ` (₹${t.amount.toLocaleString("en-IN")})` : ""}\n`;
      });
    }
  }

  // 3. Hot Leads
  if (hotLeads.length > 0 && recipient.role !== "ACCOUNTS") {
    card += `\n🔥 *Hot Leads (तुरंत ध्यान देने योग्य ग्राहक):*\n`;
    for (const lead of hotLeads) {
      const name = lead.contact?.name || lead.phone;
      card += `• *${name}* (${lead.intent || "High Interest"})${lead.dealValue && recipient.role === "OWNER" ? ` — ₹${lead.dealValue.toLocaleString("en-IN")}` : ""}\n`;
    }
  }

  // 4. Invoices & Payments (Only for OWNER and ACCOUNTS)
  if (dueInvoices.length > 0 && recipient.role !== "SALES_MANAGER") {
    const totalPending = dueInvoices.reduce((sum, inv) => sum + (inv.total - inv.amountPaid), 0);
    card += `\n💰 *बकाया भुगतान (Collections to Follow):*\n`;
    card += `• कुल लंबित: ₹${totalPending.toLocaleString("en-IN")} (${dueInvoices.length} इनवॉइस)\n`;
  }

  // 5. Critical Business Emails
  if (importantEmails.length > 0) {
    card += `\n📬 *ज़रूरी ईमेल (Priority Emails):*\n`;
    for (const em of importantEmails) {
      const pIcon = em.priority === "URGENT" ? "🚨" : "⚡";
      card += `• ${pIcon} *${em.fromName || em.fromEmail}*: ${em.subject}\n`;
    }
  }

  card += `\n━━━━━━━━━━━━━━━━━━━━\n💪 *शुभ प्रभात, ${recipient.name || "Boss"}! आज का दिन सफल और उत्पादक रहे!*\n(कॉल रिपोर्ट के लिए *"today total call"* या *"आज के काम"* भेजें)`;

  await sendWhatsAppText({
    organizationId: orgId,
    channelId: channel.id,
    phone: recipient.phone,
    body: card,
    chatSource: "bot",
  });

  log.info({ channelId: channel.id, phone: recipient.phone, role: recipient.role }, "Sent morning briefing to commander");
}

/**
 * Builds and sends the 8:00 PM End-of-Day (EOD) Performance Report.
 */
export async function sendEodReport(
  channel: any,
  todayStr: string,
  recipient: { phone: string; name: string; role: string },
): Promise<void> {
  const orgId = channel.organizationId;
  const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);

  const [totalMessagesToday, leadsToday, completedTasksToday, callsToday, invoicesToday, pendingTasksRemaining] =
    await Promise.all([
      // Total WhatsApp messages received today
      prisma.chatMessage.count({
        where: {
          organizationId: orgId,
          direction: "IN",
          createdAt: { gte: startOfDay },
        },
      }),
      // Leads created or updated today
      prisma.chatConversation.count({
        where: {
          organizationId: orgId,
          leadStage: "HOT",
          updatedAt: { gte: startOfDay },
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
      // Calls today
      prisma.call.count({
        where: {
          organizationId: orgId,
          createdAt: { gte: startOfDay },
        },
      }),
      // Invoices/Quotations created today
      recipient.role !== "SALES_MANAGER"
        ? prisma.businessInvoice.findMany({
            where: {
              organizationId: orgId,
              createdAt: { gte: startOfDay },
            },
            select: { total: true, amountPaid: true },
          })
        : Promise.resolve([]),
      // Overdue / pending tasks remaining
      prisma.businessTask.count({
        where: {
          organizationId: orgId,
          status: { in: ["TODO", "IN_PROGRESS", "PENDING", "OVERDUE"] },
          dueAt: { lte: new Date() },
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

  let card = `🌙 *WaCall — End of Day Performance Report (शाम का सारांश)*\n📅 ${dateFormatted}\n━━━━━━━━━━━━━━━━━━━━\n📊 *आज दिन भर का बिजनेस स्कोरकार्ड:*\n\n`;

  card += `• 💬 *ग्राहक संदेश (Inbound Chats):* ${totalMessagesToday}\n`;
  if (recipient.role !== "ACCOUNTS") {
    card += `• 🔥 *Hot Leads सक्रिय:* ${leadsToday}\n`;
  }
  card += `• 📞 *Voice Calls किए गए:* ${callsToday}\n`;
  if (recipient.role !== "ACCOUNTS") {
    card += `• ✅ *टास्क पूरे किए गए:* ${completedTasksToday}\n`;
  }
  if (recipient.role !== "SALES_MANAGER") {
    card += `• 📄 *नए इनवॉइस/कोटेशन:* ${invoicesToday.length}${totalInvoiced > 0 ? ` (₹${totalInvoiced.toLocaleString("en-IN")})` : ""}\n`;
    card += `• 💰 *आज जमा भुगतान (Collected):* ₹${totalCollected.toLocaleString("en-IN")}\n`;
  }

  if (pendingTasksRemaining > 0) {
    card += `• ⏳ *लंबित टास्क (Pending Tasks):* ${pendingTasksRemaining} कार्य बाकी हैं।\n`;
    card += `━━━━━━━━━━━━━━━━━━━━\n💡 Reply *1* to shift all ${pendingTasksRemaining} pending tasks to tomorrow morning (9:00 AM).`;

    await prisma.pendingAction
      .create({
        data: {
          organizationId: orgId,
          channelId: channel.id,
          actionType: "EOD_TASK_SHIFT_ACTION",
          summary: `Shift ${pendingTasksRemaining} pending tasks to tomorrow morning`,
          status: "PENDING",
          payload: { count: pendingTasksRemaining },
          expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
        },
      })
      .catch(() => undefined);
  } else {
    card += `━━━━━━━━━━━━━━━━━━━━\n✨ *शानदार काम, ${recipient.name || "Boss"}! आज का पूरा रिकॉर्ड सुरक्षित है। Relax & Good Night!* 😴`;
  }

  await sendWhatsAppText({
    organizationId: orgId,
    channelId: channel.id,
    phone: recipient.phone,
    body: card,
    chatSource: "bot",
  });

  log.info({ channelId: channel.id, phone: recipient.phone, role: recipient.role }, "Sent EOD performance report to commander");
}
