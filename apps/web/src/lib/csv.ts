export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export type ListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function emptyMeta(limit: number = 25): ListMeta {
  return { page: 1, limit, total: 0, totalPages: 1 };
}

function escapeCsvCell(value: unknown): string {
  if (value == null) return "";
  const raw = String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replaceAll('"', '""')}"`;
  return raw;
}

/** Build CSV text from header keys + row objects. */
export function rowsToCsv(headers: Array<{ key: string; label: string }>, rows: Array<Record<string, unknown>>) {
  const lines = [headers.map((h) => escapeCsvCell(h.label)).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h.key])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportRowsCsv(
  filename: string,
  headers: Array<{ key: string; label: string }>,
  rows: Array<Record<string, unknown>>,
) {
  downloadCsv(filename, rowsToCsv(headers, rows));
}

/** Walk paginated API responses until all rows are collected (for export). */
export async function fetchAllPages<T>(
  loadPage: (page: number, limit: number) => Promise<{ rows: T[]; meta: ListMeta }>,
  pageSize = 100,
  maxRows = 10_000,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const { rows, meta } = await loadPage(page, pageSize);
    all.push(...rows);
    totalPages = Math.max(1, meta.totalPages || 1);
    page += 1;
    if (all.length >= maxRows) break;
  } while (page <= totalPages);
  return all.slice(0, maxRows);
}
