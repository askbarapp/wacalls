import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { ok, WEBHOOK_EVENTS } from "@wacalls/shared";
import { randomBytes } from "node:crypto";

function secret() {
  return randomBytes(24).toString("hex");
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.get("/webhooks", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("webhooks.manage")(req);
    const hooks = await prisma.webhook.findMany({
      where: { organizationId: auth.orgId },
      include: { deliveries: { take: 10, orderBy: { createdAt: "desc" } } },
    });
    return ok(hooks.map((h) => ({ ...h, secret: undefined })));
  });

  app.post("/webhooks", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("webhooks.manage")(req);
    const body = z
      .object({
        url: z.string().url(),
        events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
      })
      .parse(req.body);
    const hook = await prisma.webhook.create({
      data: { organizationId: auth.orgId, url: body.url, events: body.events, secret: secret() },
    });
    return ok({ ...hook, secret: hook.secret });
  });

  app.get("/webhooks/:id/deliveries", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("webhooks.manage")(req);
    const { id } = req.params as { id: string };
    return ok(
      await prisma.webhookDelivery.findMany({
        where: { webhookId: id, webhook: { organizationId: auth.orgId } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
  });
};
