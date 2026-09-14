import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { encryptCredential, decryptCredential, maskPassword } from "../services/email/crypto.js";
import { testImapConnection } from "../services/email/imap-service.js";
import { testSmtpConnection, sendOutgoingEmail } from "../services/email/smtp-service.js";
import { syncSingleAccount } from "../services/email/email-poller.js";

function sanitizeEmailUsername(input?: string | null, fallbackEmail?: string | null): string {
  let cleaned = (input || fallbackEmail || "").trim();
  if (fallbackEmail && fallbackEmail.includes("@")) {
    const double = `${fallbackEmail}${fallbackEmail}`;
    if (cleaned.toLowerCase() === double.toLowerCase()) {
      cleaned = fallbackEmail;
    }
  }
  const match = cleaned.match(/^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\1$/i);
  if (match && match[1]) {
    cleaned = match[1];
  }
  return cleaned;
}

export const emailRoutes: FastifyPluginAsync = async (app) => {
  // 1. Stats Bar
  app.get("/email/stats", async (req) => {
    const auth = await app.authenticate(req);
    const orgId = auth.orgId;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [accountsCount, emailsToday, urgentToday, actionRequiredToday] = await Promise.all([
      prisma.emailAccount.count({ where: { organizationId: orgId } }),
      prisma.emailMessage.count({ where: { organizationId: orgId, date: { gte: startOfDay } } }),
      prisma.emailMessage.count({ where: { organizationId: orgId, date: { gte: startOfDay }, priority: "URGENT" } }),
      prisma.emailMessage.count({
        where: { organizationId: orgId, date: { gte: startOfDay }, actionRequired: true },
      }),
    ]);

    return {
      success: true,
      data: {
        accountsCount,
        emailsToday,
        urgentToday,
        actionRequiredToday,
      },
    };
  });

  // 2. List Accounts
  app.get("/email/accounts", async (req) => {
    const auth = await app.authenticate(req);
    const orgId = auth.orgId;
    const accounts = await prisma.emailAccount.findMany({
      where: { organizationId: orgId },
      include: { channel: { select: { id: true, displayName: true, ownerPhone: true } } },
      orderBy: { createdAt: "desc" },
    });

    const sanitized = accounts.map((acc) => ({
      ...acc,
      imapPassword: maskPassword(acc.imapPasswordEncrypted),
      smtpPassword: maskPassword(acc.smtpPasswordEncrypted),
      imapPasswordEncrypted: undefined,
      smtpPasswordEncrypted: undefined,
    }));

    return { success: true, data: sanitized };
  });

  // 3. Test IMAP Connection Handshake
  app.post("/email/accounts/test-imap", async (req, reply) => {
    const auth = await app.authenticate(req);
    const bodySchema = z.object({
      accountId: z.string().optional(),
      host: z.string().min(1),
      port: z.number().int().positive().default(993),
      secure: z.boolean().default(true),
      user: z.string().min(1),
      password: z.string().optional(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0]?.message || "Invalid payload" });
    }

    let pass = (parsed.data.password || "").trim();
    if ((!pass || pass.includes("••••")) && parsed.data.accountId) {
      const existing = await prisma.emailAccount.findFirst({
        where: { id: parsed.data.accountId, organizationId: auth.orgId },
      });
      if (existing?.imapPasswordEncrypted) {
        pass = decryptCredential(existing.imapPasswordEncrypted) || "";
      }
    }

    if (!pass) {
      return reply.code(400).send({ success: false, message: "Password / App Password is required to test connection." });
    }

    const cleanUser = sanitizeEmailUsername(parsed.data.user);
    const res = await testImapConnection({
      host: parsed.data.host,
      port: parsed.data.port,
      secure: parsed.data.secure,
      user: cleanUser,
      password: pass,
    });
    return { success: res.success, message: res.message };
  });

  // 4. Test SMTP Connection Handshake
  app.post("/email/accounts/test-smtp", async (req, reply) => {
    const auth = await app.authenticate(req);
    const bodySchema = z.object({
      accountId: z.string().optional(),
      host: z.string().min(1),
      port: z.number().int().positive().default(465),
      secure: z.boolean().default(true),
      user: z.string().min(1),
      password: z.string().optional(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0]?.message || "Invalid payload" });
    }

    let pass = (parsed.data.password || "").trim();
    if ((!pass || pass.includes("••••")) && parsed.data.accountId) {
      const existing = await prisma.emailAccount.findFirst({
        where: { id: parsed.data.accountId, organizationId: auth.orgId },
      });
      if (existing?.smtpPasswordEncrypted) {
        pass = decryptCredential(existing.smtpPasswordEncrypted) || "";
      } else if (existing?.imapPasswordEncrypted) {
        pass = decryptCredential(existing.imapPasswordEncrypted) || "";
      }
    }

    if (!pass) {
      return reply.code(400).send({ success: false, message: "Password / App Password is required to test connection." });
    }

    const cleanUser = sanitizeEmailUsername(parsed.data.user);
    const res = await testSmtpConnection({
      host: parsed.data.host,
      port: parsed.data.port,
      secure: parsed.data.secure,
      user: cleanUser,
      password: pass,
    });
    return { success: res.success, message: res.message };
  });

  // 5. Create Email Account
  app.post("/email/accounts", async (req, reply) => {
    const auth = await app.authenticate(req);
    const schema = z.object({
      channelId: z.string().nullable().optional(),
      label: z.string().default("Primary Email"),
      email: z.string().email(),
      fromName: z.string().nullable().optional(),
      imapHost: z.string().min(1),
      imapPort: z.number().int().default(993),
      imapSecure: z.boolean().default(true),
      imapUser: z.string().min(1),
      imapPassword: z.string().min(1),
      smtpHost: z.string().nullable().optional(),
      smtpPort: z.number().int().default(465).nullable().optional(),
      smtpSecure: z.boolean().default(true),
      smtpUser: z.string().nullable().optional(),
      smtpPassword: z.string().nullable().optional(),
      syncEnabled: z.boolean().default(true),
      filterSenders: z.array(z.string()).default([]),
      filterDomains: z.array(z.string()).default([]),
      filterKeywords: z.array(z.string()).default([]),
      minPriority: z.enum(["URGENT", "IMPORTANT", "NORMAL", "ALL"]).default("IMPORTANT"),
      aiFilterEnabled: z.boolean().default(true),
      targetPhone: z.string().nullable().optional(),
      digestMode: z.enum(["INSTANT", "HOURLY", "DAILY_ONLY"]).default("INSTANT"),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0]?.message || "Invalid input" });
    }

    const b = parsed.data;
    const cleanImapUser = sanitizeEmailUsername(b.imapUser, b.email);
    const cleanSmtpUser = b.smtpUser ? sanitizeEmailUsername(b.smtpUser, b.email) : cleanImapUser;

    const imapPasswordEncrypted = encryptCredential(b.imapPassword.trim());
    const smtpPasswordEncrypted = b.smtpPassword && b.smtpPassword.trim() ? encryptCredential(b.smtpPassword.trim()) : null;

    const account = await prisma.emailAccount.create({
      data: {
        organizationId: auth.orgId,
        channelId: b.channelId || null,
        label: b.label.trim(),
        email: b.email.trim().toLowerCase(),
        fromName: b.fromName ? b.fromName.trim() : null,
        imapHost: b.imapHost.trim(),
        imapPort: b.imapPort,
        imapSecure: b.imapSecure,
        imapUser: cleanImapUser,
        imapPasswordEncrypted,
        smtpHost: b.smtpHost ? b.smtpHost.trim() : null,
        smtpPort: b.smtpPort || null,
        smtpSecure: b.smtpSecure,
        smtpUser: cleanSmtpUser,
        smtpPasswordEncrypted,
        syncEnabled: b.syncEnabled,
        filterSenders: b.filterSenders,
        filterDomains: b.filterDomains,
        filterKeywords: b.filterKeywords,
        minPriority: b.minPriority,
        aiFilterEnabled: b.aiFilterEnabled,
        targetPhone: b.targetPhone ? b.targetPhone.trim() : null,
        digestMode: b.digestMode,
        status: "CONNECTED",
      },
    });

    return {
      success: true,
      data: {
        ...account,
        imapPassword: maskPassword(account.imapPasswordEncrypted),
        smtpPassword: maskPassword(account.smtpPasswordEncrypted),
        imapPasswordEncrypted: undefined,
        smtpPasswordEncrypted: undefined,
      },
    };
  });

  // 6. Update Email Account
  app.put("/email/accounts/:id", async (req, reply) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const schema = z.object({
      channelId: z.string().nullable().optional(),
      label: z.string().optional(),
      email: z.string().email().optional(),
      fromName: z.string().nullable().optional(),
      imapHost: z.string().optional(),
      imapPort: z.number().int().optional(),
      imapSecure: z.boolean().optional(),
      imapUser: z.string().optional(),
      imapPassword: z.string().optional(),
      smtpHost: z.string().nullable().optional(),
      smtpPort: z.number().int().nullable().optional(),
      smtpSecure: z.boolean().optional(),
      smtpUser: z.string().nullable().optional(),
      smtpPassword: z.string().nullable().optional(),
      syncEnabled: z.boolean().optional(),
      filterSenders: z.array(z.string()).optional(),
      filterDomains: z.array(z.string()).optional(),
      filterKeywords: z.array(z.string()).optional(),
      minPriority: z.enum(["URGENT", "IMPORTANT", "NORMAL", "ALL"]).optional(),
      aiFilterEnabled: z.boolean().optional(),
      targetPhone: z.string().nullable().optional(),
      digestMode: z.enum(["INSTANT", "HOURLY", "DAILY_ONLY"]).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0]?.message || "Invalid input" });
    }

    const existing = await prisma.emailAccount.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!existing) {
      return reply.code(404).send({ success: false, error: "Email account not found" });
    }

    const b = parsed.data;
    const updateData: any = { ...b };
    delete updateData.imapPassword;
    delete updateData.smtpPassword;

    if (b.email) {
      updateData.email = b.email.trim().toLowerCase();
    }
    if (b.label) {
      updateData.label = b.label.trim();
    }
    if (b.imapHost) {
      updateData.imapHost = b.imapHost.trim();
    }
    if (b.imapUser !== undefined) {
      updateData.imapUser = sanitizeEmailUsername(b.imapUser, b.email || existing.email);
    }
    if (b.smtpHost !== undefined) {
      updateData.smtpHost = b.smtpHost ? b.smtpHost.trim() : null;
    }
    if (b.smtpUser !== undefined) {
      updateData.smtpUser = b.smtpUser ? sanitizeEmailUsername(b.smtpUser, b.email || existing.email) : null;
    }
    if (b.targetPhone !== undefined) {
      updateData.targetPhone = b.targetPhone ? b.targetPhone.trim() : null;
    }

    if (b.imapPassword && b.imapPassword.trim() && !b.imapPassword.includes("••••")) {
      updateData.imapPasswordEncrypted = encryptCredential(b.imapPassword.trim());
    }
    if (b.smtpPassword && b.smtpPassword.trim() && !b.smtpPassword.includes("••••")) {
      updateData.smtpPasswordEncrypted = encryptCredential(b.smtpPassword.trim());
    }

    // Always reset error and mark connected when settings are updated
    updateData.status = "CONNECTED";
    updateData.lastError = null;

    const updated = await prisma.emailAccount.update({
      where: { id },
      data: updateData,
    });

    return {
      success: true,
      data: {
        ...updated,
        imapPassword: maskPassword(updated.imapPasswordEncrypted),
        smtpPassword: maskPassword(updated.smtpPasswordEncrypted),
        imapPasswordEncrypted: undefined,
        smtpPasswordEncrypted: undefined,
      },
    };
  });

  // 7. Delete Email Account
  app.delete("/email/accounts/:id", async (req, reply) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.emailAccount.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!existing) {
      return reply.code(404).send({ success: false, error: "Email account not found" });
    }

    await prisma.emailAccount.delete({ where: { id } });
    return { success: true, message: "Account deleted successfully." };
  });

  // 8. Manual Sync Trigger
  app.post("/email/accounts/:id/sync", async (req, reply) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const account = await prisma.emailAccount.findFirst({
      where: { id, organizationId: auth.orgId },
      include: { channel: true, rules: { where: { enabled: true } } },
    });
    if (!account) {
      return reply.code(404).send({ success: false, error: "Email account not found" });
    }

    try {
      const result = await syncSingleAccount(account);
      return { success: true, data: result };
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err?.message || "Manual sync failed" });
    }
  });

  // 9. List Processed Messages
  app.get("/email/messages", async (req) => {
    const auth = await app.authenticate(req);
    const orgId = auth.orgId;
    const query = req.query as {
      page?: string;
      limit?: string;
      priority?: string;
      category?: string;
      accountId?: string;
      search?: string;
    };

    const page = Math.max(1, parseInt(query.page || "1") || 1);
    const limit = Math.min(50, Math.max(1, parseInt(query.limit || "20") || 20));
    const skip = (page - 1) * limit;

    const where: any = { organizationId: orgId };
    if (query.priority && query.priority !== "ALL") {
      where.priority = query.priority;
    }
    if (query.category && query.category !== "ALL") {
      where.category = query.category;
    }
    if (query.accountId) {
      where.accountId = query.accountId;
    }
    if (query.search) {
      where.OR = [
        { subject: { contains: query.search, mode: "insensitive" } },
        { fromEmail: { contains: query.search, mode: "insensitive" } },
        { fromName: { contains: query.search, mode: "insensitive" } },
        { summary: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const [total, messages] = await Promise.all([
      prisma.emailMessage.count({ where }),
      prisma.emailMessage.findMany({
        where,
        include: { account: { select: { id: true, label: true, email: true } } },
        orderBy: { date: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return {
      success: true,
      data: messages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });

  // 10. Send Email Reply from Web UI
  app.post("/email/messages/:id/reply", async (req, reply) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const schema = z.object({
      textBody: z.string().min(1),
      htmlBody: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0]?.message || "Invalid reply body" });
    }

    const msg = await prisma.emailMessage.findFirst({
      where: { id, organizationId: auth.orgId },
      include: { account: true },
    });
    if (!msg) {
      return reply.code(404).send({ success: false, error: "Email message not found" });
    }

    try {
      const subject = msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`;
      const sent = await sendOutgoingEmail(msg.account, {
        to: msg.fromEmail,
        subject,
        textBody: parsed.data.textBody,
        htmlBody: parsed.data.htmlBody,
        inReplyTo: msg.messageId,
      });

      await prisma.emailMessage.update({
        where: { id: msg.id },
        data: {
          replyDraft: parsed.data.textBody,
          replyStatus: "SENT",
          replySentAt: new Date(),
        },
      });

      return { success: true, messageId: sent.messageId };
    } catch (err: any) {
      return reply.code(500).send({ success: false, error: err?.message || "Failed to dispatch reply via SMTP" });
    }
  });

  // 11. List & Create Automation Rules
  app.get("/email/rules", async (req) => {
    const auth = await app.authenticate(req);
    const orgId = auth.orgId;
    const rules = await prisma.emailRule.findMany({
      where: { organizationId: orgId },
      include: { account: { select: { id: true, label: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { success: true, data: rules };
  });

  app.post("/email/rules", async (req, reply) => {
    const auth = await app.authenticate(req);
    const schema = z.object({
      accountId: z.string().nullable().optional(),
      name: z.string().min(1),
      matchSender: z.string().nullable().optional(),
      matchDomain: z.string().nullable().optional(),
      matchKeyword: z.string().nullable().optional(),
      matchPriority: z.string().nullable().optional(),
      matchCategory: z.string().nullable().optional(),
      actionSendWhatsApp: z.boolean().default(true),
      actionSummarize: z.boolean().default(true),
      actionCreateTask: z.boolean().default(false),
      actionCreateRemind: z.boolean().default(false),
      actionRoutePhone: z.string().nullable().optional(),
      enabled: z.boolean().default(true),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.issues[0]?.message || "Invalid rule data" });
    }

    const rule = await prisma.emailRule.create({
      data: {
        organizationId: auth.orgId,
        ...parsed.data,
      },
    });

    return { success: true, data: rule };
  });

  app.delete("/email/rules/:id", async (req, reply) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.emailRule.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!existing) {
      return reply.code(404).send({ success: false, error: "Rule not found" });
    }

    await prisma.emailRule.delete({ where: { id } });
    return { success: true, message: "Rule deleted successfully" };
  });
};
