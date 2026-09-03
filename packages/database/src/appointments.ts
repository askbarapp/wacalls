import type { PrismaClient } from "@prisma/client";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type OpenSlot = {
  slotId: string;
  startsAt: Date;
  endsAt: Date;
  label: string;
};

function tzOffsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  }).formatToParts(at);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+5:30";
  const match = /([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name.replace("GMT", "").replace("UTC", ""));
  if (!match) return 5.5 * 3600_000;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0)) * 60_000;
}

function atLocal(tz: string, year: number, month: number, day: number, minuteOfDay: number): Date {
  const utc = Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  return new Date(utc - tzOffsetMs(tz, new Date(utc)));
}

function ymdInTz(tz: string, date: Date): { year: number; month: number; day: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday ?? "Mon"] ?? 1,
  };
}

export function formatSlotLabel(startsAt: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(startsAt);
}

export async function listOpenSlots(
  db: PrismaClient,
  aiConfigId: string,
  daysAhead = 14,
): Promise<OpenSlot[]> {
  const templates = await db.appointmentSlot.findMany({
    where: { aiConfigId, isActive: true },
  });
  if (!templates.length) return [];
  const booked = await db.appointment.findMany({
    where: {
      aiConfigId,
      status: "BOOKED",
      startsAt: { gte: new Date() },
    },
    select: { startsAt: true },
  });
  const taken = new Set(booked.map((row) => row.startsAt.toISOString()));
  const out: OpenSlot[] = [];
  const now = Date.now();
  for (let d = 0; d < daysAhead && out.length < 12; d += 1) {
    const cursor = new Date(now + d * 86400_000);
    for (const tpl of templates) {
      const local = ymdInTz(tpl.timezone, cursor);
      if (local.weekday !== tpl.weekday) continue;
      for (let minute = tpl.startMinute; minute + tpl.durationMin <= tpl.endMinute; minute += tpl.durationMin) {
        const startsAt = atLocal(tpl.timezone, local.year, local.month, local.day, minute);
        if (startsAt.getTime() < now + 15 * 60_000) continue;
        if (taken.has(startsAt.toISOString())) continue;
        out.push({
          slotId: tpl.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + tpl.durationMin * 60_000),
          label: formatSlotLabel(startsAt, tpl.timezone),
        });
        if (out.length >= 12) break;
      }
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function slotsPrompt(slots: OpenSlot[]): string {
  if (!slots.length) return "No appointment slots are open. Do not offer a booking.";
  return [
    "You can book an appointment. Offer one of these exact times if they agree:",
    ...slots.map((s, i) => `${i + 1}. ${s.label}`),
    "When they confirm a time, say it back, then on a NEW line write only: <<BOOK:ISO8601>> using that slot's exact start time in ISO.",
    "Never speak the BOOK tag out loud.",
  ].join("\n");
}

export function parseBookTag(reply: string): { spoken: string; iso: string | null } {
  const match = reply.match(/<<BOOK:([^>]+)>>/i);
  const spoken = reply.replace(/<<BOOK:[^>]+>>/gi, "").replace(/\s+\n/g, "\n").trim();
  return { spoken, iso: match?.[1]?.trim() ?? null };
}

export async function bookAppointment(
  db: PrismaClient,
  input: {
    organizationId: string;
    aiConfigId: string;
    channelId: string;
    contactId?: string | null;
    callId?: string | null;
    phone: string;
    contactName?: string | null;
    iso: string;
    slots: OpenSlot[];
  },
) {
  const wanted = Date.parse(input.iso);
  if (!Number.isFinite(wanted)) return null;
  const slot = input.slots.find((s) => Math.abs(s.startsAt.getTime() - wanted) < 6 * 60_000);
  if (!slot) return null;
  const existing = await db.appointment.findFirst({
    where: { aiConfigId: input.aiConfigId, startsAt: slot.startsAt, status: "BOOKED" },
  });
  if (existing) return existing;
  return db.appointment.create({
    data: {
      organizationId: input.organizationId,
      aiConfigId: input.aiConfigId,
      slotId: slot.slotId,
      channelId: input.channelId,
      contactId: input.contactId ?? undefined,
      callId: input.callId ?? undefined,
      phone: input.phone,
      contactName: input.contactName ?? undefined,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      status: "BOOKED",
    },
  });
}

export function reminderBody(template: string | null | undefined, name: string | null, startsAt: Date, tz = "Asia/Kolkata") {
  const when = formatSlotLabel(startsAt, tz);
  const raw =
    template?.trim() ||
    "Namaste {{name}}, aapka appointment {{datetime}} par booked hai. Kripya time par available rahein.";
  return raw.replaceAll("{{name}}", name?.trim() || "ji").replaceAll("{{datetime}}", when);
}

export { DAYS };
