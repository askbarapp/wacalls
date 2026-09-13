import pino from "pino";
import { prisma } from "@wacalls/database";
import { normalizePhone } from "@wacalls/shared";
import {
  SarvamClient,
  createVoiceAiClient,
  defaultModelForProvider,
  normalizeVoiceProvider,
} from "@wacalls/audio-engine";
import { sendWhatsAppText } from "./messaging.js";
import { resolveVoiceApiKey, resolveSarvamApiKey } from "./sarvam-key.js";
import { broadcast } from "../ws.js";
import {
  createInvoiceOrQuote,
  sendInvoiceToClient,
  getPendingPaymentsSummary,
  markInvoicePayment,
} from "./invoice-service.js";
import {
  createCreativeRequest,
  smartEditCreativeRequest,
  finalizeCreativeAsset,
} from "./creative/creative-service.js";

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

  // D. Quotation / Invoice Request Command (e.g. "Send quotation to Rahul 9876543210 for 25000 Website", "कोटेशन भेजो अमित को 15000")
  if (
    (upperText.includes("QUOTATION") || upperText.includes("QUOTE") || upperText.includes("INVOICE") || upperText.includes("कोटेशन") || upperText.includes("बिल")) &&
    (upperText.includes("SEND") || upperText.includes("BHEJO") || upperText.includes("CREATE") || upperText.includes("BANAO") || upperText.includes("FOR") || upperText.includes("KO") || upperText.includes("FOR"))
  ) {
    const quoteProposal = await parseQuotationCommand(channel.organizationId, text);
    if (quoteProposal) {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await prisma.pendingAction.create({
        data: {
          organizationId: channel.organizationId,
          channelId: channel.id,
          actionType: quoteProposal.isInvoice ? "SEND_INVOICE" : "SEND_QUOTATION",
          summary: quoteProposal.summary,
          payload: quoteProposal.payload as any,
          status: "PENDING",
          expiresAt,
        },
      });

      await sendWhatsAppText({
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone: input.phone,
        body: quoteProposal.confirmationCard,
        chatSource: "bot",
      }).catch(() => undefined);
      return true;
    }
  }

  // E. Pending Payments / बकाया भुगतान Command
  if (
    upperText.includes("PAYMENT") ||
    upperText.includes("BAKAYA") ||
    upperText.includes("बकाया") ||
    upperText.includes("UNPAID") ||
    upperText.includes("DUE")
  ) {
    const summary = await getPendingPaymentsSummary(channel.organizationId);
    let card = `💰 *WaCall — Outstanding Payments (बकाया भुगतान)*\n━━━━━━━━━━━━━━━━━━━━\n`;
    if (summary.totalCount === 0) {
      card += `🎉 बहुत बढ़िया! कोई भी पेंडिंग या बकाया पेमेंट नहीं है। सभी इनवॉइस चुकता हैं।`;
    } else {
      card += `*कुल बकाया:* ₹${summary.totalOutstanding.toLocaleString("en-IN")} (${summary.totalCount} इनवॉइस)\n`;
      if (summary.overdueCount > 0) {
        card += `⚠️ *अतिदेय (Overdue):* ₹${summary.overdueAmount.toLocaleString("en-IN")} (${summary.overdueCount} इनवॉइस)\n`;
      }
      card += `\n*लंबित सूचि:*\n`;
      summary.invoices.slice(0, 5).forEach((inv, i) => {
        const dueStr = inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-IN") : "No due date";
        card += `${i + 1}. *${inv.clientName}*: ₹${(inv.total - inv.amountPaid).toLocaleString("en-IN")} (Due: ${dueStr})\n`;
      });
      if (summary.invoices.length > 5) {
        card += `...और ${summary.invoices.length - 5} अन्य इनवॉइस।\n`;
      }
    }
    card += `━━━━━━━━━━━━━━━━━━━━\n💡 आप किसी इनवॉइस को चुकता करने के लिए *"Mark paid [Client] [Amount]"* लिख सकते हैं।`;

    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: input.phone,
      body: card,
      chatSource: "bot",
    }).catch(() => undefined);
    return true;
  }

  // F. Mark Paid Command (e.g. "Mark paid Rahul 25000", "पेमेंट मिल गया राहुल 25000")
  if (
    upperText.startsWith("MARK PAID") ||
    upperText.startsWith("PAID ") ||
    upperText.includes("PAYMENT MIL GAYA") ||
    upperText.includes("PAID HO GAYA")
  ) {
    const target = text.replace(/^(mark paid|paid|payment mil gaya|paid ho gaya)\s+/i, "").trim();
    const markCard = await handleMarkPaidCommand(channel.organizationId, target);
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: input.phone,
      body: markCard,
      chatSource: "bot",
    }).catch(() => undefined);
    return true;
  }

  // G. "Teach WaCall" Custom Rule Command
  if (
    upperText.startsWith("TEACH") ||
    upperText.startsWith("RULE") ||
    upperText.startsWith("SIKHO") ||
    upperText.includes("JAB BHI KOI") ||
    upperText.includes("जब भी कोई") ||
    upperText.includes("AGAR KOI") ||
    upperText.includes("अगर कोई") ||
    upperText.includes("KOI POOCHE") ||
    upperText.includes("कोई पूछे") ||
    upperText.includes("AUTO REPLY")
  ) {
    const rule = await parseTeachRule(channel.organizationId, text);
    if (rule) {
      const bot = await prisma.chatBot.upsert({
        where: { channelId: channel.id },
        create: {
          organizationId: channel.organizationId,
          channelId: channel.id,
          enabled: true,
        },
        update: {},
      });

      await prisma.chatKeyword.upsert({
        where: {
          chatBotId_trigger_matchType: {
            chatBotId: bot.id,
            trigger: rule.trigger,
            matchType: rule.matchType,
          },
        },
        create: {
          organizationId: channel.organizationId,
          chatBotId: bot.id,
          trigger: rule.trigger,
          matchType: rule.matchType,
          reply: rule.reply,
          action: "reply",
          enabled: true,
        },
        update: {
          reply: rule.reply,
          enabled: true,
        },
      });

      const card = `🎓 *WaCall Assistant — Rule Learned & Active!*
━━━━━━━━━━━━━━━━━━━━
🔍 *Trigger:* "${rule.trigger}" (${rule.matchType})
💬 *Auto-Reply:* "${rule.reply}"
⚡ *Status:* Active ✅
━━━━━━━━━━━━━━━━━━━━
अब जब भी कोई ग्राहक WhatsApp पर यह पूछेगा, WaCall अपने आप यह जवाब दे देगा!`;

      await sendWhatsAppText({
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone: input.phone,
        body: card,
        chatSource: "bot",
      }).catch(() => undefined);
      return true;
    }
  }

  // H. "Final" / Lock Creative Command
  if (
    upperText === "FINAL" ||
    upperText === "FINAL KAR DO" ||
    upperText === "FINAL HAI" ||
    upperText === "LOCK KARO" ||
    upperText === "LOCK" ||
    upperText === "APPROVE" ||
    upperText === "APPROVED" ||
    upperText === "YE SAHI HAI" ||
    upperText === "YE THEEK HAI"
  ) {
    const latestAsset = await prisma.creativeAsset.findFirst({
      where: {
        organizationId: channel.organizationId,
        ...(channel.id ? { channelId: channel.id } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    if (latestAsset && latestAsset.status !== "FINAL") {
      await finalizeCreativeAsset(latestAsset.id);
      await sendWhatsAppText({
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone: input.phone,
        body: `🔒 *WaCall Creative Studio — Poster Finalized!*
━━━━━━━━━━━━━━━━━━━━
✨ *${latestAsset.title}*

आपकी creative को *Final Locked* कर दिया गया है ✅
अब यह सुरक्षित है। आप इसे:
• WhatsApp Status पर लगा सकते हैं
• WhatsApp Broadcast campaign में ग्राहकों को भेज सकते हैं!`,
        chatSource: "bot",
      }).catch(() => undefined);
      return true;
    }
  }

  // I. Creative Smart Edit / Revision Command (e.g. "Logo chhota karo", "Background blue karo", "Ek aur banao")
  const isEditIntent =
    upperText.includes("LOGO CHHOTA") ||
    upperText.includes("LOGO BADA") ||
    upperText.includes("LOGO HATA") ||
    upperText.includes("BACKGROUND") ||
    upperText.includes("EK AUR BANAO") ||
    upperText.includes("ANOTHER OPTION") ||
    upperText.includes("REVISION") ||
    upperText.startsWith("EDIT ") ||
    upperText.startsWith("UPDATE ") ||
    upperText.includes("POSTER ME") ||
    upperText.includes("CREATIVE ME");

  if (isEditIntent) {
    const recentAsset = await prisma.creativeAsset.findFirst({
      where: {
        organizationId: channel.organizationId,
        ...(channel.id ? { channelId: channel.id } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });

    if (recentAsset) {
      await sendWhatsAppText({
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone: input.phone,
        body: `🎨 *WaCall Creative Studio — Revision in Progress!*\n━━━━━━━━━━━━━━━━━━━━\nWaCall आपके निर्देश के अनुसार poster को update कर रहा है:\n✏️ *"${text}"*\n\n⏳ नया version तैयार होते ही 1-2 मिनट में यहीं भेजा जाएगा।`,
        chatSource: "bot",
      }).catch(() => undefined);

      try {
        await smartEditCreativeRequest({
          organizationId: channel.organizationId,
          assetId: recentAsset.id,
          channelId: channel.id,
          editInstruction: text,
          notifyPhone: input.phone,
        });
      } catch (editErr: any) {
        log.error({ err: editErr?.message }, "Failed to initiate creative smart edit");
        await sendWhatsAppText({
          organizationId: channel.organizationId,
          channelId: channel.id,
          phone: input.phone,
          body: `⚠️ ${editErr?.message || "Creative edit शुरू नहीं हो सकी।"}`,
          chatSource: "bot",
        }).catch(() => undefined);
      }
      return true;
    }
  }

  // J. Creative Studio Generation (e.g. "Diwali ka poster bana do", "Banner bana do", "Poster banao")
  const isCreateIntent =
    upperText.includes("POSTER BANA") ||
    upperText.includes("POSTER CHAHIYE") ||
    upperText.includes("BANNER BANA") ||
    upperText.includes("BANNER CHAHIYE") ||
    upperText.includes("CREATIVE BANA") ||
    upperText.includes("CREATIVE CHAHIYE") ||
    upperText.includes("CREATE POSTER") ||
    upperText.includes("GENERATE POSTER") ||
    upperText.includes("MAKE A POSTER") ||
    upperText.includes("POSTER DESIGN");

  if (isCreateIntent) {
    const festivalKeywords = [
      "DIWALI", "DEEPAVALI", "HOLI", "EID", "INDEPENDENCE DAY", "REPUBLIC DAY",
      "NAVRATRI", "DURGA PUJA", "DUSSEHRA", "RAKSHA BANDHAN", "JANMASHTAMI",
      "GANESH CHATURTHI", "NEW YEAR", "CHRISTMAS", "MAHA SHIVRATRI", "MAHAVIR JAYANTI"
    ];
    let detectedFestival: string | undefined;
    for (const fest of festivalKeywords) {
      if (upperText.includes(fest)) {
        detectedFestival = fest.charAt(0) + fest.slice(1).toLowerCase();
        break;
      }
    }

    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: input.phone,
      body: `🎨 *WaCall Creative Studio — Poster Design Started!*\n━━━━━━━━━━━━━━━━━━━━\n${
        detectedFestival ? `🎉 *Festival:* ${detectedFestival}\n` : ""
      }📝 *Requirement:* "${text}"\n\nWaCall आपकी business branding के अनुसार AI poster तैयार कर रहा है।\n⏳ 1-2 मिनट में creative तैयार होकर यहीं आ जाएगी!`,
      chatSource: "bot",
    }).catch(() => undefined);

    try {
      await createCreativeRequest({
        organizationId: channel.organizationId,
        channelId: channel.id,
        userInstruction: text,
        festivalName: detectedFestival,
        creativeType: upperText.includes("BANNER") ? "banner" : "poster",
        aspect: "1:1",
        notifyPhone: input.phone,
      });
    } catch (genErr: any) {
      log.error({ err: genErr?.message }, "Failed to initiate creative generation");
      await sendWhatsAppText({
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone: input.phone,
        body: `⚠️ ${genErr?.message || "Creative generation शुरू नहीं हो सकी।"}`,
        chatSource: "bot",
      }).catch(() => undefined);
    }
    return true;
  }

  // Default Assistant Response to Owner
  await sendWhatsAppText({
    organizationId: channel.organizationId,
    channelId: channel.id,
    phone: input.phone,
    body: `👋 *WaCall Assistant Active*\n\nआप मुझसे WhatsApp पर सीधे पूछ सकते हैं:\n• *"आज के सारे काम बताओ"*\n• *"Hot leads निकालो"*\n• *"Diwali ka poster bana do"* (AI Creative Studio)\n• *"Logo छोटा करो" / "Final"* (Creative Edit/Lock)\n• *"Send quotation to [Name] for ₹[Amount]"*\n• *"Pending payments बताओ"*\n• *"Call [Name/Number]"*\n• *"जब भी कोई पूछे [प्रश्न], तो बोलो [उत्तर]"* (Rule सिखाएं)\n• या किसी भी ग्राहक का मैसेज/विजिटिंग कार्ड मुझे *Forward* कर दीजिए!`,
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

  if (action.actionType === "SEND_QUOTATION" || action.actionType === "SEND_INVOICE") {
    const isInvoice = action.actionType === "SEND_INVOICE";
    const clientName = payload.clientName || payload.contactName || "Client";
    const clientPhone = payload.clientPhone || payload.phone;
    const amount = payload.amount ? parseFloat(String(payload.amount)) : 0;
    const itemDesc = payload.item || payload.itemOrProduct || (isInvoice ? "Invoice Services" : "Quotation Services");

    if (clientPhone && amount > 0) {
      const inv = await createInvoiceOrQuote({
        organizationId: channel.organizationId,
        channelId: channel.id,
        clientName,
        clientPhone,
        kind: isInvoice ? "INVOICE" : "QUOTATION",
        items: [{ description: itemDesc, quantity: 1, unitPrice: amount, amount }],
        total: amount,
        subtotal: amount,
        notes: payload.notes || "Generated via WaCall OS",
        dueDate: payload.dueDate ? new Date(payload.dueDate) : new Date(Date.now() + 7 * 24 * 3600 * 1000),
        autoEnrollFollowUp: true,
      });

      const sendRes = await sendInvoiceToClient(inv.id);

      await sendWhatsAppText({
        organizationId: channel.organizationId,
        channelId: channel.id,
        phone: channel.ownerPhone || channel.phoneNumber,
        body: `✅ *${isInvoice ? "Invoice" : "Quotation"} Generated & Sent!*\n\n• *Client*: ${clientName} (${clientPhone})\n• *Doc Number*: #${inv.invoiceNumber}\n• *Amount*: ₹${amount.toLocaleString("en-IN")}\n• *PDF Link*: ${sendRes.pdfUrl}\n\n🔄 *Follow-up Cadence Active*: Client will be automatically followed up in +4h, +24h, and +3d (AI Voice Call) if no reply.`,
        chatSource: "bot",
      }).catch(() => undefined);
      return;
    }
  }

  if (action.actionType === "SAVE_CONTACT") {
    const phone = payload.phone ? normalizePhone(payload.phone) : null;
    const cleanPhone = phone && phone.ok ? phone.e164 : payload.phone;

    let contact: any = null;
    if (cleanPhone) {
      contact = await prisma.contact.upsert({
        where: {
          organizationId_phone: {
            organizationId: channel.organizationId,
            phone: cleanPhone,
          },
        },
        create: {
          organizationId: channel.organizationId,
          phone: cleanPhone,
          name: payload.name || "Contact",
          email: payload.email || undefined,
        },
        update: {
          name: payload.name || undefined,
          email: payload.email || undefined,
        },
      });

      await prisma.chatConversation.upsert({
        where: {
          organizationId_channelId_phone: {
            organizationId: channel.organizationId,
            channelId: channel.id,
            phone: cleanPhone,
          },
        },
        create: {
          organizationId: channel.organizationId,
          channelId: channel.id,
          contactId: contact.id,
          phone: cleanPhone,
          leadStage: "WARM",
          workCategory: "LEAD",
          summary: `Visiting Card: ${payload.name} (${payload.company || ""} - ${payload.designation || ""})`,
        },
        update: {
          contactId: contact.id,
          leadStage: "WARM",
          summary: `Visiting Card: ${payload.name} (${payload.company || ""} - ${payload.designation || ""})`,
        },
      });
    }

    await prisma.businessTask.create({
      data: {
        organizationId: channel.organizationId,
        channelId: channel.id,
        title: `Follow up with ${payload.name || "Lead"} (${payload.company || "New Contact"})`,
        description: `Role: ${payload.designation || "N/A"}\nEmail: ${payload.email || "N/A"}\nAddress: ${payload.address || "N/A"}`,
        contactName: payload.name,
        contactPhone: cleanPhone,
        dueAt: new Date(Date.now() + 24 * 3600 * 1000),
        priority: "HIGH",
        status: "PENDING",
        source: "visiting_card_ocr",
      },
    });

    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: channel.ownerPhone || channel.phoneNumber,
      body: `✅ *Contact & Lead Saved Successfully!*\n\n👤 *Name:* ${payload.name}\n📞 *Phone:* ${cleanPhone || "N/A"}\n🏢 *Company:* ${payload.company || "N/A"}\n💼 *Role:* ${payload.designation || "N/A"}\n\n📋 *Follow-up task created in Work Inbox for tomorrow!*`,
      chatSource: "bot",
    }).catch(() => undefined);
    return;
  }

  if (action.actionType === "RECORD_EXPENSE") {
    await prisma.businessTask.create({
      data: {
        organizationId: channel.organizationId,
        channelId: channel.id,
        title: `Payment/Bill: ₹${payload.amount} to ${payload.vendorName || "Vendor"}`,
        description: `Items: ${payload.items || "Expense"}\nDue Date: ${payload.dueDate || "N/A"}`,
        amount: payload.amount ? parseFloat(String(payload.amount)) : undefined,
        dueAt: payload.dueDate ? new Date(payload.dueDate) : new Date(Date.now() + 48 * 3600 * 1000),
        priority: "MEDIUM",
        status: "PENDING",
        source: "bill_ocr",
      },
    });

    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: channel.ownerPhone || channel.phoneNumber,
      body: `✅ *Bill / Expense Recorded!*\n\n🏢 *Vendor:* ${payload.vendorName || "Vendor"}\n💰 *Amount:* ₹${Number(payload.amount || 0).toLocaleString("en-IN")}\n📋 *Details:* ${payload.items || "Purchase"}\n\nTask added to your Work Inbox.`,
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

/**
 * Parses quotation or invoice creation requests from the Business Owner.
 */
async function parseQuotationCommand(
  organizationId: string,
  rawText: string,
): Promise<{
  isInvoice: boolean;
  summary: string;
  payload: Record<string, any>;
  confirmationCard: string;
} | null> {
  try {
    const { apiKey } = await resolveVoiceApiKey(organizationId, "sarvam");
    const client = createVoiceAiClient("sarvam", apiKey);

    const prompt = `A business owner wants to create and send a Quotation or Invoice to a client via WhatsApp.
Extract the details from this text:
- clientName: string (person or company name)
- clientPhone: string (phone number or null)
- item: string (service or product description)
- amount: number (total price in INR, digits only)
- isInvoice: boolean (true if bill/invoice requested, false if quote/quotation)
- dueDate: string or null (e.g. "2026-09-20")

Input text:
"${rawText}"

Output STRICTLY valid JSON:
{
  "clientName": string,
  "clientPhone": string | null,
  "item": string,
  "amount": number,
  "isInvoice": boolean,
  "dueDate": string | null
}`;

    const res = await client.chat(
      [
        { role: "system", content: "You are a precise JSON extractor. Output ONLY JSON." },
        { role: "user", content: prompt },
      ],
      { temperature: 0.1, maxTokens: 300 },
    );

    const data = JSON.parse(res.replace(/```json/gi, "").replace(/```/g, "").trim());
    if (!data.amount) return null;

    const docType = data.isInvoice ? "Invoice" : "Quotation";
    const confirmationCard = `📄 *${docType} Proposal Detected*\n━━━━━━━━━━━━━━━━━━━━\n• *Client*: ${data.clientName || "Client"} (${data.clientPhone || "Phone provided"})\n• *Item*: ${data.item || "Commercial Service"}\n• *Amount*: ₹${Number(data.amount).toLocaleString("en-IN")}\n\n*क्या मैं PDF बनाकर ग्राहक को WhatsApp कर दूँ और Follow-up Drip शुरू करूँ?*\n👉 पुष्टि के लिए *'YES'* लिखें या रद्द करने के लिए *'NO'* लिखें।`;

    return {
      isInvoice: Boolean(data.isInvoice),
      summary: `${docType} for ${data.clientName || "Client"} - Rs. ${data.amount}`,
      payload: data,
      confirmationCard,
    };
  } catch (err) {
    log.warn({ err }, "parseQuotationCommand failed");
    return null;
  }
}

/**
 * Handles marking an invoice as paid from owner WhatsApp.
 */
async function handleMarkPaidCommand(organizationId: string, target: string): Promise<string> {
  const amountMatch = target.match(/\b\d+(\.\d+)?\b/);
  const amount = amountMatch ? parseFloat(amountMatch[0]) : null;
  const nameQuery = target.replace(/\b\d+(\.\d+)?\b/g, "").replace(/rs\.?|inr|rupees/gi, "").trim();

  const invoice = await prisma.businessInvoice.findFirst({
    where: {
      organizationId,
      status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
      OR: [
        { clientName: { contains: nameQuery, mode: "insensitive" } },
        { clientPhone: { contains: nameQuery } },
        { invoiceNumber: { contains: nameQuery, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  if (!invoice) {
    return `❓ मुझे "${nameQuery || target}" के नाम पर कोई खुला इनवॉइस नहीं मिला। कृपया इनवॉइस नंबर या सही ग्राहक नाम लिखें।`;
  }

  const payAmount = amount ?? (invoice.total - invoice.amountPaid);
  const updated = await markInvoicePayment(invoice.id, payAmount);

  return `✅ *भुगतान दर्ज कर लिया गया!*\n━━━━━━━━━━━━━━━━━━━━\n• *Invoice*: #${invoice.invoiceNumber}\n• *ग्राहक*: ${invoice.clientName}\n• *जमा राशि*: ₹${payAmount.toLocaleString("en-IN")}\n• *वर्तमान स्थिति*: ${updated.status === "PAID" ? "✅ चुकता (PAID)" : `⏳ शेष राशि: ₹${(updated.total - updated.amountPaid).toLocaleString("en-IN")}`}\n━━━━━━━━━━━━━━━━━━━━`;
}

/**
 * Parses a "Teach WaCall" natural language rule using regex or LLM.
 */
async function parseTeachRule(
  organizationId: string,
  rawText: string,
): Promise<{ trigger: string; matchType: string; reply: string } | null> {
  const text = rawText.trim();

  // Pattern 1: Rule: trigger -> reply or Rule: trigger = reply
  const arrowMatch = /^(?:rule|teach|sikho|auto\s*reply)[:\s]+(.+?)\s*(?:->|=|:)\s*(.+)$/i.exec(text);
  if (arrowMatch && arrowMatch[1] && arrowMatch[2]) {
    return {
      trigger: arrowMatch[1].trim(),
      matchType: "contains",
      reply: arrowMatch[2].trim(),
    };
  }

  // Pattern 2: "जब भी कोई पूछे [trigger], तो बोलो [reply]" or "अगर कोई [trigger] पूछे तो [reply]"
  const hindiMatch = /(?:जब भी कोई|अगर कोई|jab bhi koi|agar koi)\s*(?:पूछे|pooche)?\s*['"“]?(.+?)['"”]?\s*(?:पूछे|pooche)?\s*(?:तो बोलो|तो जवाब दो|तो बोलना|to bolo|to bolna|to bol dena|reply kar do)[:\s]*['"“]?(.+?)['"”]?$/i.exec(text);
  if (hindiMatch && hindiMatch[1] && hindiMatch[2]) {
    return {
      trigger: hindiMatch[1].trim(),
      matchType: "contains",
      reply: hindiMatch[2].trim(),
    };
  }

  // LLM fallback for nuanced spoken phrasings
  try {
    const key = await resolveSarvamApiKey(organizationId).catch(() => "");
    if (!key) return null;
    const client = new SarvamClient(key);
    const prompt = `Extract the chatbot trigger keyword and reply from this business owner instruction:
Instruction: "${text.slice(0, 300)}"

Return ONLY valid JSON:
{
  "trigger": "Exact question or keyword phrase",
  "matchType": "contains",
  "reply": "The response message to be sent to the customer"
}`;

    const res = await client.chat(
      [
        { role: "system", content: "You are a precise JSON extractor. Output ONLY JSON." },
        { role: "user", content: prompt },
      ],
      { temperature: 0.1, maxTokens: 250 },
    );
    const cleaned = res.replace(/```json/gi, "").replace(/```/g, "").trim();
    const data = JSON.parse(cleaned);
    if (data.trigger && data.reply) {
      return {
        trigger: data.trigger.trim(),
        matchType: data.matchType || "contains",
        reply: data.reply.trim(),
      };
    }
  } catch {
    /* ignore */
  }

  return null;
}


