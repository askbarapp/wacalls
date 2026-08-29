import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { ok } from "@wacalls/shared";

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/settings", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("settings.manage")(req).catch(async () => {
      if (!auth.superAdmin) throw new Error("forbidden");
    });
    const rows = await prisma.setting.findMany({
      where: { OR: [{ organizationId: auth.orgId }, { organizationId: null }] },
    });
    return ok(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  });

  app.put("/settings/:key", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("settings.manage")(req);
    const { key } = req.params as { key: string };
    const body = z.object({ value: z.any() }).parse(req.body);
    const row = await prisma.setting.upsert({
      where: { organizationId_key: { organizationId: auth.orgId, key } },
      update: { value: body.value },
      create: { organizationId: auth.orgId, key, value: body.value },
    });
    return ok(row);
  });
};
