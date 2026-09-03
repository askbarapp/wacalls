import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { ConflictError, NotFoundError, ok } from "@wacalls/shared";
import { sendWhatsAppText } from "../services/messaging.js";
import { STARTER_MESSAGE_TEMPLATES, templatePayloadFromRow } from "./message-templates.js";

export const messageRoutes: FastifyPluginAsync = async (app) => {
  app.get("/messages", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    const rows = await prisma.message.findMany({
      where: { organizationId: auth.orgId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { channel: { select: { displayName: true, provider: true } } },
    });
    return ok(rows);
  });

  app.post("/messages", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req);
    await app.requireScope("messages:write")(req);
    const body = z
      .object({
        channel_id: z.string().uuid(),
        phone: z.string().min(6),
        text: z.string().max(4096).optional(),
        template_id: z.string().optional(),
        contact_id: z.string().uuid().optional(),
      })
      .parse(req.body);

    let template = undefined;
    let text = body.text?.trim() ?? "";
    if (body.template_id) {
      const starter = STARTER_MESSAGE_TEMPLATES.find((t) => t.id === body.template_id);
      if (starter) {
        template = templatePayloadFromRow(starter);
        text = text || starter.body;
      } else {
        const row = await prisma.messageTemplate.findFirst({
          where: { id: body.template_id, organizationId: auth.orgId },
        });
        if (!row) throw new NotFoundError("Template not found");
        template = templatePayloadFromRow(row);
        text = text || row.body;
      }
    }
    if (!text) throw new ConflictError("Pick a template or write a message.");
    const contact = body.contact_id
      ? await prisma.contact.findFirst({
          where: { id: body.contact_id, organizationId: auth.orgId },
          select: { name: true, company: true, email: true },
        })
      : null;
    const message = await sendWhatsAppText({
      organizationId: auth.orgId,
      channelId: body.channel_id,
      phone: body.phone,
      body: text,
      contactId: body.contact_id,
      contactName: contact?.name,
      company: contact?.company,
      email: contact?.email,
      template,
    });
    return ok(message);
  });
};
