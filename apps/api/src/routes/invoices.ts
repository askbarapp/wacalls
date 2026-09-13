import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { NotFoundError, ok, okPage, pageMeta, pageQuerySchema, pageSkip } from "@wacalls/shared";
import {
  createInvoiceOrQuote,
  sendInvoiceToClient,
  getPendingPaymentsSummary,
  markInvoicePayment,
} from "../services/invoice-service.js";
import { generateInvoicePdfBuffer, type InvoiceItem } from "../services/pdf-generator.js";

export const invoiceRoutes: FastifyPluginAsync = async (app) => {
  // 1. List Invoices / Quotations
  app.get("/invoices", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.inbox")(req);

    const q = pageQuerySchema
      .extend({
        channelId: z.string().uuid().optional(),
        kind: z.enum(["QUOTATION", "INVOICE"]).optional(),
        status: z.enum(["UNPAID", "PARTIAL", "PAID", "OVERDUE"]).optional(),
        search: z.string().optional(),
      })
      .parse(req.query);

    const where = {
      organizationId: auth.orgId,
      ...(q.channelId ? { channelId: q.channelId } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search?.trim()
        ? {
            OR: [
              { clientName: { contains: q.search.trim(), mode: "insensitive" as const } },
              { clientPhone: { contains: q.search.trim() } },
              { invoiceNumber: { contains: q.search.trim(), mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.businessInvoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pageSkip(q.page, q.limit),
        take: q.limit,
        include: {
          channel: { select: { displayName: true } },
        },
      }),
      prisma.businessInvoice.count({ where }),
    ]);

    return okPage(rows, pageMeta(q.page, q.limit, total));
  });

  // 2. Pending Payments Summary
  app.get("/invoices/pending-summary", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.inbox")(req);
    const summary = await getPendingPaymentsSummary(auth.orgId);
    return ok(summary);
  });

  // 3. Public PDF View / Download Endpoint (accessible by clients via WhatsApp link)
  app.get("/invoices/public/:id/pdf", async (req, reply) => {
    const { id } = req.params as { id: string };
    const invoice = await prisma.businessInvoice.findUnique({
      where: { id },
      include: {
        channel: { select: { displayName: true, phoneNumber: true } },
        organization: { select: { name: true } },
      },
    });

    if (!invoice) throw new NotFoundError("Invoice not found");

    const pdfBuffer = generateInvoicePdfBuffer({
      invoiceNumber: invoice.invoiceNumber,
      kind: invoice.kind as "QUOTATION" | "INVOICE",
      date: invoice.createdAt.toLocaleDateString("en-IN"),
      dueDate: invoice.dueDate ? invoice.dueDate.toLocaleDateString("en-IN") : null,
      companyName: invoice.organization.name,
      companyPhone: invoice.channel.phoneNumber,
      clientName: invoice.clientName,
      clientPhone: invoice.clientPhone,
      items: invoice.items as unknown as InvoiceItem[],
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      balance: invoice.total - invoice.amountPaid,
      status: invoice.status,
      notes: invoice.notes,
    });

    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="${invoice.invoiceNumber}.pdf"`)
      .send(pdfBuffer);
  });

  // 4. Create New Invoice / Quotation
  app.post("/invoices", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.inbox")(req);

    const body = z
      .object({
        channelId: z.string().uuid(),
        clientName: z.string().min(1),
        clientPhone: z.string().min(8),
        kind: z.enum(["QUOTATION", "INVOICE"]).default("QUOTATION"),
        items: z.array(
          z.object({
            description: z.string().min(1),
            quantity: z.number().min(1),
            unitPrice: z.number().min(0),
            amount: z.number().min(0),
          }),
        ),
        tax: z.number().min(0).default(0),
        dueDate: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);

    const invoice = await createInvoiceOrQuote({
      organizationId: auth.orgId,
      channelId: body.channelId,
      clientName: body.clientName,
      clientPhone: body.clientPhone,
      kind: body.kind,
      items: body.items,
      tax: body.tax,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      notes: body.notes || undefined,
      autoEnrollFollowUp: true,
    });

    return ok(invoice);
  });

  // 5. Send / Resend Invoice to Client via WhatsApp
  app.post("/invoices/:id/send", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.inbox")(req);
    const { id } = req.params as { id: string };

    const inv = await prisma.businessInvoice.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!inv) throw new NotFoundError("Invoice not found");

    const result = await sendInvoiceToClient(id);
    return ok(result);
  });

  // 6. Record Payment
  app.patch("/invoices/:id/payment", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.inbox")(req);
    const { id } = req.params as { id: string };

    const body = z.object({ amount: z.number().positive() }).parse(req.body);
    const updated = await markInvoicePayment(id, body.amount);
    return ok(updated);
  });
};
