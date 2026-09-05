import type { FastifyPluginAsync } from "fastify";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { prisma, type Prisma } from "@wacalls/database";
import {
  ConflictError,
  MESSAGE_TEMPLATE_KINDS,
  NotFoundError,
  ok,
  parseTemplateButtons,
  parseTemplateSections,
  templateFromRecord,
} from "@wacalls/shared";
import { env } from "../env.js";

const kindZ = z.enum(MESSAGE_TEMPLATE_KINDS);

const buttonZ = z.object({
  id: z.string().trim().min(1).max(40).optional(),
  type: z.enum(["reply", "url", "call"]).default("reply"),
  text: z.string().trim().min(1).max(20),
  url: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(20).optional(),
});

const sectionZ = z.object({
  title: z.string().trim().max(24).default("Options"),
  rows: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40).optional(),
        title: z.string().trim().min(1).max(24),
        description: z.string().trim().max(72).optional(),
      }),
    )
    .min(1)
    .max(10),
});

const saveZ = z.object({
  name: z.string().trim().min(1).max(80),
  kind: kindZ.default("TEXT"),
  body: z.string().trim().min(1).max(4096),
  header: z.string().trim().max(60).optional().nullable(),
  footer: z.string().trim().max(60).optional().nullable(),
  mediaPath: z.string().trim().max(500).optional().nullable(),
  mediaMime: z.string().trim().max(80).optional().nullable(),
  buttons: z.array(buttonZ).max(3).optional(),
  listButton: z.string().trim().max(20).optional().nullable(),
  sections: z.array(sectionZ).max(10).optional(),
});

export const STARTER_MESSAGE_TEMPLATES = [
  {
    id: "starter-hello",
    name: "Hello",
    kind: "TEXT" as const,
    body: "Namaste {{name}}, main {{company}} se baat kar raha hoon. Kya aapke paas 1 minute hai?",
  },
  {
    id: "starter-followup",
    name: "Follow up",
    kind: "TEXT" as const,
    body: "Hi {{name}}, kal wali baat ke baad follow-up kar raha hoon. Kya aap available hain?",
  },
  {
    id: "starter-offer",
    name: "Offer",
    kind: "TEXT" as const,
    body: "Namaste {{name}}, aaj ke liye ek special offer hai. Detail chahiye to reply karein.",
  },
  {
    id: "starter-appointment",
    name: "Appointment",
    kind: "TEXT" as const,
    body: "Hi {{name}}, aapki appointment confirm karne ke liye yeh message hai. Time theek ho to OK likhein.",
  },
  {
    id: "starter-thanks",
    name: "Thank you",
    kind: "TEXT" as const,
    body: "Dhanyavaad {{name}}! Baat karke accha laga. Koi sawaal ho to yahin message karein.",
  },
  {
    id: "starter-simple",
    name: "Intro card",
    kind: "SIMPLE" as const,
    header: "{{company}}",
    body: "Namaste {{name}}, main aapse baat karna chahta hoon. Kya aapke paas 1 minute hai?",
    footer: "Reply STOP to opt out",
  },
  {
    id: "starter-buttons",
    name: "Yes / No",
    kind: "BUTTON" as const,
    body: "Namaste {{name}}, kya aap interested hain? Reply Yes or No.",
    buttons: [
      { type: "reply" as const, text: "Yes" },
      { type: "reply" as const, text: "No" },
    ],
  },
  {
    id: "starter-list",
    name: "Choose option",
    kind: "LIST" as const,
    listButton: "Options",
    body: "Hi {{name}}, please choose one option:",
    sections: [
      {
        title: "Options",
        rows: [{ title: "Call me" }, { title: "Send details" }, { title: "Not now" }],
      },
    ],
  },
  {
    id: "starter-call-answered",
    name: "After call received",
    kind: "BUTTON" as const,
    body: "Hi {{name}}, thanks for taking our call from {{company}}. Are you interested in going ahead? Reply Yes or No.",
    buttons: [
      { type: "reply" as const, text: "Yes" },
      { type: "reply" as const, text: "No" },
    ],
  },
  {
    id: "starter-call-rejected",
    name: "After call rejected",
    kind: "SIMPLE" as const,
    header: "{{company}}",
    body: "Hi {{name}}, we just tried to call you. The purpose was to share an update and see if this is a good time. You can call us back on this chat whenever you are free.",
    footer: "Reply here anytime",
  },
  {
    id: "starter-call-unanswered",
    name: "After unanswered call",
    kind: "BUTTON" as const,
    body: "Hi {{name}}, we called from {{company}} but couldn't reach you. Would you like us to call you back? Reply Yes or No.",
    buttons: [
      { type: "reply" as const, text: "Yes" },
      { type: "reply" as const, text: "No" },
    ],
  },
] as const;

export { templateFromRecord as templatePayloadFromRow };

export async function resolveMessageTemplate(orgId: string, templateId: string) {
  const starter = STARTER_MESSAGE_TEMPLATES.find((t) => t.id === templateId);
  if (starter) {
    return prisma.messageTemplate.create({
      data: {
        organizationId: orgId,
        name: starter.name,
        kind: starter.kind,
        body: starter.body,
        header: "header" in starter ? starter.header : null,
        footer: "footer" in starter ? starter.footer : null,
        buttons: ("buttons" in starter ? starter.buttons : []) as Prisma.InputJsonValue,
        listButton: "listButton" in starter ? starter.listButton : null,
        sections: ("sections" in starter ? starter.sections : []) as Prisma.InputJsonValue,
      },
    });
  }
  const row = await prisma.messageTemplate.findFirst({
    where: { id: templateId, organizationId: orgId },
  });
  if (!row) throw new NotFoundError("Message template not found");
  return row;
}

function serialize(row: {
  id: string;
  name: string;
  kind?: string | null;
  body: string;
  header?: string | null;
  footer?: string | null;
  mediaPath?: string | null;
  mediaMime?: string | null;
  buttons?: unknown;
  listButton?: string | null;
  sections?: unknown;
  createdAt?: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind || "TEXT",
    body: row.body,
    header: row.header ?? "",
    footer: row.footer ?? "",
    hasMedia: Boolean(row.mediaPath),
    buttons: parseTemplateButtons(row.buttons),
    listButton: row.listButton ?? "Options",
    sections: parseTemplateSections(row.sections),
    createdAt: row.createdAt,
  };
}

function validateKind(body: z.infer<typeof saveZ>) {
  if (body.kind === "MEDIA" && !body.mediaPath) {
    throw new ConflictError("Upload an image for a media template.");
  }
  if (body.kind === "BUTTON") {
    const buttons = body.buttons ?? [];
    if (!buttons.length) throw new ConflictError("Add at least one button.");
    for (const btn of buttons) {
      if (btn.type === "url" && !btn.url?.trim()) throw new ConflictError("Website buttons need a URL.");
      if (btn.type === "call" && !btn.phone?.trim()) throw new ConflictError("Call buttons need a phone number.");
    }
  }
  if (body.kind === "LIST") {
    const rows = (body.sections ?? []).flatMap((s) => s.rows);
    if (!rows.length) throw new ConflictError("Add at least one list option.");
  }
}

export const messageTemplateRoutes: FastifyPluginAsync = async (app) => {
  app.get("/message-templates", async (req) => {
    const auth = await app.authenticate(req);
    const custom = await prisma.messageTemplate.findMany({
      where: { organizationId: auth.orgId },
      orderBy: { createdAt: "desc" },
    });
    return ok({
      starter: STARTER_MESSAGE_TEMPLATES.map((t) => serialize(t)),
      custom: custom.map(serialize),
    });
  });

  app.post("/message-templates/media", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const file = await req.file();
    if (!file) throw new ConflictError("Image file required");
    const ext = path.extname(file.filename).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) {
      throw new ConflictError("Use a JPG, PNG, WebP, or GIF image");
    }
    const dir = path.join(env.RECORDINGS_DIR, "templates", auth.orgId);
    await mkdir(dir, { recursive: true });
    const stored = `${crypto.randomUUID()}${ext === ".jpeg" ? ".jpg" : ext}`;
    const filePath = path.join(dir, stored);
    await pipeline(file.file, createWriteStream(filePath));
    const mime = file.mimetype.startsWith("image/") ? file.mimetype : ext === ".png" ? "image/png" : "image/jpeg";
    return ok({ path: filePath, mimeType: mime });
  });

  app.get("/message-templates/:id/media", async (req, reply) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const row = await prisma.messageTemplate.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { mediaPath: true, mediaMime: true },
    });
    if (!row?.mediaPath) throw new NotFoundError("No image on this template");
    return reply.type(row.mediaMime || "image/jpeg").send(createReadStream(row.mediaPath));
  });

  app.post("/message-templates", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const body = saveZ.parse(req.body);
    validateKind(body);
    return ok(
      serialize(
        await prisma.messageTemplate.create({
          data: {
            organizationId: auth.orgId,
            name: body.name,
            kind: body.kind,
            body: body.body,
            header: body.header || null,
            footer: body.footer || null,
            mediaPath: body.mediaPath || null,
            mediaMime: body.mediaMime || null,
            buttons: (body.buttons ?? []) as Prisma.InputJsonValue,
            listButton: body.listButton || null,
            sections: (body.sections ?? []) as Prisma.InputJsonValue,
          },
        }),
      ),
    );
  });

  app.patch("/message-templates/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.messageTemplate.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!existing) throw new NotFoundError("Template not found");
    const body = saveZ.partial().parse(req.body);
    const merged = saveZ.parse({
      name: body.name ?? existing.name,
      kind: body.kind ?? (existing.kind as (typeof MESSAGE_TEMPLATE_KINDS)[number]) ?? "TEXT",
      body: body.body ?? existing.body,
      header: body.header === undefined ? existing.header : body.header,
      footer: body.footer === undefined ? existing.footer : body.footer,
      mediaPath: body.mediaPath === undefined ? existing.mediaPath : body.mediaPath,
      mediaMime: body.mediaMime === undefined ? existing.mediaMime : body.mediaMime,
      buttons: body.buttons ?? parseTemplateButtons(existing.buttons),
      listButton: body.listButton === undefined ? existing.listButton : body.listButton,
      sections: body.sections ?? parseTemplateSections(existing.sections),
    });
    validateKind(merged);
    return ok(
      serialize(
        await prisma.messageTemplate.update({
          where: { id },
          data: {
            name: merged.name,
            kind: merged.kind,
            body: merged.body,
            header: merged.header || null,
            footer: merged.footer || null,
            mediaPath: merged.mediaPath || null,
            mediaMime: merged.mediaMime || null,
            buttons: (merged.buttons ?? []) as Prisma.InputJsonValue,
            listButton: merged.listButton || null,
            sections: (merged.sections ?? []) as Prisma.InputJsonValue,
          },
        }),
      ),
    );
  });

  app.delete("/message-templates/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const { id } = req.params as { id: string };
    await prisma.messageTemplate.deleteMany({ where: { id, organizationId: auth.orgId } });
    return ok({ deleted: true });
  });
};
