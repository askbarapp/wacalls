import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { newApiKey, sha256 } from "@wacalls/auth";
import { ok } from "@wacalls/shared";

export const keyRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api-keys", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("api_keys.manage")(req);
    const keys = await prisma.apiKey.findMany({
      where: { organizationId: auth.orgId },
      select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    });
    return ok(keys);
  });

  app.post("/api-keys", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("api_keys.manage")(req);
    const body = z
      .object({
        name: z.string().min(1),
        kind: z.enum(["secret", "publishable"]).default("secret"),
        scopes: z.array(z.string()).optional(),
      })
      .parse(req.body);
    const generated = newApiKey(body.kind);
    const scopes =
      body.scopes?.length
        ? body.scopes
        : body.kind === "publishable"
          ? ["calls:write", "messages:write"]
          : ["calls:write", "messages:write", "channels:read"];
    const row = await prisma.apiKey.create({
      data: {
        organizationId: auth.orgId,
        name: body.name,
        prefix: generated.prefix,
        keyHash: sha256(generated.plaintext),
        scopes,
      },
    });
    return ok({ ...row, key: generated.plaintext, kind: body.kind });
  });

  app.delete("/api-keys/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("api_keys.manage")(req);
    const { id } = req.params as { id: string };
    await prisma.apiKey.updateMany({
      where: { id, organizationId: auth.orgId },
      data: { revokedAt: new Date() },
    });
    return ok({ revoked: true });
  });
};
