/**
 * Pure TypeScript PDF 1.4 Generator for Quotations & Invoices.
 * Produces crisp, beautiful vector PDFs with zero external binary dependencies.
 */

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  kind: "QUOTATION" | "INVOICE";
  date: string;
  dueDate?: string | null;
  companyName: string;
  companyPhone?: string | null;
  clientName: string;
  clientPhone: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  balance: number;
  status: string;
  notes?: string | null;
  upiId?: string | null;
}

function sanitizeText(str: string): string {
  return str.replace(/[\\()\r\n]/g, " ");
}

/**
 * Generates valid PDF 1.4 bytes for a commercial Quotation or Invoice.
 */
export function generateInvoicePdfBuffer(data: InvoicePdfData): Buffer {
  const isInvoice = data.kind === "INVOICE";
  const title = isInvoice ? "TAX INVOICE" : "COMMERCIAL QUOTATION";
  const primaryColor = isInvoice ? "0.08 0.45 0.35" : "0.15 0.35 0.65"; // Teal for invoice, Royal Blue for quote

  const streamLines: string[] = [];

  // Helper functions for PDF content stream
  const strokeColor = (rgb: string) => streamLines.push(`${rgb} RG`);
  const fillColor = (rgb: string) => streamLines.push(`${rgb} rg`);
  const setLineWidth = (w: number) => streamLines.push(`${w} w`);
  const rect = (x: number, y: number, w: number, h: number, fill = false, stroke = false) => {
    streamLines.push(`${x} ${y} ${w} ${h} re ${fill && stroke ? "B" : fill ? "f" : "S"}`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    streamLines.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const text = (x: number, y: number, content: string, font = "/F1", size = 10, color = "0.1 0.1 0.1") => {
    fillColor(color);
    streamLines.push(`BT ${font} ${size} Tf ${x} ${y} Td (${sanitizeText(content)}) Tj ET`);
  };
  const textRight = (x: number, y: number, content: string, font = "/F1", size = 10, color = "0.1 0.1 0.1") => {
    // Approximate right alignment: each char is ~0.55 * size
    const estWidth = content.length * (size * 0.52);
    text(x - estWidth, y, content, font, size, color);
  };

  // 1. Page Background & Header Accent Bar
  fillColor("0.98 0.98 0.99");
  rect(0, 0, 595, 842, true, false);

  // Top Accent Banner
  fillColor(primaryColor);
  rect(0, 810, 595, 32, true, false);

  // 2. Company / Title Block
  text(40, 770, data.companyName.toUpperCase(), "/F2", 18, primaryColor);
  if (data.companyPhone) {
    text(40, 755, `Phone: ${data.companyPhone}`, "/F1", 9, "0.4 0.4 0.4");
  }
  text(40, 742, "Powered by WaCall OS", "/F1", 8, "0.5 0.5 0.5");

  textRight(555, 770, title, "/F2", 18, "0.1 0.1 0.1");
  textRight(555, 755, `#${data.invoiceNumber}`, "/F2", 11, primaryColor);
  textRight(555, 742, `Date: ${data.date}`, "/F1", 9, "0.4 0.4 0.4");

  // Divider line
  strokeColor("0.85 0.85 0.88");
  setLineWidth(1);
  line(40, 725, 555, 725);

  // 3. Bill To & Payment Info Cards
  // Left Box (Client)
  fillColor("1.0 1.0 1.0");
  strokeColor("0.9 0.9 0.92");
  rect(40, 640, 245, 70, true, true);
  text(50, 692, "ISSUED TO / CLIENT", "/F2", 8, "0.5 0.5 0.5");
  text(50, 675, data.clientName, "/F2", 12, "0.1 0.1 0.1");
  text(50, 660, `WhatsApp: ${data.clientPhone}`, "/F1", 10, "0.3 0.3 0.3");

  // Right Box (Terms & Due Date)
  rect(310, 640, 245, 70, true, true);
  text(320, 692, "PAYMENT DETAILS & TERMS", "/F2", 8, "0.5 0.5 0.5");
  text(320, 675, `Status: ${data.status}`, "/F2", 11, data.status === "PAID" ? "0.1 0.6 0.2" : "0.8 0.4 0.0");
  if (data.dueDate) {
    text(320, 660, `Due Date: ${data.dueDate}`, "/F1", 9, "0.3 0.3 0.3");
  }
  if (data.upiId) {
    text(320, 647, `UPI ID: ${data.upiId}`, "/F2", 9, "0.15 0.35 0.65");
  }

  // 4. Items Table Header
  const tableTop = 610;
  fillColor(primaryColor);
  rect(40, tableTop - 20, 515, 22, true, false);
  text(50, tableTop - 14, "ITEM DESCRIPTION", "/F2", 9, "1.0 1.0 1.0");
  textRight(360, tableTop - 14, "QTY", "/F2", 9, "1.0 1.0 1.0");
  textRight(450, tableTop - 14, "RATE (INR)", "/F2", 9, "1.0 1.0 1.0");
  textRight(545, tableTop - 14, "AMOUNT (INR)", "/F2", 9, "1.0 1.0 1.0");

  // 5. Items Rows
  let curY = tableTop - 40;
  data.items.forEach((item, idx) => {
    if (idx % 2 === 1) {
      fillColor("0.96 0.96 0.98");
      rect(40, curY - 6, 515, 20, true, false);
    }
    text(50, curY, item.description, "/F1", 10, "0.15 0.15 0.15");
    textRight(360, curY, String(item.quantity), "/F1", 10, "0.2 0.2 0.2");
    textRight(450, curY, `Rs. ${item.unitPrice.toLocaleString("en-IN")}`, "/F1", 10, "0.2 0.2 0.2");
    textRight(545, curY, `Rs. ${item.amount.toLocaleString("en-IN")}`, "/F2", 10, "0.1 0.1 0.1");

    strokeColor("0.9 0.9 0.92");
    line(40, curY - 7, 555, curY - 7);
    curY -= 22;
  });

  // 6. Summary Totals Box
  const summaryTop = Math.min(curY - 10, 480);
  fillColor("1.0 1.0 1.0");
  strokeColor("0.85 0.85 0.88");
  rect(330, summaryTop - 75, 225, 75, true, true);

  text(345, summaryTop - 20, "Subtotal:", "/F1", 10, "0.3 0.3 0.3");
  textRight(540, summaryTop - 20, `Rs. ${data.subtotal.toLocaleString("en-IN")}`, "/F1", 10, "0.2 0.2 0.2");

  if (data.tax > 0) {
    text(345, summaryTop - 35, "GST / Tax:", "/F1", 10, "0.3 0.3 0.3");
    textRight(540, summaryTop - 35, `Rs. ${data.tax.toLocaleString("en-IN")}`, "/F1", 10, "0.2 0.2 0.2");
  }

  strokeColor("0.85 0.85 0.88");
  line(340, summaryTop - 45, 545, summaryTop - 45);

  text(345, summaryTop - 62, "Total Amount:", "/F2", 12, "0.1 0.1 0.1");
  textRight(540, summaryTop - 62, `Rs. ${data.total.toLocaleString("en-IN")}`, "/F2", 13, primaryColor);

  // 7. Notes & Terms
  if (data.notes) {
    fillColor("0.96 0.96 0.97");
    rect(40, summaryTop - 75, 270, 75, true, false);
    text(50, summaryTop - 20, "NOTES & INSTRUCTIONS:", "/F2", 8, "0.4 0.4 0.4");
    text(50, summaryTop - 36, data.notes.slice(0, 80), "/F1", 8, "0.3 0.3 0.3");
    if (data.notes.length > 80) {
      text(50, summaryTop - 48, data.notes.slice(80, 160), "/F1", 8, "0.3 0.3 0.3");
    }
  }

  // 8. Footer
  strokeColor("0.85 0.85 0.88");
  line(40, 70, 555, 70);
  text(40, 55, "Thank you for your business!", "/F2", 9, "0.3 0.3 0.3");
  text(40, 42, "This is an automated commercial document generated by WaCall OS.", "/F1", 8, "0.5 0.5 0.5");
  textRight(555, 48, "https://wacall.in", "/F2", 8, primaryColor);

  // Build final PDF Object tree
  const contentStream = streamLines.join("\n");
  const streamLength = Buffer.byteLength(contentStream, "latin1");

  const objects = [
    // 1 0 obj: Catalog
    "<< /Type /Catalog /Pages 2 0 R >>",
    // 2 0 obj: Pages
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    // 3 0 obj: Page
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    // 4 0 obj: Stream content
    `<< /Length ${streamLength} >>\nstream\n${contentStream}\nendstream`,
    // 5 0 obj: Standard Font Helvetica
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    // 6 0 obj: Standard Font Helvetica-Bold
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];

  let body = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];

  objects.forEach((obj, idx) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${idx + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });

  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}
