import pino from "pino";
import { prisma } from "@wacalls/database";
import { fetchNewEmails, type ParsedEmailMessage } from "./imap-service.js";
import { analyzeEmailWithAi } from "./ai-intelligence.js";
import { sendWhatsAppText } from "../messaging.js";

const log = pino({ name: "email-poller", level: process.env.LOG_LEVEL ?? "info" });

let isSyncRunning = false;

/**
 * Runs every 60 seconds as a background ticker.
 * Polls active email accounts, applies 3-level filters, runs AI intelligence, and routes alerts to WhatsApp.
 */
export async function processEmailSyncTick(): Promise<void> {
  if (isSyncRunning) {
    return;
  }
  isSyncRunning = true;

  try {
    const accounts = await prisma.emailAccount.findMany({
      where: {
        syncEnabled: true,
        status: { not: "PAUSED" },
      },
      include: {
        channel: true,
        organization: true,
        rules: { where: { enabled: true } },
      },
    });

    if (accounts.length === 0) {
      return;
    }

    for (const account of accounts) {
      try {
        await syncSingleAccount(account);
      } catch (err: any) {
        log.warn({ err: err?.message, accountId: account.id, email: account.email }, "Sync error on email account");
        // Distinguish between hard auth errors vs transient socket timeouts
        const isAuthError =
          /auth|credential|login|invalid|unauthorized|denied|command failed/i.test(err?.message || "");
        
        await prisma.emailAccount
          .update({
            where: { id: account.id },
            data: {
              lastError: err?.message || "Sync failed",
              // Only flag ERROR state if authentication or command failed permanently; keep CONNECTED on temporary socket timeouts
              status: isAuthError ? "ERROR" : account.status,
            },
          })
          .catch(() => undefined);
      }
    }
  } catch (err: any) {
    log.error({ err: err?.message }, "Critical error in processEmailSyncTick");
  } finally {
    isSyncRunning = false;
  }
}

/**
 * Syncs a single email account and processes new incoming messages.
 */
export async function syncSingleAccount(account: any): Promise<{ fetched: number; notified: number }> {
  const newMessages = await fetchNewEmails(account);
  if (newMessages.length === 0) {
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: { lastSyncAt: new Date(), lastError: null, status: "CONNECTED" },
    });
    return { fetched: 0, notified: 0 };
  }

  let notifiedCount = 0;

  for (const raw of newMessages) {
    // 1. Deduplication check via Message-ID
    const existing = await prisma.emailMessage.findUnique({
      where: {
        organizationId_messageId: {
          organizationId: account.organizationId,
          messageId: raw.messageId,
        },
      },
    });

    if (existing) {
      continue;
    }

    // 2. 3-Level Filter Evaluation
    const senderAllowed = checkSenderFilter(raw.fromEmail, account.filterSenders, account.filterDomains);
    const keywordHit = checkKeywordFilter(raw.subject, raw.bodyText, account.filterKeywords);

    // Run AI analysis
    const ai = await analyzeEmailWithAi(account.organizationId, {
      fromName: raw.fromName,
      fromEmail: raw.fromEmail,
      subject: raw.subject,
      bodyText: raw.bodyText,
      date: raw.date,
      attachments: raw.attachments,
    });

    // Priority filter check
    const priorityAllowed = checkPriorityThreshold(ai.priority, account.minPriority, account.aiFilterEnabled);

    // Decide whether to dispatch notification
    const shouldNotify = (senderAllowed || keywordHit || !account.aiFilterEnabled) && priorityAllowed && ai.category !== "PROMOTIONAL";

    // 3. Persist Email Message to Database
    const saved = await prisma.emailMessage.create({
      data: {
        organizationId: account.organizationId,
        accountId: account.id,
        messageId: raw.messageId,
        fromName: raw.fromName,
        fromEmail: raw.fromEmail,
        toEmail: raw.toEmail,
        subject: raw.subject,
        bodyText: raw.bodyText,
        bodyHtml: raw.bodyHtml,
        date: raw.date,
        priority: ai.priority,
        category: ai.category,
        summary: ai.summary,
        actionRequired: ai.actionRequired,
        suggestedAction: ai.suggestedAction,
        detectedDeadline: ai.detectedDeadline,
        attachments: raw.attachments,
        whatsappSent: false,
        replyDraft: ai.replyDraft,
        replyStatus: ai.replyDraft ? "DRAFTED" : "NONE",
      },
    });

    // 4. Dispatch WhatsApp Alert if eligible
    if (shouldNotify) {
      const dispatched = await dispatchWhatsAppEmailAlert(account, saved, ai);
      if (dispatched) {
        notifiedCount++;
        await prisma.emailMessage.update({
          where: { id: saved.id },
          data: { whatsappSent: true, notifiedAt: new Date() },
        });
      }
    }
  }

  await prisma.emailAccount.update({
    where: { id: account.id },
    data: {
      lastSyncAt: new Date(),
      lastError: null,
      status: "CONNECTED",
    },
  });

  return { fetched: newMessages.length, notified: notifiedCount };
}

/**
 * Checks if sender email or domain is allowed.
 */
function checkSenderFilter(fromEmail: string, allowedSenders: string[], allowedDomains: string[]): boolean {
  if (allowedSenders.length === 0 && allowedDomains.length === 0) {
    return true; // No restrictions configured
  }

  const normalized = fromEmail.toLowerCase().trim();
  if (allowedSenders.some((s) => s.toLowerCase().trim() === normalized)) {
    return true;
  }

  const domain = normalized.includes("@") ? `@${normalized.split("@")[1]}` : "";
  if (domain && allowedDomains.some((d) => d.toLowerCase().trim() === domain || `@${d.replace(/^@/, "").toLowerCase().trim()}` === domain)) {
    return true;
  }

  return false;
}

/**
 * Checks if subject or body contains any priority keywords.
 */
function checkKeywordFilter(subject: string, bodyText: string, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return false;
  const combined = `${subject} ${bodyText}`.toLowerCase();
  return keywords.some((kw) => kw && combined.includes(kw.toLowerCase().trim()));
}

/**
 * Checks priority against threshold.
 */
function checkPriorityThreshold(priority: string, threshold: string, aiFilterEnabled: boolean): boolean {
  if (!aiFilterEnabled || threshold === "ALL") return true;

  if (threshold === "URGENT") {
    return priority === "URGENT";
  }
  if (threshold === "IMPORTANT") {
    return priority === "URGENT" || priority === "IMPORTANT";
  }
  if (threshold === "NORMAL") {
    return priority === "URGENT" || priority === "IMPORTANT" || priority === "NORMAL";
  }
  return true;
}

/**
 * Dispatches a formatted WhatsApp Alert to the designated WhatsApp Commander line.
 */
async function dispatchWhatsAppEmailAlert(account: any, emailMsg: any, ai: any): Promise<boolean> {
  // Resolve channel
  const channelId = account.channelId || (await prisma.whatsAppChannel.findFirst({
    where: { organizationId: account.organizationId, status: "CONNECTED" },
  }))?.id;

  if (!channelId) {
    log.warn({ accountId: account.id }, "No connected WhatsApp channel found for email alert");
    return false;
  }

  const channel = await prisma.whatsAppChannel.findUnique({
    where: { id: channelId },
  });
  if (!channel) return false;

  // Resolve target phone
  let targetPhone = account.targetPhone;
  if (!targetPhone) {
    // Check if category matches specific commander role (e.g. INVOICE -> ACCOUNTS)
    if (ai.category === "INVOICE" || ai.category === "PAYMENT") {
      const accountsCmd = await prisma.commanderMember.findFirst({
        where: { channelId: channel.id, role: "ACCOUNTS", enabled: true },
      });
      if (accountsCmd?.phone) {
        targetPhone = accountsCmd.phone;
      }
    } else if (ai.category === "CLIENT_INQUIRY" || ai.category === "MEETING") {
      const salesCmd = await prisma.commanderMember.findFirst({
        where: { channelId: channel.id, role: "SALES_MANAGER", enabled: true },
      });
      if (salesCmd?.phone) {
        targetPhone = salesCmd.phone;
      }
    }
  }

  // Fallback to Owner Phone
  if (!targetPhone) {
    targetPhone = channel.ownerPhone;
  }

  if (!targetPhone) {
    log.warn({ channelId: channel.id }, "No commander or owner phone configured for WhatsApp alert");
    return false;
  }

  // Build emoji and priority header
  const priorityBadge =
    emailMsg.priority === "URGENT"
      ? "🚨 *URGENT EMAIL RECEIVED*"
      : emailMsg.priority === "IMPORTANT"
      ? "⚡ *IMPORTANT EMAIL RECEIVED*"
      : "📧 *NEW BUSINESS EMAIL*";

  const categoryIcon =
    emailMsg.category === "PAYMENT"
      ? "💰 Payment"
      : emailMsg.category === "INVOICE"
      ? "📄 Invoice"
      : emailMsg.category === "MEETING"
      ? "📅 Meeting Request"
      : emailMsg.category === "TASK"
      ? "📌 Action Item"
      : "✉️ Message";

  const deadlineStr = emailMsg.detectedDeadline
    ? `\n⏰ *Deadline / Date:* ${new Date(emailMsg.detectedDeadline).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
    : "";

  const actionStr = emailMsg.suggestedAction ? `\n⚠️ *Action Required:* ${emailMsg.suggestedAction}` : "";

  const senderDisplay = emailMsg.fromName
    ? `${emailMsg.fromName} (${emailMsg.fromEmail})`
    : emailMsg.fromEmail;

  const accountTag = account.label ? ` [${account.label}]` : "";

  // Interactive Quick Action instructions
  const optionsText = emailMsg.replyDraft
    ? `\n━━━━━━━━━━━━━━━━━━━━\nReply to this message:\n*1* → Send AI Draft Reply\n*2* → Create Task in WaCall\n*3* → Show Full Email Content`
    : `\n━━━━━━━━━━━━━━━━━━━━\nReply to this message:\n*2* → Create Task in WaCall\n*3* → Show Full Email Content`;

  const body = `${priorityBadge}${accountTag}
━━━━━━━━━━━━━━━━━━━━
*From:* ${senderDisplay}
*Subject:* ${emailMsg.subject}
*Category:* ${categoryIcon}

🤖 *AI Summary:*
${emailMsg.summary}
${actionStr}${deadlineStr}
${optionsText}`;

  try {
    // Register PendingAction for WhatsApp Commander approval loop
    await prisma.pendingAction.create({
      data: {
        organizationId: account.organizationId,
        channelId: channel.id,
        actionType: "EMAIL_COMMAND_ACTION",
        summary: `Email action for: ${emailMsg.subject}`,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h validity
        payload: {
          emailMessageId: emailMsg.id,
          accountId: account.id,
          fromEmail: emailMsg.fromEmail,
          fromName: emailMsg.fromName,
          subject: emailMsg.subject,
          replyDraft: emailMsg.replyDraft,
          suggestedAction: emailMsg.suggestedAction,
          detectedDeadline: emailMsg.detectedDeadline,
        },
      },
    });

    await sendWhatsAppText({
      organizationId: account.organizationId,
      channelId: channel.id,
      phone: targetPhone,
      body,
      chatSource: "bot",
    });

    log.info({ emailId: emailMsg.id, phone: targetPhone }, "Dispatched WhatsApp email alert to commander");
    return true;
  } catch (err: any) {
    log.error({ err: err?.message, emailId: emailMsg.id }, "Failed to send WhatsApp email alert");
    return false;
  }
}
