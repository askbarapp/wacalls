import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, Prisma } from "@wacalls/database";
import { normalizePhone, digitsOnly, ok, NotFoundError, ConflictError, AppError } from "@wacalls/shared";
import { previewCsv } from "../services/csv.js";
import { whatsappClient } from "../services/whatsapp-client.js";

function phonesMatch(a: string, b: string) {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  if (da === db) return true;
  return da.length >= 10 && db.length >= 10 && da.slice(-10) === db.slice(-10);
}

function blankToUndef(v: unknown) {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

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
        ...(q.listId
          ? { listMembers: { some: { contactListId: q.listId } } }
          : {}),
      },
      include: {
        listMembers: { include: { list: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return ok(contacts);
  });

  app.post("/contacts", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const parsed = z
      .object({
        name: z.string().trim().min(1, "Name is required"),
        phone: z.string().trim().min(1, "Phone is required"),
        email: z.preprocess(blankToUndef, z.string().email("Enter a valid email").optional()),
        company: z.preprocess(blankToUndef, z.string().optional()),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
        listId: z.preprocess(blankToUndef, z.string().uuid().optional()),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION",
        parsed.error.issues.map((i) => i.message).join("; ") || "Invalid contact",
        400,
      );
    }
    const body = parsed.data;
    const phone = normalizePhone(body.phone);
    if (!phone.ok) {
      throw new ConflictError("Enter a valid phone number, e.g. 9876543210 or +919876543210");
    }
    try {
      const contact = await prisma.contact.create({
        data: {
          organizationId: auth.orgId,
          name: body.name,
          phone: phone.e164,
          email: body.email ?? null,
          company: body.company ?? null,
          tags: body.tags ?? [],
          notes: body.notes,
        },
      });
      if (body.listId) {
        const list = await prisma.contactList.findFirst({
          where: { id: body.listId, organizationId: auth.orgId },
        });
        if (list) {
          await prisma.contactListMember.createMany({
            data: [{ contactListId: list.id, contactId: contact.id }],
            skipDuplicates: true,
          });
        }
      }
      return ok(contact);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existing = await prisma.contact.findFirst({
          where: { organizationId: auth.orgId, phone: phone.e164 },
        });
        if (existing && body.listId) {
          await prisma.contactListMember.createMany({
            data: [{ contactListId: body.listId, contactId: existing.id }],
            skipDuplicates: true,
          });
          return ok(existing);
        }
        throw new ConflictError("A contact with this phone number already exists.");
      }
      throw err;
    }
  });

  app.post("/contacts/bulk", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const body = z
      .object({
        listId: z.string().uuid(),
        rows: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              phone: z.string().trim().min(1),
              email: z.preprocess(blankToUndef, z.string().optional()),
              company: z.preprocess(blankToUndef, z.string().optional()),
            }),
          )
          .min(1)
          .max(500),
      })
      .parse(req.body);
    const list = await prisma.contactList.findFirst({
      where: { id: body.listId, organizationId: auth.orgId },
    });
    if (!list) throw new NotFoundError("Group not found");
    const failed: Array<{ phone: string; reason: string }> = [];
    let imported = 0;
    await prisma.$transaction(async (tx) => {
      for (const row of body.rows) {
        const phone = normalizePhone(row.phone);
        if (!phone.ok) {
          failed.push({ phone: row.phone, reason: "Invalid phone" });
          continue;
        }
        const contact = await tx.contact.upsert({
          where: { organizationId_phone: { organizationId: auth.orgId, phone: phone.e164 } },
          update: {
            name: row.name,
            email: row.email ?? undefined,
            company: row.company ?? undefined,
          },
          create: {
            organizationId: auth.orgId,
            name: row.name,
            phone: phone.e164,
            email: row.email ?? null,
            company: row.company ?? null,
          },
        });
        await tx.contactListMember.upsert({
          where: {
            contactListId_contactId: { contactListId: list.id, contactId: contact.id },
          },
          update: {},
          create: { contactListId: list.id, contactId: contact.id },
        });
        imported += 1;
      }
    });
    return ok({ imported, failed });
  });

  app.post("/contacts/verify", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const body = z
      .object({
        contact_ids: z.array(z.string().uuid()).min(1).max(200),
        channel_id: z.string().uuid().optional(),
      })
      .parse(req.body);
    const contacts = await prisma.contact.findMany({
      where: { organizationId: auth.orgId, id: { in: body.contact_ids } },
    });
    if (!contacts.length) throw new NotFoundError("No contacts found");

    const channel = body.channel_id
      ? await prisma.whatsAppChannel.findFirst({
          where: { id: body.channel_id, organizationId: auth.orgId, provider: "WEB" },
        })
      : await prisma.whatsAppChannel.findFirst({
          where: { organizationId: auth.orgId, provider: "WEB", status: "CONNECTED" },
          orderBy: { updatedAt: "desc" },
        });
    if (!channel) {
      throw new ConflictError("Connect a WhatsApp Web line first to verify numbers.");
    }

    let checked: Array<{ phone: string; exists: boolean }>;
    try {
      const res = await whatsappClient.onWhatsApp(
        channel.id,
        contacts.map((c) => c.phone),
      );
      checked = res.results ?? [];
    } catch (err) {
      throw new ConflictError(
        err instanceof Error ? err.message : "Could not verify WhatsApp numbers. Reconnect WhatsApp and try again.",
      );
    }

    const now = new Date();
    const updated = await prisma.$transaction(
      contacts.map((contact) => {
        const hit = checked.find((row) => phonesMatch(row.phone, contact.phone));
        return prisma.contact.update({
          where: { id: contact.id },
          data: { whatsappOn: hit?.exists === true, whatsappCheckedAt: now },
        });
      }),
    );
    return ok({
      checked: updated.length,
      onWhatsApp: updated.filter((c) => c.whatsappOn).length,
      contacts: updated,
    });
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
      include: {
        _count: { select: { members: true } },
        members: { select: { contact: { select: { whatsappOn: true } } } },
      },
    });
    return ok(
      lists.map(({ members, ...list }) => ({
        ...list,
        verifiedCount: members.filter((m) => m.contact.whatsappOn === true).length,
      })),
    );
  });

  app.post("/contact-lists", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const body = z
      .object({
        name: z.string().trim().min(1, "List name is required"),
        description: z.preprocess(blankToUndef, z.string().optional()),
      })
      .parse(req.body);
    return ok(
      await prisma.contactList.create({ data: { ...body, organizationId: auth.orgId } }),
    );
  });

  app.get("/contact-lists/:id", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const list = await prisma.contactList.findFirst({
      where: { id, organizationId: auth.orgId },
      include: {
        _count: { select: { members: true } },
        members: {
          include: { contact: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!list) throw new NotFoundError();
    return ok(list);
  });

  app.patch("/contact-lists/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.contactList.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!existing) throw new NotFoundError();
    const body = z
      .object({
        name: z.string().trim().min(1).optional(),
        description: z.preprocess(blankToUndef, z.string().optional()),
      })
      .parse(req.body);
    return ok(await prisma.contactList.update({ where: { id }, data: body }));
  });

  app.delete("/contact-lists/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const { id } = req.params as { id: string };
    const used = await prisma.campaign.count({
      where: { organizationId: auth.orgId, contactListId: id },
    });
    if (used) {
      throw new ConflictError("This group is used by a campaign. Remove it from campaigns first.");
    }
    const deleted = await prisma.contactList.deleteMany({
      where: { id, organizationId: auth.orgId },
    });
    if (!deleted.count) throw new NotFoundError();
    return ok({ deleted: true });
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

  app.delete("/contact-lists/:id/members/:contactId", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("contacts.manage")(req);
    const { id, contactId } = req.params as { id: string; contactId: string };
    const list = await prisma.contactList.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!list) throw new NotFoundError();
    await prisma.contactListMember.deleteMany({
      where: { contactListId: id, contactId },
    });
    return ok({ removed: true });
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
