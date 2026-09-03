import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@wacalls/database";
import { ok } from "@wacalls/shared";
import { ChannelWaitQueue } from "@wacalls/queue";
import { redis } from "../redis.js";

const waitQueue = new ChannelWaitQueue(redis);

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get("/dashboard", async (req) => {
    const auth = await app.authenticate(req);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const org = { organizationId: auth.orgId };
    const [channels, today, answered, noAnswer, failed, agents, duration, todayMessages] = await Promise.all([
      prisma.whatsAppChannel.findMany({ where: org }),
      prisma.call.count({ where: { ...org, createdAt: { gte: start } } }),
      prisma.call.count({ where: { ...org, createdAt: { gte: start }, status: "ENDED", outcome: "ANSWERED" } }),
      prisma.call.count({
        where: { ...org, createdAt: { gte: start }, status: { in: ["NO_ANSWER", "ENDED"] }, outcome: "NO_ANSWER" },
      }),
      prisma.call.count({ where: { ...org, createdAt: { gte: start }, status: "FAILED" } }),
      prisma.organizationUser.count({ where: { ...org, presence: { in: ["READY", "BUSY"] } } }),
      prisma.call.aggregate({
        where: { ...org, createdAt: { gte: start } },
        _sum: { durationMs: true },
      }),
      prisma.message.count({ where: { ...org, createdAt: { gte: start }, status: { not: "FAILED" } } }),
    ]);
    const active = await prisma.call.findMany({
      where: { ...org, status: { in: ["CONNECTING", "RINGING", "ANSWERED"] } },
    });
    const queues = [];
    for (const ch of channels) {
      queues.push({ channelId: ch.id, items: await waitQueue.snapshot(ch.id) });
    }
    const campaigns = await prisma.campaign.findMany({
      where: { ...org, status: { in: ["RUNNING", "PAUSED", "SCHEDULED"] } },
      include: { _count: { select: { campaignContacts: true } } },
    });
    return ok({
      channels,
      activeCalls: active,
      queue: queues,
      todayCalls: today,
      todayMessages,
      answered,
      noAnswer,
      failed,
      totalDurationMs: duration._sum.durationMs ?? 0,
      campaigns,
      agentsOnline: agents,
    });
  });
};
