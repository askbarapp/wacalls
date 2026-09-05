import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { NotFoundError, ok } from "@wacalls/shared";
import { assertKnowledgeQuota } from "../services/org.js";
import { okPage, pageMeta, pageQuerySchema, pageSkip } from "../lib/pagination.js";

const kbBody = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(""),
});

const docBody = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});

export const knowledgeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/knowledge-bases", async (req) => {
    const auth = await app.authenticate(req);
    return ok(
      await prisma.knowledgeBase.findMany({
        where: { organizationId: auth.orgId },
        include: { _count: { select: { documents: true } } },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  app.post("/knowledge-bases", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const body = kbBody.parse(req.body);
    await assertKnowledgeQuota(auth.orgId);
    return ok(await prisma.knowledgeBase.create({ data: { ...body, organizationId: auth.orgId } }));
  });

  app.get("/knowledge-bases/:id", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const q = pageQuerySchema.parse(req.query);
    const row = await prisma.knowledgeBase.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!row) throw new NotFoundError("Knowledge base not found");
    const where = { knowledgeBaseId: id };
    const [documents, total] = await Promise.all([
      prisma.knowledgeBaseDocument.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pageSkip(q.page, q.limit),
        take: q.limit,
      }),
      prisma.knowledgeBaseDocument.count({ where }),
    ]);
    return okPage({ ...row, documents }, pageMeta(q.page, q.limit, total));
  });

  app.patch("/knowledge-bases/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.knowledgeBase.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!existing) throw new NotFoundError("Knowledge base not found");
    const body = kbBody.partial().parse(req.body);
    return ok(await prisma.knowledgeBase.update({ where: { id }, data: body }));
  });

  app.delete("/knowledge-bases/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { id } = req.params as { id: string };
    await prisma.knowledgeBase.deleteMany({ where: { id, organizationId: auth.orgId } });
    return ok({ deleted: true });
  });

  app.post("/knowledge-bases/:id/documents", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { id } = req.params as { id: string };
    const kb = await prisma.knowledgeBase.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!kb) throw new NotFoundError("Knowledge base not found");
    const body = docBody.parse(req.body);
    return ok(await prisma.knowledgeBaseDocument.create({ data: { ...body, knowledgeBaseId: id } }));
  });

  app.patch("/knowledge-bases/:id/documents/:docId", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { id, docId } = req.params as { id: string; docId: string };
    const kb = await prisma.knowledgeBase.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!kb) throw new NotFoundError("Knowledge base not found");
    const body = docBody.partial().parse(req.body);
    return ok(await prisma.knowledgeBaseDocument.update({ where: { id: docId }, data: body }));
  });

  app.delete("/knowledge-bases/:id/documents/:docId", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { id, docId } = req.params as { id: string; docId: string };
    const kb = await prisma.knowledgeBase.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!kb) throw new NotFoundError("Knowledge base not found");
    await prisma.knowledgeBaseDocument.deleteMany({ where: { id: docId, knowledgeBaseId: id } });
    return ok({ deleted: true });
  });
};
