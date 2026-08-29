import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@wacalls/database";
import { ok } from "@wacalls/shared";

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/analytics", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("reports.view")(req).catch(async () => {
      await app.requirePermission("calls.view")(req);
    });
    const start = new Date();
    start.setDate(start.getDate() - 13);
    start.setHours(0, 0, 0, 0);
    const calls = await prisma.call.findMany({
      where: { organizationId: auth.orgId, createdAt: { gte: start } },
      select: {
        status: true,
        outcome: true,
        durationMs: true,
        createdAt: true,
        agentId: true,
        campaignId: true,
        agent: { select: { name: true } },
      },
    });
    const byDay: Record<string, { total: number; answered: number }> = {};
    const byAgent: Record<string, number> = {};
    const outcomes: Record<string, number> = {};
    let talk = 0;
    let answered = 0;
    for (const c of calls) {
      const day = c.createdAt.toISOString().slice(0, 10);
      byDay[day] ??= { total: 0, answered: 0 };
      byDay[day].total += 1;
      if (c.outcome === "ANSWERED" || c.status === "ANSWERED" || c.status === "ENDED") {
        if (c.outcome === "ANSWERED") {
          byDay[day].answered += 1;
          answered += 1;
        }
      }
      talk += c.durationMs;
      const agent = c.agent?.name ?? "Unassigned";
      byAgent[agent] = (byAgent[agent] ?? 0) + 1;
      const oc = c.outcome ?? c.status;
      outcomes[oc] = (outcomes[oc] ?? 0) + 1;
    }
    return ok({
      totalCalls: calls.length,
      answeredCalls: answered,
      answerRate: calls.length ? answered / calls.length : 0,
      averageDurationMs: calls.length ? talk / calls.length : 0,
      totalTalkTimeMs: talk,
      callsPerDay: byDay,
      agentCalls: byAgent,
      outcomes,
    });
  });
};
