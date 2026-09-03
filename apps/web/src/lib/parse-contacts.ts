export type ParsedContact = {
  name: string;
  phone: string;
  email?: string;
  company?: string;
};

const SAMPLE_ROWS: ParsedContact[] = [
  { name: "Rahul Sharma", phone: "9876543210", email: "rahul@college.edu", company: "Math department" },
  { name: "Anita Verma", phone: "9876543211", email: "", company: "Math department" },
  { name: "Imran Khan", phone: "9876543212", email: "imran@college.edu", company: "Math department" },
];

export const CONTACT_SAMPLE_CSV =
  "name,phone,email,company\n" +
  SAMPLE_ROWS.map((r) => `${r.name},${r.phone},${r.email},${r.company}`).join("\n") +
  "\n";

export function contactSampleSpreadsheet(): string {
  const cells = (values: string[]) =>
    values
      .map((v) => `<Cell><Data ss:Type="String">${escapeXml(v)}</Data></Cell>`)
      .join("");
  const rows = [
    ["name", "phone", "email", "company"],
    ...SAMPLE_ROWS.map((r) => [r.name, r.phone, r.email ?? "", r.company ?? ""]),
  ]
    .map((cols) => `<Row>${cells(cols)}</Row>`)
    .join("");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Contacts">
  <Table>${rows}</Table>
 </Worksheet>
</Workbook>
`;
}

function escapeXml(v: string) {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function looksLikePhone(value: string) {
  return value.replace(/\D/g, "").length >= 8;
}

function parseDelimited(text: string): string[][] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length);
  return lines.map((line) => {
    const delim = line.includes("\t") ? "\t" : ",";
    if (delim === "\t") return line.split("\t").map((c) => c.trim());
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) {
        cells.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
}

function rowsFromTable(table: string[][]): ParsedContact[] {
  if (!table.length) return [];
  const header = table[0].map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const hasHeader = header.includes("name") || header.includes("phone");
  const body = hasHeader ? table.slice(1) : table;
  const nameIdx = hasHeader ? Math.max(0, header.indexOf("name")) : 0;
  const phoneIdx = hasHeader ? (header.indexOf("phone") >= 0 ? header.indexOf("phone") : 1) : 1;
  const emailIdx = hasHeader ? header.indexOf("email") : -1;
  const companyIdx = hasHeader ? header.indexOf("company") : -1;
  const out: ParsedContact[] = [];
  for (const cols of body) {
    let name = (cols[nameIdx] ?? "").trim();
    let phone = (cols[phoneIdx] ?? "").trim();
    if (!hasHeader && cols.length === 1) {
      phone = cols[0] ?? "";
      name = "";
    } else if (!hasHeader && cols.length >= 2 && !looksLikePhone(phone) && looksLikePhone(cols[cols.length - 1] ?? "")) {
      phone = cols[cols.length - 1] ?? "";
      name = cols.slice(0, -1).join(" ").trim();
    }
    if (!phone && name && looksLikePhone(name)) {
      phone = name;
      name = "";
    }
    if (!phone) continue;
    out.push({
      name: name || phone,
      phone,
      email: emailIdx >= 0 ? cols[emailIdx] : undefined,
      company: companyIdx >= 0 ? cols[companyIdx] : undefined,
    });
  }
  return out;
}

function parseSpreadsheetMl(xml: string): ParsedContact[] {
  const rowBlocks = [...xml.matchAll(/<Row\b[\s\S]*?<\/Row>/gi)].map((m) => m[0]);
  const table = rowBlocks.map((row) =>
    [...row.matchAll(/<Data\b[^>]*>([\s\S]*?)<\/Data>/gi)].map((m) =>
      (m[1] ?? "").replace(/<[^>]+>/g, "").trim(),
    ),
  );
  return rowsFromTable(table);
}

/** CSV, TSV, pasted lines, or Excel 2003 XML (.xls). */
export function parseContactText(text: string): ParsedContact[] {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return [];
  if (/urn:schemas-microsoft-com:office:spreadsheet/i.test(trimmed) || /<Workbook[\s>]/i.test(trimmed)) {
    return parseSpreadsheetMl(trimmed);
  }
  if (!trimmed.includes(",") && !trimmed.includes("\t")) {
    return trimmed.split(/\r?\n/).flatMap((line) => {
      const parts = line.trim().split(/\s+/);
      if (!parts.length) return [];
      const last = parts[parts.length - 1] ?? "";
      if (parts.length >= 2 && looksLikePhone(last)) {
        return [{ name: parts.slice(0, -1).join(" "), phone: last }];
      }
      if (looksLikePhone(line)) return [{ name: line.trim(), phone: line.trim() }];
      return [];
    });
  }
  return rowsFromTable(parseDelimited(trimmed));
}

export function downloadBlob(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
