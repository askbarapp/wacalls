import { createTransport } from "nodemailer";
import pino from "pino";
import { decryptCredential } from "./crypto.js";

const log = pino({ name: "smtp-service", level: process.env.LOG_LEVEL ?? "info" });

export interface SmtpConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export interface SendEmailPayload {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string | null;
  inReplyTo?: string | null;
}

/**
 * Tests an SMTP connection and authentication handshake.
 */
export async function testSmtpConnection(config: SmtpConnectionConfig): Promise<{ success: boolean; message: string }> {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    tls: {
      rejectUnauthorized: false, // Prevent failure on self-signed / enterprise certs
    },
  });

  try {
    await transport.verify();
    return { success: true, message: "SMTP connection & authentication successful." };
  } catch (err: any) {
    log.warn({ err: err?.message, host: config.host, user: config.user }, "SMTP test connection failed");
    return { success: false, message: err?.message || "Failed to connect to SMTP server." };
  }
}

/**
 * Sends an outgoing email (or reply) using the account's SMTP credentials.
 */
export async function sendOutgoingEmail(
  account: {
    email: string;
    fromName?: string | null;
    smtpHost?: string | null;
    smtpPort?: number | null;
    smtpSecure?: boolean;
    smtpUser?: string | null;
    smtpPasswordEncrypted?: string | null;
  },
  payload: SendEmailPayload,
): Promise<{ messageId: string }> {
  const host = account.smtpHost;
  const user = account.smtpUser || account.email;
  const encryptedPass = account.smtpPasswordEncrypted;

  if (!host || !encryptedPass) {
    throw new Error("SMTP host or credentials are not configured for this email account.");
  }

  const password = decryptCredential(encryptedPass);
  if (!password) {
    throw new Error("Failed to decrypt SMTP credentials.");
  }

  const transport = createTransport({
    host,
    port: account.smtpPort ?? (account.smtpSecure ? 465 : 587),
    secure: account.smtpSecure ?? true,
    auth: {
      user,
      pass: password,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  const fromHeader = account.fromName ? `"${account.fromName}" <${user}>` : user;
  const inReply = payload.inReplyTo ? `<${payload.inReplyTo.replace(/[<>]/g, "")}>` : undefined;

  const res = await transport.sendMail({
    from: fromHeader,
    to: payload.to,
    subject: payload.subject,
    text: payload.textBody,
    html: payload.htmlBody || undefined,
    inReplyTo: inReply,
    references: inReply,
  });

  log.info({ to: payload.to, subject: payload.subject, messageId: res.messageId }, "Outgoing email dispatched via SMTP");
  return { messageId: res.messageId };
}
