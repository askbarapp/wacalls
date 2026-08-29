import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { ok } from "@wacalls/shared";

export const aiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/ai-configs", async (req) => {
    const auth = await app.authenticate(req);
    return ok(await prisma.aiConfig.findMany({ where: { organizationId: auth.orgId } }));
  });

  app.post("/ai-configs", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const body = z
      .object({
        name: z.string(),
        provider: z.string(),
        model: z.string(),
        voice: z.string().optional(),
        language: z.string().default("en"),
        systemPrompt: z.string(),
        greeting: z.string().optional(),
        objective: z.string().optional(),
        questions: z.string().optional(),
        disallowed: z.string().optional(),
        temperature: z.number().min(0).max(2).default(0.4),
        maxTokens: z.number().int().default(400),
      })
      .parse(req.body);
    return ok(await prisma.aiConfig.create({ data: { ...body, organizationId: auth.orgId } }));
  });
};
