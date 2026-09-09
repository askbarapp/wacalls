import { prisma } from "@wacalls/database";
import { digitsOnly, normalizePhone } from "@wacalls/shared";

export async function recordApiChatSend(input: {
  organizationId: string;
  channelId: string;
  phone: string;
  body: string;
  contactId?: string | null;
  source?: string;
  externalId?: string | null;
}) {
  const parsed = normalizePhone(input.phone);
  const phone = parsed.ok ? parsed.e164 : `+${digitsOnly(input.phone)}`;
  let contactId = input.contactId ?? null;
  if (!contactId) {
    const contact = await prisma.contact.upsert({
      where: { organizationId_phone: { organizationId: input.organizationId, phone } },
      create: { organizationId: input.organizationId, phone, name: phone },
      update: {},
      select: { id: true },
    });
    contactId = contact.id;
  }
  const conversation = await prisma.chatConversation.upsert({
    where: {
      organizationId_channelId_phone: {
        organizationId: input.organizationId,
        channelId: input.channelId,
        phone,
      },
    },
    create: {
      organizationId: input.organizationId,
      channelId: input.channelId,
      phone,
      contactId,
      status: "OPEN",
      lastMessageAt: new Date(),
    },
    update: {
      contactId,
      lastMessageAt: new Date(),
    },
  });
  await prisma.chatMessage.create({
    data: {
      organizationId: input.organizationId,
      conversationId: conversation.id,
      direction: "OUT",
      source: input.source ?? "api",
      body: input.body,
      externalId: input.externalId ?? undefined,
    },
  });
}
