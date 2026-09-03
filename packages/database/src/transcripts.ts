import type { Prisma, PrismaClient } from "@prisma/client";

export type CallTranscriptRole = "user" | "assistant";

export type CallTranscriptTurn = {
  role: CallTranscriptRole;
  text: string;
  at: string;
};

export type CallTranscript = {
  source: "ai" | "tts";
  language?: string | null;
  turns: CallTranscriptTurn[];
};

function isRole(value: unknown): value is CallTranscriptRole {
  return value === "user" || value === "assistant";
}

export function parseCallTranscript(value: unknown): CallTranscript | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { source?: unknown; language?: unknown; turns?: unknown };
  const source = raw.source === "tts" ? "tts" : raw.source === "ai" ? "ai" : null;
  if (!source || !Array.isArray(raw.turns)) return null;
  const turns = raw.turns
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const turn = row as { role?: unknown; text?: unknown; at?: unknown };
      if (!isRole(turn.role) || typeof turn.text !== "string" || !turn.text.trim()) return null;
      return {
        role: turn.role,
        text: turn.text.trim(),
        at: typeof turn.at === "string" ? turn.at : new Date().toISOString(),
      };
    })
    .filter((row): row is CallTranscriptTurn => Boolean(row));
  return {
    source,
    language: typeof raw.language === "string" ? raw.language : null,
    turns,
  };
}

export function hasCallTranscript(value: unknown): boolean {
  return (parseCallTranscript(value)?.turns.length ?? 0) > 0;
}

export function callTranscriptPayload(value: unknown): CallTranscript {
  return parseCallTranscript(value) ?? { source: "ai", language: null, turns: [] };
}

export async function setCallTranscript(
  db: PrismaClient,
  callId: string,
  transcript: CallTranscript,
): Promise<void> {
  await db.call.update({
    where: { id: callId },
    data: { transcript: transcript as Prisma.InputJsonValue },
  });
}

export async function appendCallTranscriptTurns(
  db: PrismaClient,
  callId: string,
  turns: Array<{ role: CallTranscriptRole; text: string }>,
  meta?: { source?: "ai" | "tts"; language?: string | null },
): Promise<void> {
  const added = turns
    .map((turn) => ({ role: turn.role, text: turn.text.trim() }))
    .filter((turn) => turn.text);
  if (!added.length) return;
  const row = await db.call.findUnique({ where: { id: callId }, select: { transcript: true } });
  if (!row) return;
  const current = parseCallTranscript(row.transcript);
  const now = new Date().toISOString();
  const next: CallTranscript = {
    source: current?.source ?? meta?.source ?? "ai",
    language: current?.language ?? meta?.language ?? null,
    turns: [
      ...(current?.turns ?? []),
      ...added.map((turn) => ({ ...turn, at: now })),
    ],
  };
  await db.call.update({
    where: { id: callId },
    data: { transcript: next as Prisma.InputJsonValue },
  });
}
