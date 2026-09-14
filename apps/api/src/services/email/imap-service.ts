import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import pino from "pino";
import { decryptCredential } from "./crypto.js";

const log = pino({ name: "imap-service", level: process.env.LOG_LEVEL ?? "info" });

export interface ImapConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface ParsedEmailMessage {
  messageId: string;
  fromName: string | null;
  fromEmail: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  date: Date;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
}

/**
 * Tests an IMAP connection handshake with provided credentials.
 */
export async function testImapConnection(config: ImapConnectionConfig): Promise<{ success: boolean; message: string }> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    logger: false,
    emitLogs: false,
  });

  try {
    await client.connect();
    // Validate that we can access mailbox list
    await client.list();
    await client.logout();
    return { success: true, message: "IMAP connection successful." };
  } catch (err: any) {
    log.warn({ err: err?.message, host: config.host, user: config.user }, "IMAP test connection failed");
    return { success: false, message: err?.message || "Failed to connect to IMAP server." };
  }
}

/**
 * Connects to IMAP mailbox and fetches new incoming messages since last sync.
 */
export async function fetchNewEmails(account: {
  id: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapPasswordEncrypted: string;
  lastSyncAt: Date | null;
}): Promise<ParsedEmailMessage[]> {
  const password = decryptCredential(account.imapPasswordEncrypted);
  if (!password) {
    throw new Error(`Cannot decrypt IMAP password for email account ${account.imapUser}`);
  }

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: {
      user: account.imapUser,
      pass: password,
    },
    logger: false,
    emitLogs: false,
  });

  const messages: ParsedEmailMessage[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Look back 2 hours before lastSyncAt (or at most 24 hours if null) to avoid missing emails due to time sync skew
      const defaultSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const sinceDate = account.lastSyncAt ? new Date(account.lastSyncAt.getTime() - 2 * 60 * 60 * 1000) : defaultSince;

      // Search recent messages
      const searchCriteria: any = {
        since: sinceDate,
      };

      const uids = await client.search(searchCriteria, { uid: true });
      if (!uids || uids.length === 0) {
        return [];
      }

      // Limit to latest 30 messages per sync tick to prevent worker overload
      const recentUids = uids.slice(-30);

      // In ImapFlow, when fetching by UIDs (array of numbers), options must be passed as 3rd argument: { uid: true }
      for await (const msg of (client as any).fetch(recentUids, { source: true, envelope: true }, { uid: true })) {
        try {
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);

          const fromAddress = parsed.from?.value?.[0]?.address || account.imapUser;
          const fromName = parsed.from?.value?.[0]?.name || null;
          const toAddress =
            (Array.isArray(parsed.to) ? parsed.to[0]?.value?.[0]?.address : parsed.to?.value?.[0]?.address) ||
            account.imapUser;

          const rawMsgId = parsed.messageId || `gen-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const cleanMessageId = rawMsgId.replace(/[<>]/g, "").trim();

          const attachments = (parsed.attachments || []).map((att: any) => ({
            filename: att.filename || "attachment.dat",
            contentType: att.contentType || "application/octet-stream",
            size: att.size || (att.content ? att.content.length : 0),
          }));

          messages.push({
            messageId: cleanMessageId,
            fromName,
            fromEmail: fromAddress.toLowerCase(),
            toEmail: toAddress.toLowerCase(),
            subject: parsed.subject || "(No Subject)",
            bodyText: (parsed.text || "").trim(),
            bodyHtml: typeof parsed.html === "string" ? parsed.html : null,
            date: parsed.date || new Date(),
            attachments,
          });
        } catch (parseErr: any) {
          log.warn({ err: parseErr?.message, uid: msg.uid }, "Failed to parse email message source");
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err: any) {
    log.error({ err: err?.message, host: account.imapHost, user: account.imapUser }, "IMAP sync error");
    throw err;
  }

  return messages;
}
