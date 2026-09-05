import type { PrismaClient } from "@prisma/client";

export type ContactMemoryRecord = {
  id: string;
  organizationId: string;
  phone: string;
  summary: string | null;
  facts: string[];
  lastIntent: string | null;
  lastOutcome: string | null;
  callCount: number;
  lastCallAt: Date | null;
  optOut: boolean;
};

export const DEFAULT_MEMORY_RETENTION_DAYS = 90;

export function memoryPhoneKey(raw: string): string {
  return raw.replace(/\D/g, "");
}

function factsFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean).slice(0, 12);
}

function toRecord(row: {
  id: string;
  organizationId: string;
  phone: string;
  summary: string | null;
  facts: unknown;
  lastIntent: string | null;
  lastOutcome: string | null;
  callCount: number;
  lastCallAt: Date | null;
  optOut: boolean;
}): ContactMemoryRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    phone: row.phone,
    summary: row.summary,
    facts: factsFromJson(row.facts),
    lastIntent: row.lastIntent,
    lastOutcome: row.lastOutcome,
    callCount: row.callCount,
    lastCallAt: row.lastCallAt,
    optOut: row.optOut,
  };
}

export async function getContactMemory(
  db: PrismaClient,
  organizationId: string,
  phone: string,
): Promise<ContactMemoryRecord | null> {
  const key = memoryPhoneKey(phone);
  if (!key) return null;
  const row = await db.contactMemory.findUnique({
    where: { organizationId_phone: { organizationId, phone: key } },
  });
  if (!row) return null;
  return toRecord(row);
}

export function formatMemoryForPrompt(
  memory: ContactMemoryRecord | null | undefined,
  mode: "related_only" | "always" | "never" = "related_only",
): string {
  if (!memory || memory.optOut || mode === "never") return "";
  const lines = [
    mode === "always"
      ? "Caller memory (organization-wide for this phone). Briefly acknowledge relevant past context when greeting or when it helps."
      : "Caller memory (organization-wide for this phone). Only mention it if the current topic is related — never force a recall.",
    memory.summary ? `Last summary: ${memory.summary}` : "",
    memory.facts.length ? `Known facts: ${memory.facts.join("; ")}` : "",
    memory.lastIntent ? `Last notable intent: ${memory.lastIntent}` : "",
    memory.lastCallAt ? `Last call: ${memory.lastCallAt.toISOString()}` : "",
    `Prior calls with this number: ${memory.callCount}`,
  ].filter(Boolean);
  return lines.join("\n");
}

export async function upsertContactMemory(
  db: PrismaClient,
  input: {
    organizationId: string;
    phone: string;
    summary?: string | null;
    facts?: string[];
    lastIntent?: string | null;
    lastOutcome?: string | null;
    callId?: string | null;
  },
): Promise<ContactMemoryRecord | null> {
  const key = memoryPhoneKey(input.phone);
  if (!key) throw new Error("Invalid phone for contact memory");
  const existing = await db.contactMemory.findUnique({
    where: { organizationId_phone: { organizationId: input.organizationId, phone: key } },
  });
  if (existing?.optOut) return toRecord(existing);

  const mergedFacts = [
    ...factsFromJson(existing?.facts),
    ...(input.facts ?? []),
  ]
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f, i, arr) => arr.findIndex((x) => x.toLowerCase() === f.toLowerCase()) === i)
    .slice(0, 12);

  const row = await db.contactMemory.upsert({
    where: { organizationId_phone: { organizationId: input.organizationId, phone: key } },
    create: {
      organizationId: input.organizationId,
      phone: key,
      summary: input.summary?.trim() || null,
      facts: mergedFacts,
      lastIntent: input.lastIntent ?? null,
      lastOutcome: input.lastOutcome ?? null,
      callCount: 1,
      lastCallAt: new Date(),
      lastCallId: input.callId ?? null,
    },
    update: {
      summary: input.summary?.trim() || existing?.summary || null,
      facts: mergedFacts,
      lastIntent: input.lastIntent ?? existing?.lastIntent ?? null,
      lastOutcome: input.lastOutcome ?? existing?.lastOutcome ?? null,
      callCount: { increment: 1 },
      lastCallAt: new Date(),
      lastCallId: input.callId ?? existing?.lastCallId ?? null,
    },
  });

  return toRecord(row);
}

export async function listContactMemories(
  db: PrismaClient,
  organizationId: string,
  opts?: { q?: string; limit?: number },
): Promise<ContactMemoryRecord[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const q = opts?.q?.trim();
  const rows = await db.contactMemory.findMany({
    where: {
      organizationId,
      ...(q
        ? {
            OR: [
              { phone: { contains: q.replace(/\D/g, "") || q } },
              { summary: { contains: q, mode: "insensitive" } },
              { lastIntent: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastCallAt: "desc" }, { updatedAt: "desc" }],
    take: limit,
  });
  return rows.map(toRecord);
}

export async function deleteContactMemory(db: PrismaClient, organizationId: string, phone: string) {
  const key = memoryPhoneKey(phone);
  if (!key) return { deleted: false };
  const result = await db.contactMemory.deleteMany({ where: { organizationId, phone: key } });
  return { deleted: result.count > 0 };
}

/** Manual edit without incrementing callCount. */
export async function saveContactMemoryManual(
  db: PrismaClient,
  input: {
    organizationId: string;
    phone: string;
    summary?: string | null;
    facts?: string[];
    lastIntent?: string | null;
    optOut?: boolean;
  },
): Promise<ContactMemoryRecord> {
  const key = memoryPhoneKey(input.phone);
  if (!key) throw new Error("Invalid phone for contact memory");
  const facts = (input.facts ?? [])
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f, i, arr) => arr.findIndex((x) => x.toLowerCase() === f.toLowerCase()) === i)
    .slice(0, 12);
  const row = await db.contactMemory.upsert({
    where: { organizationId_phone: { organizationId: input.organizationId, phone: key } },
    create: {
      organizationId: input.organizationId,
      phone: key,
      summary: input.summary?.trim() || null,
      facts,
      lastIntent: input.lastIntent?.trim() || null,
      callCount: 0,
      optOut: input.optOut ?? false,
    },
    update: {
      summary: input.summary?.trim() || null,
      facts,
      lastIntent: input.lastIntent?.trim() || null,
      ...(input.optOut !== undefined ? { optOut: input.optOut } : {}),
    },
  });
  return toRecord(row);
}

export async function getMemoryRetentionDays(db: PrismaClient, organizationId: string): Promise<number> {
  const row = await db.setting.findFirst({
    where: { organizationId, key: "memory_retention_days" },
  });
  const raw = row?.value;
  const n =
    typeof raw === "number"
      ? raw
      : raw && typeof raw === "object" && "days" in (raw as object)
        ? Number((raw as { days: unknown }).days)
        : Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MEMORY_RETENTION_DAYS;
  return Math.min(Math.max(Math.floor(n), 0), 3650);
}

/** Deletes memories not touched within retention window. days=0 means keep forever. */
export async function purgeExpiredContactMemories(db: PrismaClient): Promise<number> {
  const orgs = await db.organization.findMany({ select: { id: true } });
  let deleted = 0;
  for (const org of orgs) {
    const days = await getMemoryRetentionDays(db, org.id);
    if (days <= 0) continue;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const result = await db.contactMemory.deleteMany({
      where: {
        organizationId: org.id,
        optOut: false,
        OR: [{ lastCallAt: { lt: cutoff } }, { lastCallAt: null, updatedAt: { lt: cutoff } }],
      },
    });
    deleted += result.count;
  }
  // Also drop old intent events past 180 days to keep analytics table lean.
  const intentCutoff = new Date(Date.now() - 180 * 86_400_000);
  await db.intentEvent.deleteMany({ where: { createdAt: { lt: intentCutoff } } });
  return deleted;
}

export async function recordIntentEvent(
  db: PrismaClient,
  input: {
    organizationId: string;
    aiConfigId?: string | null;
    callId?: string | null;
    phone?: string | null;
    intent: string;
    action?: string | null;
    utterance?: string | null;
  },
) {
  return db.intentEvent.create({
    data: {
      organizationId: input.organizationId,
      aiConfigId: input.aiConfigId ?? null,
      callId: input.callId ?? null,
      phone: input.phone ? memoryPhoneKey(input.phone) : null,
      intent: input.intent.slice(0, 64),
      action: input.action?.slice(0, 32) ?? null,
      utterance: input.utterance?.trim().slice(0, 280) || null,
    },
  });
}

export async function intentAnalytics(
  db: PrismaClient,
  organizationId: string,
  days = 30,
): Promise<{
  days: number;
  total: number;
  byIntent: Array<{ intent: string; count: number; hangups: number }>;
  recent: Array<{ intent: string; action: string | null; phone: string | null; createdAt: Date; utterance: string | null }>;
}> {
  const since = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 86_400_000);
  const rows = await db.intentEvent.findMany({
    where: { organizationId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const map = new Map<string, { count: number; hangups: number }>();
  for (const row of rows) {
    const cur = map.get(row.intent) ?? { count: 0, hangups: 0 };
    cur.count += 1;
    if (row.action === "hangup") cur.hangups += 1;
    map.set(row.intent, cur);
  }
  const byIntent = [...map.entries()]
    .map(([intent, v]) => ({ intent, count: v.count, hangups: v.hangups }))
    .sort((a, b) => b.count - a.count);
  return {
    days,
    total: rows.length,
    byIntent,
    recent: rows.slice(0, 25).map((r) => ({
      intent: r.intent,
      action: r.action,
      phone: r.phone,
      createdAt: r.createdAt,
      utterance: r.utterance,
    })),
  };
}

/** Parse a compact memory update from the model: SUMMARY:...\nFACT:...\nINTENT:... */
export function parseMemoryUpdate(raw: string): {
  summary: string;
  facts: string[];
  lastIntent: string | null;
} {
  const summaryMatch = /SUMMARY:\s*(.+)/i.exec(raw);
  const intentMatch = /INTENT:\s*(.+)/i.exec(raw);
  const facts = [...raw.matchAll(/FACT:\s*(.+)/gi)].map((m) => m[1]!.trim()).filter(Boolean);
  return {
    summary: (summaryMatch?.[1] || raw).trim().slice(0, 500),
    facts: facts.slice(0, 8),
    lastIntent: intentMatch?.[1]?.trim().slice(0, 80) || null,
  };
}
