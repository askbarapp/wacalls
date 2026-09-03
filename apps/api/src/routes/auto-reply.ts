import type { FastifyPluginAsync } from "fastify";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { AUTO_REPLY_TRIGGERS, ConflictError, NotFoundError, ok } from "@wacalls/shared";
import { env } from "../env.js";
import { resolveMessageTemplate } from "./message-templates.js";

const triggerZ = z.enum(AUTO_REPLY_TRIGGERS);

const saveBody = z.object({
  name: z.string().trim().min(1).max(80),
  trigger: triggerZ,
  campaignId: z.string().uuid().nullable().optional(),
  body: z.string().trim().max(4000).optional(),
  messageTemplateId: z.string().min(1).nullable().optional(),
  imagePath: z.string().nullable().optional(),
  imageMime: z.string().nullable().optional(),
  delaySeconds: z.number().int().min(0).max(3600).optional(),
  cooldownMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
  showTyping: z.boolean().optional(),
  typingSeconds: z.number().int().min(0).max(15).optional(),
  enabled: z.boolean().optional(),
});

function serialize(rule: {
  id: string;
  name: string;
  trigger: string;
  campaignId: string | null;
  body: string;
  imagePath: string | null;
  imageMime: string | null;
  delaySeconds: number;
  cooldownMinutes: number;
  showTyping: boolean;
  typingSeconds: number;
  enabled: boolean;
  messageTemplateId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  campaign?: { id: string; name: string } | null;
  messageTemplate?: { id: string; name: string; kind: string; body: string } | null;
  _count?: { sends: number };
}) {
  return {
    id: rule.id,
    name: rule.name,
    trigger: rule.trigger,
    campaignId: rule.campaignId,
    campaign: rule.campaign ? { id: rule.campaign.id, name: rule.campaign.name } : null,
    body: rule.body,
    hasImage: Boolean(rule.imagePath),
    delaySeconds: rule.delaySeconds,
    cooldownMinutes: rule.cooldownMinutes,
    showTyping: rule.showTyping,
    typingSeconds: rule.typingSeconds,
    enabled: rule.enabled,
    messageTemplateId: rule.messageTemplateId ?? rule.messageTemplate?.id ?? null,
    messageTemplate: rule.messageTemplate
      ? {
          id: rule.messageTemplate.id,
          name: rule.messageTemplate.name,
          kind: rule.messageTemplate.kind,
          body: rule.messageTemplate.body,
        }
      : null,
    sendCount: rule._count?.sends ?? 0,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

const ruleInclude = {
  campaign: { select: { id: true, name: true } },
  messageTemplate: { select: { id: true, name: true, kind: true, body: true } },
  _count: { select: { sends: true } },
} as const;

const RECOMMENDED: Array<{
  name: string;
  trigger: (typeof AUTO_REPLY_TRIGGERS)[number];
  starterId: string;
}> = [
  { name: "After call received", trigger: "ANSWERED", starterId: "starter-call-answered" },
  { name: "After call rejected", trigger: "REJECTED", starterId: "starter-call-rejected" },
  { name: "After unanswered call", trigger: "NO_ANSWER", starterId: "starter-call-unanswered" },
];

export const autoReplyRoutes: FastifyPluginAsync = async (app) => {
  app.get("/auto-reply-rules", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const q = z
      .object({ trigger: triggerZ.optional() })
      .parse(req.query);
    const rules = await prisma.autoReplyRule.findMany({
      where: {
        organizationId: auth.orgId,
        ...(q.trigger ? { trigger: q.trigger } : {}),
      },
      include: ruleInclude,
      orderBy: { createdAt: "desc" },
    });
    return ok({
      rules: rules.map(serialize),
      counts: await prisma.autoReplyRule
        .groupBy({
          by: ["trigger"],
          where: { organizationId: auth.orgId },
          _count: true,
        })
        .then((rows) => {
          const out = { ANSWERED: 0, NO_ANSWER: 0, REJECTED: 0, NOT_CONNECTED: 0 };
          for (const row of rows) out[row.trigger] = row._count;
          return out;
        }),
    });
  });

  app.get("/auto-reply-rules/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const { id } = req.params as { id: string };
    const rule = await prisma.autoReplyRule.findFirst({
      where: { id, organizationId: auth.orgId },
      include: ruleInclude,
    });
    if (!rule) throw new NotFoundError("Auto reply rule not found");
    return ok(serialize(rule));
  });

  app.post("/auto-reply-rules/recommended", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const created = [];
    for (const spec of RECOMMENDED) {
      const already = await prisma.autoReplyRule.findFirst({
        where: { organizationId: auth.orgId, trigger: spec.trigger, name: spec.name },
      });
      if (already) continue;
      const template = await resolveMessageTemplate(auth.orgId, spec.starterId);
      created.push(
        await prisma.autoReplyRule.create({
          data: {
            organizationId: auth.orgId,
            name: spec.name,
            trigger: spec.trigger,
            body: template.body,
            messageTemplateId: template.id,
            delaySeconds: 5,
            cooldownMinutes: 1440,
            showTyping: true,
            typingSeconds: 2,
            enabled: true,
          },
          include: ruleInclude,
        }),
      );
    }
    if (!created.length) throw new ConflictError("Recommended follow-ups are already set up.");
    return ok({ rules: created.map(serialize) });
  });

  app.post("/auto-reply-rules", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const body = saveBody.parse(req.body);
    const campaignId = body.campaignId || null;
    if (campaignId) {
      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, organizationId: auth.orgId },
        select: { id: true },
      });
      if (!campaign) throw new NotFoundError("Campaign not found");
    }
    const template = body.messageTemplateId
      ? await resolveMessageTemplate(auth.orgId, body.messageTemplateId)
      : null;
    const text = body.body?.trim() || template?.body || "";
    if (!text) throw new ConflictError("Pick a message template or write a message.");
    const rule = await prisma.autoReplyRule.create({
      data: {
        organizationId: auth.orgId,
        campaignId,
        name: body.name,
        trigger: body.trigger,
        body: text,
        messageTemplateId: template?.id ?? null,
        imagePath: body.imagePath || null,
        imageMime: body.imageMime || null,
        delaySeconds: body.delaySeconds,
        cooldownMinutes: body.cooldownMinutes,
        showTyping: body.showTyping,
        typingSeconds: body.typingSeconds,
        enabled: body.enabled,
      },
      include: ruleInclude,
    });
    return ok(serialize(rule));
  });

  app.patch("/auto-reply-rules/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.autoReplyRule.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!existing) throw new NotFoundError("Auto reply rule not found");
    const body = saveBody.partial().parse(req.body);
    if (body.campaignId) {
      const campaign = await prisma.campaign.findFirst({
        where: { id: body.campaignId, organizationId: auth.orgId },
        select: { id: true },
      });
      if (!campaign) throw new NotFoundError("Campaign not found");
    }
    const template =
      body.messageTemplateId === undefined
        ? undefined
        : body.messageTemplateId
          ? await resolveMessageTemplate(auth.orgId, body.messageTemplateId)
          : null;
    const text = body.body?.trim() || template?.body || existing.body;
    if (!text && !template) throw new ConflictError("Pick a message template or write a message.");
    const rule = await prisma.autoReplyRule.update({
      where: { id },
      data: {
        name: body.name,
        trigger: body.trigger,
        campaignId: body.campaignId === undefined ? undefined : body.campaignId,
        body: text,
        messageTemplateId: template === undefined ? undefined : template?.id ?? null,
        imagePath: body.imagePath === undefined ? undefined : body.imagePath,
        imageMime: body.imageMime === undefined ? undefined : body.imageMime,
        delaySeconds: body.delaySeconds,
        cooldownMinutes: body.cooldownMinutes,
        showTyping: body.showTyping,
        typingSeconds: body.typingSeconds,
        enabled: body.enabled,
      },
      include: ruleInclude,
    });
    return ok(serialize(rule));
  });

  app.delete("/auto-reply-rules/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const { id } = req.params as { id: string };
    await prisma.autoReplyRule.deleteMany({ where: { id, organizationId: auth.orgId } });
    return ok({ deleted: true });
  });

  app.post("/auto-reply-rules/image", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const file = await req.file();
    if (!file) throw new ConflictError("Image file required");
    const ext = path.extname(file.filename).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) {
      throw new ConflictError("Use a JPG, PNG, WebP, or GIF image");
    }
    const dir = path.join(env.RECORDINGS_DIR, "auto-reply", auth.orgId);
    await mkdir(dir, { recursive: true });
    const stored = `${crypto.randomUUID()}${ext === ".jpeg" ? ".jpg" : ext}`;
    const filePath = path.join(dir, stored);
    await pipeline(file.file, createWriteStream(filePath));
    const mime =
      file.mimetype.startsWith("image/") ? file.mimetype : ext === ".png" ? "image/png" : "image/jpeg";
    return ok({ path: filePath, mimeType: mime });
  });

  app.get("/auto-reply-rules/:id/image", async (req, reply) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const { id } = req.params as { id: string };
    const rule = await prisma.autoReplyRule.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { imagePath: true, imageMime: true },
    });
    if (!rule?.imagePath) throw new NotFoundError("No image on this rule");
    const mime = rule.imageMime || "image/jpeg";
    return reply.type(mime).send(createReadStream(rule.imagePath));
  });
};
