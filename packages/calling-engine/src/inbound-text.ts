export function jidUserToPhone(jid: string): string | undefined {
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast" || jid.includes("@newsletter")) {
    return undefined;
  }
  const user = jid.split("@")[0]?.split(":")[0];
  if (!user || !/^\d{6,}$/.test(user)) return undefined;
  return `+${user}`;
}

export function extractBaileysText(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, any>;
  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    "";
  const trimmed = String(text || "").trim();
  return trimmed || null;
}

export function parseBaileysInbound(raw: unknown): { phone: string; text: string; messageId?: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, any>;
  if (msg.key?.fromMe) return null;
  const jid = String(msg.key?.remoteJid || "");
  const phone = jidUserToPhone(jid);
  if (!phone) return null;
  const text = extractBaileysText(msg.message);
  if (!text) return null;
  return { phone, text, messageId: msg.key?.id ? String(msg.key.id) : undefined };
}
