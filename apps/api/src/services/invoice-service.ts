import pino from "pino";
import { prisma } from "@wacalls/database";
import { normalizePhone } from "@wacalls/shared";
import { generateInvoicePdfBuffer, type InvoiceItem, type InvoicePdfData } from "./pdf-generator.js";
import { sendWhatsAppText } from "./messaging.js";
import { enrollInCadence } from "./followup-cadence.js";

const log = pino({ name: "invoice-service" });

export interface CreateInvoiceInput {
  organizationId: string;
  channelId: string;
  conversationId?: string;
  clientName: string;
  clientPhone: string;
  kind?: "QUOTATION" | "INVOICE";
  items: InvoiceItem[];
  subtotal?: number;
  tax?: number;
  total?: number;
  dueDate?: Date | null;
  notes?: string;
  autoEnrollFollowUp?: boolean;
}

/**
 * Creates an Invoice or Quotation, assigns a unique document number, and generates the PDF.
 */
export async function createInvoiceOrQuote(input: CreateInvoiceInput) {
  const kind = input.kind ?? "QUOTATION";
  const prefix = kind === "INVOICE" ? "INV" : "QTN";
  const count = await prisma.businessInvoice.count({
    where: { organizationId: input.organizationId, kind },
  });
  const invoiceNumber = `${prefix}-${String(count + 1).padStart(4, "0")}`;

  const subtotal = input.subtotal ?? input.items.reduce((sum, it) => sum + (it.amount || it.quantity * it.unitPrice), 0);
  const tax = input.tax ?? 0;
  const total = input.total ?? (subtotal + tax);

  const phoneParsed = normalizePhone(input.clientPhone);
  const normalizedPhone = phoneParsed.ok ? phoneParsed.e164 : input.clientPhone;

  const invoice = await prisma.businessInvoice.create({
    data: {
      invoiceNumber,
      organizationId: input.organizationId,
      channelId: input.channelId,
      conversationId: input.conversationId || null,
      clientName: input.clientName,
      clientPhone: normalizedPhone,
      kind,
      items: input.items as any,
      subtotal,
      tax,
      total,
      status: "UNPAID",
      dueDate: input.dueDate || null,
      notes: input.notes || null,
    },
    include: {
      channel: { select: { displayName: true, phoneNumber: true } },
      organization: { select: { name: true } },
    },
  });

  // Automatically start follow-up drip cadence for this quotation/invoice if requested
  if (input.autoEnrollFollowUp !== false) {
    await enrollInCadence({
      organizationId: input.organizationId,
      channelId: input.channelId,
      conversationId: input.conversationId,
      contactPhone: normalizedPhone,
      contactName: input.clientName,
      context: `${kind} #${invoiceNumber} for Rs. ${total.toLocaleString("en-IN")}`,
    }).catch((err) => log.warn({ err: err.message }, "auto-enroll in cadence failed"));
  }

  return invoice;
}

/**
 * Sends a commercial document notification via WhatsApp to the client.
 */
export async function sendInvoiceToClient(invoiceId: string) {
  const invoice = await prisma.businessInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      channel: { select: { id: true, displayName: true, phoneNumber: true } },
      organization: { select: { id: true, name: true } },
    },
  });
  if (!invoice) throw new Error("Invoice not found");

  const pdfUrl = `https://wacall.in/api/v1/invoices/public/${invoice.id}/pdf`;
  const isInvoice = invoice.kind === "INVOICE";
  const docTitle = isInvoice ? "Tax Invoice (इनवॉइस)" : "Commercial Quotation (कोटेशन)";

  const itemsList = (invoice.items as unknown as InvoiceItem[])
    .map((it) => `• ${it.quantity}x ${it.description}: ₹${it.amount.toLocaleString("en-IN")}`)
    .join("\n");

  const message = [
    `📄 *${docTitle} #${invoice.invoiceNumber}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `प्रिय *${invoice.clientName}* जी,`,
    ``,
    `*${invoice.organization.name}* की ओर से आपका ${isInvoice ? "इनवॉइस" : "कोटेशन"} तैयार है:`,
    ``,
    `*विवरण (Items):*`,
    itemsList,
    ``,
    `*कुल राशि (Total):* ₹${invoice.total.toLocaleString("en-IN")}`,
    invoice.dueDate ? `*देय तिथि (Due Date):* ${invoice.dueDate.toLocaleDateString("en-IN")}` : null,
    `*स्थिति (Status):* ${invoice.status === "PAID" ? "✅ चुकता (PAID)" : "⏳ लंबित (PENDING)"}`,
    ``,
    `📥 *PDF डाउनलोड / देखें:*`,
    pdfUrl,
    `━━━━━━━━━━━━━━━━━━━━`,
    `यदि आपका कोई प्रश्न है, तो आप इसी चैट पर उत्तर दे सकते हैं। धन्यवाद!`,
  ]
    .filter(Boolean)
    .join("\n");

  await sendWhatsAppText({
    organizationId: invoice.organizationId,
    channelId: invoice.channelId,
    phone: invoice.clientPhone,
    body: message,
    chatSource: "invoice_bot",
  });

  return { success: true, pdfUrl };
}

/**
 * Returns summary of all pending / overdue payments for the organization.
 */
export async function getPendingPaymentsSummary(organizationId: string) {
  const unpaid = await prisma.businessInvoice.findMany({
    where: {
      organizationId,
      status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
    },
    orderBy: { dueDate: "asc" },
  });

  const totalOutstanding = unpaid.reduce((sum, inv) => sum + (inv.total - inv.amountPaid), 0);
  const now = new Date();
  const overdueList = unpaid.filter((inv) => inv.dueDate && inv.dueDate < now);
  const upcomingList = unpaid.filter((inv) => !inv.dueDate || inv.dueDate >= now);

  return {
    totalCount: unpaid.length,
    totalOutstanding,
    overdueCount: overdueList.length,
    overdueAmount: overdueList.reduce((sum, inv) => sum + (inv.total - inv.amountPaid), 0),
    invoices: unpaid,
  };
}

/**
 * Marks an invoice as partially or fully paid.
 */
export async function markInvoicePayment(invoiceId: string, amount: number) {
  const invoice = await prisma.businessInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new Error("Invoice not found");

  const newPaid = invoice.amountPaid + amount;
  const newStatus = newPaid >= invoice.total ? "PAID" : "PARTIAL";

  const updated = await prisma.businessInvoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: newPaid,
      status: newStatus,
    },
  });

  return updated;
}

/**
 * Background tick: Sends polite WhatsApp reminders for invoices due today or overdue.
 */
export async function processDuePaymentReminders() {
  const now = new Date();
  const oneDayFromNow = new Date(now.getTime() + 24 * 3600 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 3600 * 1000);

  // Find unpaid invoices with dueDate within next 24 hours OR overdue within last 3 days
  // where reminder hasn't been sent in the last 20 hours
  const dueInvoices = await prisma.businessInvoice.findMany({
    where: {
      status: { in: ["UNPAID", "PARTIAL"] },
      dueDate: { lte: oneDayFromNow },
      OR: [
        { lastReminderAt: null },
        { lastReminderAt: { lte: oneDayAgo } },
      ],
      remindersSent: { lt: 3 }, // Maximum 3 polite reminders
    },
    include: {
      channel: { select: { id: true } },
      organization: { select: { name: true } },
    },
    take: 20,
  });

  for (const inv of dueInvoices) {
    try {
      const isOverdue = inv.dueDate && inv.dueDate < now;
      const balance = inv.total - inv.amountPaid;
      const pdfUrl = `https://wacall.in/api/v1/invoices/public/${inv.id}/pdf`;

      const reminderBody = isOverdue
        ? `🔔 *पेमेंट रिमाइंडर (Payment Reminder)*\n━━━━━━━━━━━━━━━━━━━━\nनमस्ते ${inv.clientName} जी,\n\n*${inv.organization.name}* के इनवॉइस #${inv.invoiceNumber} की देय तिथि समाप्त हो चुकी है।\n\n*बकाया राशि:* ₹${balance.toLocaleString("en-IN")}\n*PDF इनवॉइस:* ${pdfUrl}\n━━━━━━━━━━━━━━━━━━━━\nकृपया भुगतान की पुष्टि करें या कोई प्रश्न हो तो यहाँ रिप्लाई करें।`
        : `🔔 *पेमेंट रिमाइंडर (Payment Due Soon)*\n━━━━━━━━━━━━━━━━━━━━\nनमस्ते ${inv.clientName} जी,\n\n*${inv.organization.name}* के इनवॉइस #${inv.invoiceNumber} का भुगतान कल देय है।\n\n*राशि:* ₹${balance.toLocaleString("en-IN")}\n*PDF इनवॉइस:* ${pdfUrl}\n━━━━━━━━━━━━━━━━━━━━\nधन्यवाद!`;

      await sendWhatsAppText({
        organizationId: inv.organizationId,
        channelId: inv.channelId,
        phone: inv.clientPhone,
        body: reminderBody,
        chatSource: "payment_reminder",
      });

      await prisma.businessInvoice.update({
        where: { id: inv.id },
        data: {
          remindersSent: { increment: 1 },
          lastReminderAt: now,
          status: isOverdue ? "OVERDUE" : inv.status,
        },
      });

      log.info({ invoiceNumber: inv.invoiceNumber, phone: inv.clientPhone }, "sent payment reminder");
    } catch (err) {
      log.warn({ err, invoiceId: inv.id }, "failed to send payment reminder");
    }
  }
}
