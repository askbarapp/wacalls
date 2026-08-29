import { createTransport } from "nodemailer";
import { env } from "../env.js";

export async function sendMail(to: string, subject: string, text: string) {
  if (!env.SMTP_HOST) {
    return { skipped: true as const };
  }
  const transport = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({
    from: env.SMTP_FROM ?? "WaCalls <noreply@localhost>",
    to,
    subject,
    text,
  });
  return { skipped: false as const };
}
