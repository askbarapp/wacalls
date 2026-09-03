import { prisma } from "@wacalls/database";
import { randomToken } from "@wacalls/auth";
import { ConflictError, normalizePhone, NotFoundError } from "@wacalls/shared";
import { sendWhatsAppText } from "./messaging.js";
import { enqueueCall } from "./calls.js";
import { enqueueWebhook } from "./webhooks.js";
import { publicVisitWidget, seedVisitDepartments, syncVisitIncomingAi } from "./visits-support.js";

const DEFAULT_PURPOSES = ["Sales", "Support", "Partnership", "Other"];

function publicKey() {
  return `wv_${randomToken(12)}`;
}

export async function createVisit(input: {
  organizationId: string;
  channelId: string;
  name: string;
  targetPhone: string;
  buttonLabel?: string;
  greeting?: string;
  purposes?: string[];
}) {
  const target = normalizePhone(input.targetPhone);
  if (!target.ok) throw new ConflictError("Enter a valid target WhatsApp number with country code.");

  const channel = await prisma.whatsAppChannel.findFirst({
    where: { id: input.channelId, organizationId: input.organizationId },
  });
  if (!channel) throw new NotFoundError("Channel not found");
  if (channel.provider === "CLOUD") {
    throw new ConflictError("Website Visit needs a WhatsApp Web channel. Cloud API is text-only.");
  }

  const purposes = (input.purposes ?? DEFAULT_PURPOSES).map((p) => p.trim()).filter(Boolean);
  if (!purposes.length) throw new ConflictError("Add at least one purpose option.");

  const visit = await prisma.visit.create({
    data: {
      organizationId: input.organizationId,
      channelId: channel.id,
      name: input.name.trim(),
      publicKey: publicKey(),
      targetPhone: target.e164,
      buttonLabel: input.buttonLabel?.trim() || "Chat with us",
      greeting: input.greeting?.trim() || "Talk to us on WhatsApp",
      purposes,
    },
  });
  await seedVisitDepartments(visit.id, visit.organizationId, visit.channelId, purposes);
  return visit;
}

export async function updateVisit(
  organizationId: string,
  id: string,
  patch: {
    name?: string;
    channelId?: string;
    targetPhone?: string;
    buttonLabel?: string;
    greeting?: string;
    purposes?: string[];
    enabled?: boolean;
    chatEnabled?: boolean;
    callEnabled?: boolean;
    aiEnabled?: boolean;
    aiConfigId?: string | null;
  },
) {
  const existing = await prisma.visit.findFirst({ where: { id, organizationId } });
  if (!existing) throw new NotFoundError("Website Visit not found");

  let targetPhone = existing.targetPhone;
  if (patch.targetPhone) {
    const phone = normalizePhone(patch.targetPhone);
    if (!phone.ok) throw new ConflictError("Enter a valid target WhatsApp number with country code.");
    targetPhone = phone.e164;
  }

  let channelId = existing.channelId;
  if (patch.channelId) {
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { id: patch.channelId, organizationId },
    });
    if (!channel) throw new NotFoundError("Channel not found");
    channelId = channel.id;
  }

  const purposes = patch.purposes
    ? patch.purposes.map((p) => p.trim()).filter(Boolean)
    : undefined;
  if (purposes && !purposes.length) throw new ConflictError("Add at least one purpose option.");

  const visit = await prisma.visit.update({
    where: { id },
    data: {
      name: patch.name?.trim(),
      channelId,
      targetPhone,
      buttonLabel: patch.buttonLabel?.trim(),
      greeting: patch.greeting?.trim(),
      purposes,
      enabled: patch.enabled,
      chatEnabled: patch.chatEnabled,
      callEnabled: patch.callEnabled,
      aiEnabled: patch.aiEnabled,
      aiConfigId: patch.aiConfigId === undefined ? undefined : patch.aiConfigId,
    },
  });
  await seedVisitDepartments(visit.id, visit.organizationId, visit.channelId, visit.purposes);
  if (patch.aiEnabled !== undefined || patch.aiConfigId !== undefined) {
    await syncVisitIncomingAi(organizationId, visit.id);
  }
  return visit;
}

export async function publicVisitConfig(publicKey: string) {
  return publicVisitWidget(publicKey);
}

export async function submitVisitEnquiry(input: {
  publicKey: string;
  name: string;
  phone: string;
  email: string;
  purpose: string;
}) {
  const visit = await prisma.visit.findUnique({
    where: { publicKey: input.publicKey },
    include: { channel: true },
  });
  if (!visit || !visit.enabled) throw new NotFoundError("This Website Visit is not available.");
  if (visit.channel.status !== "CONNECTED") {
    throw new ConflictError("WhatsApp is not connected. Try again in a moment.");
  }

  const visitorPhone = normalizePhone(input.phone);
  if (!visitorPhone.ok) throw new ConflictError("Enter a valid mobile number with country code.");

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ConflictError("Enter a valid email address.");

  const name = input.name.trim();
  if (name.length < 2) throw new ConflictError("Enter your name.");

  const purpose = input.purpose.trim();
  if (!visit.purposes.includes(purpose)) {
    throw new ConflictError("Select a purpose for this call.");
  }

  const contact = await prisma.contact.upsert({
    where: {
      organizationId_phone: { organizationId: visit.organizationId, phone: visitorPhone.e164 },
    },
    create: {
      organizationId: visit.organizationId,
      name,
      phone: visitorPhone.e164,
      email,
      tags: ["visit"],
      notes: `Website Visit: ${visit.name}\nPurpose: ${purpose}`,
    },
    update: {
      name,
      email,
    },
  });

  const lead = await prisma.visitLead.create({
    data: {
      visitId: visit.id,
      organizationId: visit.organizationId,
      name,
      phone: visitorPhone.e164,
      email,
      purpose,
      status: "submitted",
    },
  });

  const body = [
    `New Website Visit — ${visit.name}`,
    "",
    `Name: ${name}`,
    `Phone: ${visitorPhone.e164}`,
    `Email: ${email}`,
    `Purpose: ${purpose}`,
    "",
    "A WhatsApp call to this visitor will start now.",
  ].join("\n");

  try {
    const message = await sendWhatsAppText({
      organizationId: visit.organizationId,
      channelId: visit.channelId,
      phone: visit.targetPhone,
      body,
      contactId: contact.id,
    });

    const { call, position } = await enqueueCall({
      organizationId: visit.organizationId,
      channelId: visit.channelId,
      phone: visitorPhone.e164,
      contactName: name,
      contactId: contact.id,
      source: "visit",
    });

    await prisma.visitLead.update({
      where: { id: lead.id },
      data: { messageId: message.id, callId: call.id, status: "calling" },
    });

    await enqueueWebhook(visit.organizationId, "visit.submitted", {
      visit_id: visit.id,
      lead_id: lead.id,
      call_id: call.id,
      phone: visitorPhone.e164,
      purpose,
    }).catch(() => undefined);

    return {
      leadId: lead.id,
      callId: call.id,
      queuePosition: position,
      status: "calling" as const,
      message: position > 1 ? `You are in queue. Position #${position}` : "Calling your WhatsApp now. Please answer.",
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Could not start the visit call";
    await prisma.visitLead.update({
      where: { id: lead.id },
      data: { status: "failed", error },
    });
    throw err instanceof ConflictError ? err : new ConflictError(error);
  }
}
