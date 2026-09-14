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
