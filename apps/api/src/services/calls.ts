import { prisma } from "@wacalls/database";
import { ConflictError, normalizePhone, NotFoundError } from "@wacalls/shared";
import { ChannelWaitQueue } from "@wacalls/queue";
import { callQueue } from "../queues.js";
import { redis } from "../redis.js";
import { enqueueWebhook } from "./webhooks.js";

const waitQueue = new ChannelWaitQueue(redis);

export async function enqueueCall(input: {
  organizationId: string;
  channelId: string;
  phone: string;
  contactName?: string;
  campaignId?: string;
  agentId?: string;
  contactId?: string;
  campaignContactId?: string;
  source?: string;
  recordingPath?: string;
}) {
  const phone = normalizePhone(input.phone);
  if (!phone.ok) throw new ConflictError("Invalid phone number");

  const channel = await prisma.whatsAppChannel.findFirst({
    where: { id: input.channelId, organizationId: input.organizationId },
  });
  if (!channel) throw new NotFoundError("Channel not found");
  if (channel.status !== "CONNECTED") {
    throw new ConflictError(
      "WhatsApp is not connected. Open WhatsApp → QR / Reconnect, scan with Linked Devices, then call again.",
    );
  }

  if (input.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: input.organizationId },
    });
    if (contact?.doNotCall) throw new ConflictError("Contact is on DO_NOT_CALL");
  }

  const call = await prisma.call.create({
    data: {
      organizationId: input.organizationId,
      channelId: input.channelId,
      phone: phone.e164,
      contactName: input.contactName,
      campaignId: input.campaignId,
      agentId: input.agentId,
      contactId: input.contactId,
      campaignContactId: input.campaignContactId,
      source: input.source ?? "dialer",
      status: "QUEUED",
    },
  });

  const position = await waitQueue.enqueue(input.channelId, call.id);
  await callQueue.add(
    "place-call",
    {
      callId: call.id,
      organizationId: input.organizationId,
      channelId: input.channelId,
      phone: phone.e164,
      contactName: input.contactName,
      campaignId: input.campaignId,
      recordingPath: input.recordingPath,
    },
    { jobId: call.id },
  );

  await enqueueWebhook(input.organizationId, "call.started", {
    call_id: call.id,
    channel_id: input.channelId,
    contact_id: input.contactId,
    status: "QUEUED",
    queue_position: position,
  });

  return { call, position };
}
