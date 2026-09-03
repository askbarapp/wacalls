import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@wacalls/database";
import {
  ConflictError,
  cloudInteractivePayload,
  composeSimpleBody,
  digitsOnly,
  fillMessageTemplate,
  nativeMessagePayload,
  normalizePhone,
  NotFoundError,
  templatePreviewText,
  type MessageTemplatePayload,
} from "@wacalls/shared";
import { whatsappClient } from "./whatsapp-client.js";
import { enqueueWebhook } from "./webhooks.js";

export async function sendWhatsAppText(input: {
  organizationId: string;
  channelId: string;
  phone: string;
  body: string;
  contactId?: string;
  campaignId?: string;
  contactName?: string | null;
  company?: string | null;
  email?: string | null;
  template?: MessageTemplatePayload;
}) {
  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    include: { plan: true },
  });
  if (!org) throw new NotFoundError("Organization not found");
  if (org.status === "SUSPENDED") {
    throw new ConflictError("This account is suspended. Contact the platform admin.");
  }

  const phone = normalizePhone(input.phone);
  if (!phone.ok) throw new ConflictError("Invalid phone number");

  const channel = await prisma.whatsAppChannel.findFirst({
    where: { id: input.channelId, organizationId: input.organizationId },
  });
  if (!channel) throw new NotFoundError("Channel not found");

  if (org.plan) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const sentToday = await prisma.message.count({
      where: { organizationId: input.organizationId, createdAt: { gte: start }, status: { not: "FAILED" } },
    });
    if (sentToday >= org.plan.maxMessagesPerDay) {
      throw new ConflictError(`Daily message limit reached (${org.plan.maxMessagesPerDay}). Upgrade the plan.`);
    }
    if (channel.provider === "CLOUD" && !org.plan.allowCloudApi) {
      throw new ConflictError("Cloud API is not included in the current plan.");
    }
  }

  const vars = {
    name: input.contactName,
    phone: phone.e164,
    company: input.company,
    email: input.email,
  };
  const source =
    input.template && (input.template.kind === "TEXT" || input.template.kind === "SIMPLE") && input.body.trim()
      ? { ...input.template, body: input.body }
      : input.template;
  const filled = source
    ? fillMessageTemplate(source, vars)
    : fillMessageTemplate({ kind: "TEXT", body: input.body }, vars);
  const preview = templatePreviewText(filled) || filled.body || input.body;

  const row = await prisma.message.create({
    data: {
      organizationId: input.organizationId,
      channelId: input.channelId,
      contactId: input.contactId,
      campaignId: input.campaignId,
      phone: phone.e164,
      body: preview,
      provider: channel.provider,
      status: "QUEUED",
    },
  });

  try {
    let externalId: string | undefined;
    if (channel.provider === "CLOUD") {
      if (!channel.cloudPhoneNumberId || !channel.cloudAccessToken) {
        throw new Error("Cloud API credentials are missing on this channel.");
      }
      const to = digitsOnly(phone.e164);
      externalId = await sendCloudPayload(channel.cloudPhoneNumberId, channel.cloudAccessToken, to, filled);
    } else {
      const live = await whatsappClient.status(channel.id).catch(() => ({ status: channel.status }));
      if (live.status !== "CONNECTED") {
        throw new Error(
          live.status === "RECONNECTING"
            ? "WhatsApp is reconnecting. Wait a few seconds, or open WhatsApp and click Reconnect."
            : "WhatsApp Web is not connected. Open WhatsApp → Reconnect, scan QR if asked, then send again.",
        );
      }
      const native = nativeMessagePayload(filled);
      const sent = await whatsappClient.sendText(channel.id, phone.e164, native.text, {
        kind: native.kind,
        header: native.header,
        footer: native.footer,
        imagePath: native.imagePath || undefined,
        buttons: native.buttons,
        listButton: native.listButton,
        sections: native.sections,
      });
      externalId = sent.id;
    }

    const updated = await prisma.message.update({
      where: { id: row.id },
      data: { status: "SENT", externalId, sentAt: new Date() },
    });
    await enqueueWebhook(input.organizationId, "message.sent", {
      message_id: updated.id,
      channel_id: input.channelId,
      phone: phone.e164,
    });
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    const updated = await prisma.message.update({
      where: { id: row.id },
      data: { status: "FAILED", error: message },
    });
    await enqueueWebhook(input.organizationId, "message.failed", {
      message_id: updated.id,
      error: message,
    });
    throw new ConflictError(message);
  }
}

async function sendCloudPayload(
  phoneNumberId: string,
  token: string,
  to: string,
  filled: MessageTemplatePayload,
): Promise<string | undefined> {
  const interactive = cloudInteractivePayload(filled);
  if (interactive) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...interactive, to }),
    });
    const json = (await res.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `Cloud API ${res.status}`);
    return json.messages?.[0]?.id;
  }
  const text =
    filled.kind === "SIMPLE" ? composeSimpleBody(filled.header ?? "", filled.body, filled.footer ?? "") : filled.body;
  if (filled.kind === "MEDIA" && filled.mediaPath) {
    const buf = await readFile(filled.mediaPath);
    const ext = path.extname(filled.mediaPath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", mime);
    form.set("file", new Blob([new Uint8Array(buf)], { type: mime }), path.basename(filled.mediaPath));
    const up = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/media`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    const uploaded = (await up.json()) as { id?: string; error?: { message?: string } };
    if (!up.ok || !uploaded.id) throw new Error(uploaded.error?.message ?? `Cloud media ${up.status}`);
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: { id: uploaded.id, caption: text },
      }),
    });
    const json = (await res.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!res.ok) throw new Error(json.error?.message ?? `Cloud API ${res.status}`);
    return json.messages?.[0]?.id;
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  const json = (await res.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Cloud API ${res.status}`);
  return json.messages?.[0]?.id;
}
