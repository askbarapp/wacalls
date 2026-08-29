import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { normalizePhone, ok, NotFoundError, ConflictError } from "@wacalls/shared";
import { previewCsv } from "../services/csv.js";

export const contactRoutes: FastifyPluginAsync = async (app) => {
  app.get("/contacts", async (req) => {
    const auth = await app.authenticate(req);
    const q = req.query as Record<string, string | undefined>;
    const contacts = await prisma.contact.findMany({
      where: {
        organizationId: auth.orgId,
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: "insensitive" } },
                { phone: { contains: q.q } },
                { email: { contains: q.q, mode: "insensitive" } },
                { company: { contains: q.q, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(q.tag ? { tags: { has: q.tag } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return ok(contacts);
  });

  app.post("/contacts", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const body = z
      .object({
        name: z.string().min(1),
        phone: z.string(),
        email: z.string().email().optional(),
        company: z.string().optional(),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);
    const phone = normalizePhone(body.phone);
    if (!phone.ok) throw new ConflictError("Invalid phone");
    const contact = await prisma.contact.create({
      data: { ...body, phone: phone.e164, organizationId: auth.orgId },
    });
    return ok(contact);
  });

  app.patch("/contacts/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.contact.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!existing) throw new NotFoundError();
    const body = z
      .object({
        name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        company: z.string().optional(),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
        doNotCall: z.boolean().optional(),
        status: z.string().optional(),
      })
      .parse(req.body);
    const phone = body.phone ? normalizePhone(body.phone) : null;
    if (phone && !phone.ok) throw new ConflictError("Invalid phone");
    const contact = await prisma.contact.update({
      where: { id },
      data: { ...body, phone: phone?.ok ? phone.e164 : undefined },
    });
    return ok(contact);
  });

  app.delete("/contacts/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const { id } = req.params as { id: string };
    await prisma.contact.deleteMany({ where: { id, organizationId: auth.orgId } });
    return ok({ deleted: true });
  });

  app.get("/contact-lists", async (req) => {
    const auth = await app.authenticate(req);
    const lists = await prisma.contactList.findMany({
      where: { organizationId: auth.orgId },
      include: { _count: { select: { members: true } } },
    });
    return ok(lists);
  });

  app.post("/contact-lists", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const body = z.object({ name: z.string(), description: z.string().optional() }).parse(req.body);
    return ok(
      await prisma.contactList.create({ data: { ...body, organizationId: auth.orgId } }),
    );
  });

  app.post("/contact-lists/:id/members", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const { id } = req.params as { id: string };
    const body = z.object({ contactIds: z.array(z.string().uuid()) }).parse(req.body);
    const list = await prisma.contactList.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!list) throw new NotFoundError();
    await prisma.contactListMember.createMany({
      data: body.contactIds.map((contactId) => ({ contactListId: id, contactId })),
      skipDuplicates: true,
    });
    return ok({ added: body.contactIds.length });
  });

  app.post("/contacts/import/preview", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const file = await req.file();
    if (!file) throw new ConflictError("CSV file required");
    const text = (await file.toBuffer()).toString("utf8");
    const preview = await previewCsv(auth.orgId, text);
    const rec = await prisma.csvImport.create({
      data: {
        organizationId: auth.orgId,
        fileName: file.filename,
        totalRows: preview.total,
        validRows: preview.valid.length,
        invalidRows: preview.invalid.length,
        duplicateRows: preview.duplicates.length,
        errorReport: { invalid: preview.invalid, duplicates: preview.duplicates } as any,
        status: "preview",
      },
    });
    return ok({
      importId: rec.id,
      total: preview.total,
      valid: preview.valid.length,
      invalid: preview.invalid.length,
      duplicates: preview.duplicates.length,
      sample: preview.valid.slice(0, 25),
      errors: [...preview.invalid, ...preview.duplicates],
      rows: preview.valid,
    });
  });

  app.post("/contacts/import/confirm", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const body = z
      .object({
        importId: z.string().uuid(),
        rows: z.array(
          z.object({
            name: z.string(),
            phone: z.string(),
            email: z.string().optional(),
            company: z.string().optional(),
          }),
        ),
        listId: z.string().uuid().optional(),
      })
      .parse(req.body);
    const created = await prisma.$transaction(async (tx) => {
      const items = [];
      for (const row of body.rows) {
        const contact = await tx.contact.upsert({
          where: { organizationId_phone: { organizationId: auth.orgId, phone: row.phone } },
          update: { name: row.name, email: row.email, company: row.company },
          create: { organizationId: auth.orgId, ...row },
        });
        items.push(contact);
        if (body.listId) {
          await tx.contactListMember.upsert({
            where: {
              contactListId_contactId: { contactListId: body.listId, contactId: contact.id },
            },
            update: {},
            create: { contactListId: body.listId, contactId: contact.id },
          });
        }
      }
      await tx.csvImport.update({
        where: { id: body.importId },
        data: { status: "imported" },
      });
      return items;
    });
    return ok({ imported: created.length });
  });

  app.get("/contacts/export", async (req, reply) => {
    const auth = await app.authenticate(req);
    const contacts = await prisma.contact.findMany({ where: { organizationId: auth.orgId } });
    const csv = [
      "name,phone,email,company,do_not_call",
      ...contacts.map(
        (c) =>
          `${csvEscape(c.name)},${c.phone},${csvEscape(c.email ?? "")},${csvEscape(c.company ?? "")},${c.doNotCall}`,
      ),
    ].join("\n");
    reply.header("content-type", "text/csv");
    reply.header("content-disposition", "attachment; filename=contacts.csv");
    return csv;
  });
};

function csvEscape(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
  return v;
}
