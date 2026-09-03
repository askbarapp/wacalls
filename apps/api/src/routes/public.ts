import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@wacalls/database";
import { ok } from "@wacalls/shared";

export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/plans", async () => {
    const plans = await prisma.plan.findMany({
      where: { isPublic: true },
      orderBy: { priceMonthly: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        maxChannels: true,
        maxAgents: true,
        maxKnowledgeBases: true,
        maxAiAgents: true,
        maxMessagesPerDay: true,
        maxCallsPerDay: true,
        allowCloudApi: true,
        allowSdk: true,
        priceMonthly: true,
      },
    });
    return ok(plans);
  });
};
