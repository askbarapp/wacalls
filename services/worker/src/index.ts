import { Worker, Queue } from "bullmq";
import { Redis } from "ioredis";
import { createHmac } from "node:crypto";
import pino from "pino";
import { prisma } from "@wacalls/database";
import {
  ChannelLock,
  ChannelWaitQueue,
  QUEUE_NAMES,
  type PlaceCallJob,
} from "@wacalls/queue";

const log = pino({ name: "worker", level: process.env.LOG_LEVEL ?? "info" });
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const WHATSAPP_URL = process.env.WHATSAPP_URL ?? "http://whatsapp:4010";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? "";

const connection = { url: REDIS_URL };
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const lock = new ChannelLock(redis);
const waitQueue = new ChannelWaitQueue(redis);
const retryQueue = new Queue(QUEUE_NAMES.retries, { connection });

async function wa<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${WHATSAPP_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-token": INTERNAL_TOKEN,
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error((json as any).error?.message ?? `whatsapp ${res.status}`);
  return json;
}

const callWorker = new Worker<PlaceCallJob>(
  QUEUE_NAMES.calls,
  async (job) => {
    const { callId, channelId, organizationId, phone, recordingPath } = job.data;
    const owner = callId;
    const acquired = await lock.acquire(channelId, owner);
    if (!acquired) {
      const current = await prisma.call.findUnique({ where: { id: callId } });
      if (current && ["ENDED", "FAILED", "CANCELLED", "BUSY", "NO_ANSWER", "REJECTED"].includes(current.status)) {
        await waitQueue.remove(channelId, callId);
        return { skipped: true };
      }
      throw new Error("CHANNEL_BUSY");
    }

    await waitQueue.remove(channelId, callId);
    try {
      await wa("/internal/calls", {
        method: "POST",
        body: JSON.stringify({
          callId,
          channelId,
          organizationId,
          phone,
          audioFilePath: recordingPath,
        }),
      });
      const heartbeat = setInterval(() => {
        void lock.renew(channelId, owner);
      }, 30_000);
      const started = Date.now();
      while (Date.now() - started < 15 * 60_000) {
        const call = await prisma.call.findUnique({ where: { id: callId } });
        if (
          call &&
          ["ENDED", "FAILED", "BUSY", "NO_ANSWER", "REJECTED", "CANCELLED"].includes(call.status)
        ) {
          clearInterval(heartbeat);
          return { status: call.status };
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      clearInterval(heartbeat);
      return { status: "timeout" };
    } finally {
      await lock.release(channelId, owner);
    }
  },
  {
    connection,
    concurrency: 20,
    settings: { backoffStrategy: (attempts) => Math.min(2000 * 2 ** attempts, 15_000) },
  },
);

callWorker.on("failed", (job, err) => {
  if (err.message === "CHANNEL_BUSY" && job) {
    log.info({ callId: job.data.callId }, "channel busy; retrying");
  } else {
    log.error({ err, jobId: job?.id }, "call job failed");
  }
});

const campaignWorker = new Worker(
  QUEUE_NAMES.campaigns,
  async (job) => {
    const { campaignId } = job.data as { campaignId: string; organizationId: string };
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { recording: true },
    });
    if (!campaign || campaign.status !== "RUNNING") return { skipped: true };

    const next = await prisma.campaignContact.findFirst({
      where: {
        campaignId,
        skipped: false,
        status: { in: ["pending", "retry"] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        contact: { doNotCall: false },
      },
      include: { contact: true },
      orderBy: { createdAt: "asc" },
    });

    if (!next) {
      const remaining = await prisma.campaignContact.count({
        where: { campaignId, skipped: false, status: { in: ["pending", "retry"] } },
      });
      if (remaining === 0) {
        await prisma.campaign.update({ where: { id: campaignId }, data: { status: "COMPLETED" } });
      }
      return { done: remaining === 0 };
    }

    await prisma.campaignContact.update({
      where: { id: next.id },
      data: { status: "calling", attempts: { increment: 1 } },
    });

    const call = await prisma.call.create({
      data: {
        organizationId: campaign.organizationId,
        channelId: campaign.channelId,
        campaignId: campaign.id,
        campaignContactId: next.id,
        contactId: next.contactId,
        phone: next.contact.phone,
        contactName: next.contact.name,
        source: "campaign",
        status: "QUEUED",
      },
    });

    await waitQueue.enqueue(campaign.channelId, call.id);
    const callQueue = new Queue(QUEUE_NAMES.calls, { connection });
    await callQueue.add(
      "place-call",
      {
        callId: call.id,
        organizationId: campaign.organizationId,
        channelId: campaign.channelId,
        phone: next.contact.phone,
        contactName: next.contact.name,
        campaignId: campaign.id,
        recordingPath: campaign.recording?.filePath,
      },
      { jobId: call.id },
    );
    await callQueue.close();

    const campaignQ = new Queue(QUEUE_NAMES.campaigns, { connection });
    await campaignQ.add(
      "run",
      { campaignId, organizationId: campaign.organizationId },
      { delay: 4000, jobId: `camp-${campaignId}-${Date.now()}` },
    );
    await campaignQ.close();
    return { enqueued: call.id };
  },
  { connection, concurrency: 4 },
);

campaignWorker.on("completed", async (job) => {
  const { campaignId } = job.data as { campaignId: string };
  const call = await prisma.call.findFirst({
    where: { campaignId },
    orderBy: { createdAt: "desc" },
    include: { campaignContact: true, campaign: true },
  });
  if (!call?.campaignContact || !call.campaign) return;
  if (!["NO_ANSWER", "BUSY", "FAILED"].includes(call.status) && call.outcome !== "NO_ANSWER") {
    return;
  }
  const cc = call.campaignContact;
  if (cc.attempts < call.campaign.maxAttempts) {
    const nextAttemptAt = new Date(Date.now() + call.campaign.retryDelayMin * 60_000);
    await prisma.campaignContact.update({
      where: { id: cc.id },
      data: { status: "retry", nextAttemptAt },
    });
    await retryQueue.add(
      "campaign-retry",
      { campaignId: call.campaignId, organizationId: call.organizationId },
      { delay: call.campaign.retryDelayMin * 60_000 },
    );
  } else {
    await prisma.campaignContact.update({ where: { id: cc.id }, data: { status: "exhausted" } });
  }
});

const webhookWorker = new Worker(
  QUEUE_NAMES.webhooks,
  async (job) => {
    const { webhookId, event, payload } = job.data as {
      webhookId: string;
      event: string;
      payload: Record<string, unknown>;
    };
    const hook = await prisma.webhook.findUnique({ where: { id: webhookId } });
    if (!hook || !hook.isActive) return;
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", hook.secret).update(body).digest("hex");
    const delivery = await prisma.webhookDelivery.create({
      data: { webhookId, event, payload: payload as any, attempts: job.attemptsMade + 1 },
    });
    try {
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wacalls-signature": signature,
          "x-wacalls-event": event,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { success: res.ok, statusCode: res.status },
      });
      if (!res.ok) throw new Error(`webhook ${res.status}`);
    } catch (err) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { success: false, lastError: err instanceof Error ? err.message : "error" },
      });
      throw err;
    }
  },
  { connection, concurrency: 8 },
);

const retryWorker = new Worker(
  QUEUE_NAMES.retries,
  async (job) => {
    const data = job.data as { campaignId: string; organizationId: string };
    const q = new Queue(QUEUE_NAMES.campaigns, { connection });
    await q.add("run", data);
    await q.close();
  },
  { connection },
);

const shutdown = async () => {
  await Promise.all([
    callWorker.close(),
    campaignWorker.close(),
    webhookWorker.close(),
    retryWorker.close(),
  ]);
  redis.disconnect();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

log.info("WaCalls worker started");
