import pino from "pino";
import { prisma } from "@wacalls/database";

const log = pino({ name: "task-service", level: process.env.LOG_LEVEL ?? "info" });

export interface CreateTaskInput {
  organizationId: string;
  channelId?: string | null;
  title: string;
  description?: string | null;
  dueAt?: Date | string | null;
  timezone?: string;
  priority?: "URGENT" | "HIGH" | "MEDIUM" | "LOW";
  status?: string;
  source?: "WHATSAPP" | "EMAIL" | "CALL" | "MANUAL" | "AI" | "SYSTEM";
  sourceReference?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  assignedTo?: string | null;
  assignedPhone?: string | null;
  recurrence?: string | null;
  recurrenceRule?: string | null;
  reminderOffsets?: number[]; // minutes before dueAt (e.g. [0, 60] = at time and 1h before)
}

/**
 * Creates a new Business Task and its decoupled Task Reminder records.
 */
export async function createTaskWithReminders(input: CreateTaskInput) {
  let channelId = input.channelId;
  if (!channelId) {
    const firstChan = await prisma.whatsAppChannel.findFirst({
      where: { organizationId: input.organizationId },
      select: { id: true, ownerPhone: true },
    });
    channelId = firstChan?.id;
  }

  if (!channelId) {
    throw new Error("No active WhatsApp channel found for organization");
  }

  const channel = await prisma.whatsAppChannel.findUnique({
    where: { id: channelId },
  });

  const targetPhone = input.assignedPhone || channel?.ownerPhone || "";

  const dueAtDate = input.dueAt ? new Date(input.dueAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const priority = input.priority || "MEDIUM";
  const timezone = input.timezone || "Asia/Kolkata";
  const source = input.source || "MANUAL";
  const status = input.status || "TODO";

  const task = await prisma.businessTask.create({
    data: {
      organizationId: input.organizationId,
      channelId,
      title: input.title,
      description: input.description || null,
      dueAt: dueAtDate,
      timezone,
      priority,
      status,
      source,
      sourceReference: input.sourceReference || null,
      contactName: input.contactName || null,
      contactPhone: input.contactPhone || null,
      assignedTo: input.assignedTo || "Me",
      assignedPhone: targetPhone || null,
      recurrence: input.recurrence || "NEVER",
      recurrenceRule: input.recurrenceRule || null,
    },
  });

  // Create decoupled reminders
  const offsets = input.reminderOffsets && input.reminderOffsets.length > 0 ? input.reminderOffsets : [0];
  const now = new Date();

  for (const offset of offsets) {
    const reminderTime = new Date(dueAtDate.getTime() - offset * 60 * 1000);
    // Only schedule if reminder is in the future (or at most 1 min in the past)
    if (reminderTime.getTime() > now.getTime() - 60 * 1000) {
      await prisma.taskReminder.create({
        data: {
          taskId: task.id,
          organizationId: input.organizationId,
          channelId,
          reminderAt: reminderTime,
          status: "PENDING",
          recipientPhone: targetPhone,
        },
      });
    }
  }

  log.info({ taskId: task.id, title: task.title, dueAt: task.dueAt }, "Created task with reminders");
  const fullTask = await prisma.businessTask.findUnique({
    where: { id: task.id },
    include: { reminders: true },
  });
  return fullTask || task;
}

/**
 * Marks a task completed, cancels all its pending reminders, and schedules the next cycle if recurring.
 */
export async function markTaskComplete(taskId: string, organizationId: string) {
  const task = await prisma.businessTask.findFirst({
    where: { id: taskId, organizationId },
  });

  if (!task) {
    throw new Error("Task not found");
  }

  const updated = await prisma.businessTask.update({
    where: { id: taskId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  // Cancel all remaining pending reminders for this task
  await prisma.taskReminder.updateMany({
    where: { taskId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  // If task is recurring, schedule next cycle
  if (task.recurrence && task.recurrence !== "NEVER" && task.dueAt) {
    let nextDue = new Date(task.dueAt);
    if (task.recurrence === "DAILY") {
      nextDue.setDate(nextDue.getDate() + 1);
    } else if (task.recurrence === "WEEKLY") {
      nextDue.setDate(nextDue.getDate() + 7);
    } else if (task.recurrence === "MONTHLY") {
      nextDue.setMonth(nextDue.getMonth() + 1);
    }

    // Spawn next recurrence
    await createTaskWithReminders({
      organizationId: task.organizationId,
      channelId: task.channelId,
      title: task.title,
      description: task.description,
      dueAt: nextDue,
      timezone: task.timezone,
      priority: task.priority as any,
      source: "SYSTEM",
      sourceReference: `recurring-${task.id}`,
      contactName: task.contactName,
      contactPhone: task.contactPhone,
      assignedTo: task.assignedTo,
      assignedPhone: task.assignedPhone,
      recurrence: task.recurrence,
      recurrenceRule: task.recurrenceRule,
      reminderOffsets: [0],
    }).catch((err) => log.warn({ err: err?.message }, "Failed to spawn next recurring task"));
  }

  return updated;
}

/**
 * Marks all pending/todo/in-progress tasks as completed for today or all time.
 */
export async function completeAllTasks(input: {
  organizationId: string;
  channelId?: string;
  assignedPhone?: string | null;
  assignedName?: string | null;
  scope?: "TODAY" | "ALL" | "OVERDUE";
}): Promise<{ count: number; completedCount: number; tasks: Array<{ id: string; title: string }> }> {
  const { startOfTodayUtc, endOfTodayUtc } = getIstDateBoundaries();

  const whereClause: any = {
    organizationId: input.organizationId,
    status: { in: ["TODO", "IN_PROGRESS", "PENDING", "OVERDUE"] },
  };

  if (input.channelId) {
    whereClause.channelId = input.channelId;
  }

  if (input.assignedPhone) {
    whereClause.OR = [
      { assignedPhone: input.assignedPhone },
      ...(input.assignedName ? [{ assignedTo: input.assignedName }] : []),
    ];
  }

  if (input.scope === "TODAY") {
    whereClause.dueAt = { lte: endOfTodayUtc };
  } else if (input.scope === "OVERDUE") {
    whereClause.dueAt = { lt: startOfTodayUtc };
  }

  const tasksToComplete = await prisma.businessTask.findMany({
    where: whereClause,
    orderBy: { dueAt: "asc" },
  });

  if (tasksToComplete.length === 0) {
    return { count: 0, completedCount: 0, tasks: [] };
  }

  const taskIds = tasksToComplete.map((t) => t.id);

  await prisma.businessTask.updateMany({
    where: { id: { in: taskIds } },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  // Cancel all pending reminders for these tasks
  await prisma.taskReminder.updateMany({
    where: { taskId: { in: taskIds }, status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  log.info({ count: tasksToComplete.length, organizationId: input.organizationId }, "Completed all tasks in bulk");

  return {
    count: tasksToComplete.length,
    completedCount: tasksToComplete.length,
    tasks: tasksToComplete.map((t) => ({ id: t.id, title: t.title })),
  };
}

/**
 * Snoozes a reminder by specified minutes or shifts to tomorrow.
 */
export async function snoozeTaskReminder(
  reminderId: string,
  organizationId: string,
  options: { minutes?: number; tomorrow?: boolean },
) {
  const reminder = await prisma.taskReminder.findFirst({
    where: { id: reminderId, organizationId },
    include: { task: true },
  });

  if (!reminder) {
    throw new Error("Reminder not found");
  }

  let newReminderTime: Date;
  if (options.tomorrow) {
    // Tomorrow at 9:00 AM IST
    const now = new Date();
    const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffsetMs);
    istNow.setUTCDate(istNow.getUTCDate() + 1);
    // 9:00 AM IST is 03:30 UTC
    newReminderTime = new Date(
      Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 3, 30, 0, 0),
    );
  } else {
    const mins = options.minutes || 30;
    newReminderTime = new Date(Date.now() + mins * 60 * 1000);
  }

  const updated = await prisma.taskReminder.update({
    where: { id: reminderId },
    data: {
      reminderAt: newReminderTime,
      status: "PENDING",
    },
  });

  // Also update task due date if it's shifted to tomorrow
  if (options.tomorrow && reminder.task) {
    await prisma.businessTask.update({
      where: { id: reminder.task.id },
      data: { dueAt: newReminderTime, status: "TODO" },
    });
  }

  return updated;
}

/**
 * Bulk shifts all overdue and today's pending tasks to tomorrow morning (EOD shift).
 */
export async function shiftPendingTasksToTomorrow(organizationId: string) {
  const now = new Date();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  // Tomorrow 9:00 AM IST (03:30 UTC)
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istTomorrow = new Date(now.getTime() + istOffsetMs + 24 * 60 * 60 * 1000);
  const tomorrowMorning = new Date(
    Date.UTC(istTomorrow.getUTCFullYear(), istTomorrow.getUTCMonth(), istTomorrow.getUTCDate(), 3, 30, 0, 0),
  );

  const pendingTasks = await prisma.businessTask.findMany({
    where: {
      organizationId,
      status: { in: ["TODO", "IN_PROGRESS", "PENDING", "OVERDUE"] },
      dueAt: { lte: endOfToday },
    },
  });

  for (const t of pendingTasks) {
    await prisma.businessTask.update({
      where: { id: t.id },
      data: { dueAt: tomorrowMorning, status: "TODO" },
    });

    // Reschedule reminder
    await prisma.taskReminder.updateMany({
      where: { taskId: t.id, status: { in: ["PENDING", "SNOOZED", "SENT"] } },
      data: { reminderAt: tomorrowMorning, status: "PENDING" },
    });
  }

  return { shiftedCount: pendingTasks.length, newDueAt: tomorrowMorning };
}

export function getIstDateBoundaries(refDate: Date = new Date()) {
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istNow = new Date(refDate.getTime() + istOffsetMs);

  const y = istNow.getUTCFullYear();
  const m = istNow.getUTCMonth();
  const d = istNow.getUTCDate();

  const startOfTodayUtc = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - istOffsetMs);
  const endOfTodayUtc = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - istOffsetMs);

  return {
    startOfTodayUtc,
    endOfTodayUtc,
    istDateStr: `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  };
}

export interface CategorizedTasks {
  overdue: any[];
  today: any[];
  upcoming: any[];
  formattedSummary: string;
}

/**
 * Retrieves tasks strictly categorized by date in Asia/Kolkata (IST):
 * - Overdue (Past uncompleted tasks with their original dates)
 * - Today (Tasks scheduled for today)
 * - Upcoming (Future scheduled tasks)
 */
export async function getTasksCategorized(params: {
  organizationId: string;
  assignedPhone?: string | null;
  assignedName?: string | null;
  botName?: string;
}): Promise<CategorizedTasks> {
  const { startOfTodayUtc, endOfTodayUtc } = getIstDateBoundaries();
  const botName = params.botName || "TenSy";

  const baseWhere: any = {
    organizationId: params.organizationId,
    status: { in: ["TODO", "IN_PROGRESS", "PENDING", "OVERDUE"] },
  };

  if (params.assignedPhone || params.assignedName) {
    const filters: any[] = [];
    if (params.assignedPhone) {
      filters.push({ assignedPhone: { contains: params.assignedPhone.slice(-10) } });
    }
    if (params.assignedName) {
      filters.push({ assignedTo: { contains: params.assignedName, mode: "insensitive" } });
    }
    if (filters.length > 0) {
      baseWhere.OR = filters;
    }
  }

  // 1. Overdue / Incomplete from past dates
  const overdue = await prisma.businessTask.findMany({
    where: {
      ...baseWhere,
      dueAt: { lt: startOfTodayUtc },
    },
    include: {
      reminders: { where: { status: "PENDING" }, orderBy: { reminderAt: "asc" } },
    },
    orderBy: { dueAt: "asc" },
    take: 10,
  });

  // 2. Today's tasks
  const today = await prisma.businessTask.findMany({
    where: {
      ...baseWhere,
      dueAt: { gte: startOfTodayUtc, lte: endOfTodayUtc },
    },
    include: {
      reminders: { where: { status: "PENDING" }, orderBy: { reminderAt: "asc" } },
    },
    orderBy: { dueAt: "asc" },
    take: 15,
  });

  // 3. Upcoming tasks (next 7 days)
  const nextWeekUtc = new Date(endOfTodayUtc.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcoming = await prisma.businessTask.findMany({
    where: {
      ...baseWhere,
      dueAt: { gt: endOfTodayUtc, lte: nextWeekUtc },
    },
    orderBy: { dueAt: "asc" },
    take: 5,
  });

  const todayDateFormatted = new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  let msg = `📋 *${botName} — कार्य व शेड्यूल विवरण* 🎯\n━━━━━━━━━━━━━━━━━━━━\n`;

  // Section A: Overdue / Incomplete tasks from past dates
  if (overdue.length > 0) {
    msg += `\n🔴 *अधूरे कार्य (Incomplete / Past Dates - ${overdue.length}):*\n`;
    overdue.forEach((t, i) => {
      const pastDate = t.dueAt
        ? new Date(t.dueAt).toLocaleDateString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "numeric",
            month: "short",
          })
        : "Past";
      const contact = t.contactName ? ` (${t.contactName})` : "";
      msg += `${i + 1}. [${pastDate}] *${t.title}*${contact} — ⏳ *अभी अधूरा है*\n`;
    });
  }

  // Section B: Today's tasks
  msg += `\n🟢 *आज के कार्य (Today, ${todayDateFormatted} - ${today.length}):*\n`;
  if (today.length === 0) {
    msg += `• _आज के लिए कोई पेंडिंग कार्य नहीं है।_\n`;
  } else {
    today.forEach((t, i) => {
      const pEmoji = t.priority === "URGENT" ? "🚨" : t.priority === "HIGH" ? "⚡" : "📌";
      const timeStr = t.dueAt
        ? new Date(t.dueAt).toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "समय तय नहीं";
      const contact = t.contactName ? ` (${t.contactName})` : "";
      const statusText = t.status === "IN_PROGRESS" ? " [🔵 प्रगति पर]" : "";
      msg += `${i + 1}. ${pEmoji} *${t.title}*${contact}\n   ⏰ ${timeStr}${statusText}\n`;
    });
  }

  // Section C: Upcoming tasks (brief hint)
  if (upcoming.length > 0) {
    msg += `\n🔵 *आगामी कार्य (Upcoming - ${upcoming.length}):*\n`;
    upcoming.slice(0, 3).forEach((t, i) => {
      const upDate = t.dueAt
        ? new Date(t.dueAt).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Upcoming";
      msg += `${i + 1}. *${t.title}* — ${upDate}\n`;
    });
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━\n_किसी कार्य को पूर्ण करने पर "Done 1" या समय बदलने पर "Reschedule 1 kal 2 baje" लिखें।_`;

  return {
    overdue,
    today,
    upcoming,
    formattedSummary: msg,
  };
}

/**
 * Creates multiple tasks at once (used in morning planner or multi-item voice notes).
 */
export async function createMultipleTasks(
  organizationId: string,
  channelId: string,
  tasks: Array<Omit<CreateTaskInput, "organizationId" | "channelId">>,
) {
  const created: any[] = [];
  for (const item of tasks) {
    try {
      const t = await createTaskWithReminders({
        organizationId,
        channelId,
        ...item,
      });
      created.push(t);
    } catch (err: any) {
      log.warn({ err: err?.message, title: item.title }, "Failed to create one of multiple tasks");
    }
  }
  return created;
}

