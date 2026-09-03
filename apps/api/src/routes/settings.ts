import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { ok } from "@wacalls/shared";
import { extractSarvamApiKey } from "@wacalls/audio-engine";

function publicValue(key: string, value: unknown) {
  if (key !== "sarvam_api_key") return value;
  const apiKey = extractSarvamApiKey(value);
  return { configured: Boolean(apiKey), last4: apiKey ? apiKey.slice(-4) : "" };
}

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/settings", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("settings.manage")(req).catch(async () => {
      if (!auth.superAdmin) throw new Error("forbidden");
    });
    const rows = await prisma.setting.findMany({
      where: { OR: [{ organizationId: auth.orgId }, { organizationId: null }] },
    });
    return ok(Object.fromEntries(rows.map((r) => [r.key, publicValue(r.key, r.value)])));
  });

  app.put("/settings/:key", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("settings.manage")(req);
    const { key } = req.params as { key: string };
    const body = z.object({ value: z.any() }).parse(req.body);
    let stored = body.value;
    if (key === "sarvam_api_key") {
      const apiKey = typeof stored === "string" ? stored.trim() : extractSarvamApiKey(stored);
      stored = { apiKey };
    }
    const row = await prisma.setting.upsert({
      where: { organizationId_key: { organizationId: auth.orgId, key } },
      update: { value: stored },
      create: { organizationId: auth.orgId, key, value: stored },
    });
    return ok({ key: row.key, value: publicValue(row.key, row.value) });
  });
};
