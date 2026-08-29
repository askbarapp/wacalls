import { normalizePhone } from "@wacalls/shared";
import { prisma } from "@wacalls/database";

export type CsvRowError = { row: number; phone: string; reason: string };

export type CsvPreview = {
  total: number;
  valid: Array<{ name: string; phone: string; email?: string; company?: string }>;
  invalid: CsvRowError[];
  duplicates: CsvRowError[];
};

export function parseCsv(text: string): string[][] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length);
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        quoted = !quoted;
      } else if (ch === "," && !quoted) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  });
}

export async function previewCsv(organizationId: string, text: string): Promise<CsvPreview> {
  const rows = parseCsv(text);
  const header = rows[0]?.map((h) => h.toLowerCase()) ?? [];
  const nameIdx = header.indexOf("name");
  const phoneIdx = header.indexOf("phone");
  const emailIdx = header.indexOf("email");
  const companyIdx = header.indexOf("company");
  if (nameIdx < 0 || phoneIdx < 0) {
    throw new Error("CSV must include name and phone columns");
  }

  const existing = await prisma.contact.findMany({
    where: { organizationId },
    select: { phone: true },
  });
  const existingSet = new Set(existing.map((c) => c.phone));
  const seen = new Set<string>();

  const valid: CsvPreview["valid"] = [];
  const invalid: CsvRowError[] = [];
  const duplicates: CsvRowError[] = [];

  rows.slice(1).forEach((cols, i) => {
    const row = i + 2;
    const name = cols[nameIdx] ?? "";
    const rawPhone = cols[phoneIdx] ?? "";
    const email = emailIdx >= 0 ? cols[emailIdx] : undefined;
    const company = companyIdx >= 0 ? cols[companyIdx] : undefined;
    const norm = normalizePhone(rawPhone);
    if (!name) {
      invalid.push({ row, phone: rawPhone, reason: "missing name" });
      return;
    }
    if (!norm.ok) {
      invalid.push({ row, phone: rawPhone, reason: norm.reason });
      return;
    }
    if (existingSet.has(norm.e164) || seen.has(norm.e164)) {
      duplicates.push({ row, phone: norm.e164, reason: "duplicate" });
      return;
    }
    seen.add(norm.e164);
    valid.push({ name, phone: norm.e164, email, company });
  });

  return { total: Math.max(0, rows.length - 1), valid, invalid, duplicates };
}
