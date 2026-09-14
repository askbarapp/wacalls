import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import {
  createTaskWithReminders,
  markTaskComplete,
  snoozeTaskReminder,
  shiftPendingTasksToTomorrow,
} from "../services/tasks/task-service.js";

const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(300),
  description: z.string().optional().nullable(),
  dueAt: z.string().min(1, "Due date is required"),
  timezone: z.string().default("Asia/Kolkata"),
  priority: z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  contactName: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  assignedPhone: z.string().optional().nullable(),
  recurrence: z.enum(["NEVER", "DAILY", "WEEKLY", "MONTHLY"]).default("NEVER"),
  recurrenceRule: z.string().optional().nullable(),
  channelId: z.string().optional().nullable(),
  reminderOffsets: z.array(z.number()).default([0]),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().optional().nullable(),
  dueAt: z.string().optional(),
  priority: z.enum(["URGENT", "HIGH", "MEDIUM", "LOW"]).optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "SKIPPED", "CANCELLED", "OVERDUE"]).optional(),
  contactName: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  assignedPhone: z.string().optional().nullable(),
  recurrence: z.enum(["NEVER", "DAILY", "WEEKLY", "MONTHLY"]).optional(),
});

export const taskRoutes: FastifyPluginAsync = async (app) => {
  // 1. Stats Bar
  app.get("/tasks/stats", async (req) => {
    const auth = await app.authenticate(req);
    const orgId = auth.orgId;

    const now = new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const [todayCount, upcomingCount, overdueCount, completedCount] = await Promise.all([
      // Today: pending tasks due today
      prisma.businessTask.count({
        where: {
          organizationId: orgId,
          status: { in: ["TODO", "IN_PROGRESS", "PENDING"] },
          dueAt: { gte: startOfToday, lte: endOfToday },
        },
      }),
      // Upcoming: tasks due after today
      prisma.businessTask.count({
        where: {
          organizationId: orgId,
          status: { in: ["TODO", "IN_PROGRESS", "PENDING"] },
          dueAt: { gt: endOfToday },
        },
      }),
      // Overdue: past due and not completed
      prisma.businessTask.count({
        where: {
          organizationId: orgId,
          status: { in: ["TODO", "IN_PROGRESS", "PENDING", "OVERDUE"] },
          dueAt: { lt: startOfToday },
        },
      }),
      // Completed count
      prisma.businessTask.count({
        where: {
          organizationId: orgId,
          status: "COMPLETED",
        },
      }),
    ]);

    return {
      success: true,
      data: {
        todayCount,
        upcomingCount,
        overdueCount,
        completedCount,
      },
    };
  });

  // 2. List Tasks with Filters & Tabs
  app.get("/tasks", async (req) => {
    const auth = await app.authenticate(req);
    const orgId = auth.orgId;

    const query = req.query as {
      tab?: string;
      priority?: string;
      search?: string;
      page?: string;
      pageSize?: string;
    };

    const tab = query.tab || "all";
    const priority = query.priority;
    const search = query.search?.trim();
    const page = Math.max(1, parseInt(query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || "25", 10)));

    const now = new Date();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const where: any = { organizationId: orgId };

    // Tab Filter
    if (tab === "today") {
      where.status = { in: ["TODO", "IN_PROGRESS", "PENDING"] };
      where.dueAt = { gte: startOfToday, lte: endOfToday };
    } else if (tab === "upcoming") {
      where.status = { in: ["TODO", "IN_PROGRESS", "PENDING"] };
      where.dueAt = { gt: endOfToday };
    } else if (tab === "overdue") {
      where.status = { in: ["TODO", "IN_PROGRESS", "PENDING", "OVERDUE"] };
      where.dueAt = { lt: startOfToday };
    } else if (tab === "completed") {
      where.status = "COMPLETED";
    } else if (tab === "recurring") {
      where.recurrence = { not: "NEVER" };
    }

    if (priority && priority !== "ALL") {
      where.priority = priority;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { contactName: { contains: search, mode: "insensitive" } },
        { contactPhone: { contains: search, mode: "insensitive" } },
      ];
    }

    const [total, tasks] = await Promise.all([
      prisma.businessTask.count({ where }),
      prisma.businessTask.findMany({
        where,
        include: {
          reminders: {
            orderBy: { reminderAt: "asc" },
          },
          channel: {
            select: { id: true, displayName: true, phoneNumber: true, ownerPhone: true },
          },
        },
        orderBy: tab === "completed" ? { completedAt: "desc" } : { dueAt: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      success: true,
      data: {
        tasks,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  });

  // 3. Create Task
  app.post("/tasks", async (req, reply) => {
    const auth = await app.authenticate(req);
    const orgId = auth.orgId;
    const body = createTaskSchema.parse(req.body);

    let channelId = body.channelId;
    if (!channelId) {
      const firstChannel = await prisma.whatsAppChannel.findFirst({
        where: { organizationId: orgId },
        select: { id: true, ownerPhone: true },
      });
      channelId = firstChannel?.id;
    }

    const task = await createTaskWithReminders({
      organizationId: orgId,
      channelId: channelId || undefined,
      title: body.title,
      description: body.description || undefined,
      dueAt: new Date(body.dueAt),
      timezone: body.timezone,
      priority: body.priority,
      source: "MANUAL",
      contactName: body.contactName || undefined,
      contactPhone: body.contactPhone || undefined,
      assignedTo: body.assignedTo || "ME",
      assignedPhone: body.assignedPhone || undefined,
      recurrence: body.recurrence,
      recurrenceRule: body.recurrenceRule || undefined,
      reminderOffsets: body.reminderOffsets.length > 0 ? body.reminderOffsets : [0],
    });

    return reply.status(201).send({ success: true, data: task });
  });

  // 4. Update Task
  app.put("/tasks/:id", async (req, reply) => {
    const auth = await app.authenticate(req);
    const orgId = auth.orgId;
    const { id } = req.params as { id: string };
    const body = updateTaskSchema.parse(req.body);

    const existing = await prisma.businessTask.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) {
      return reply.status(404).send({ success: false, error: { message: "Task not found" } });
    }

    const updateData: any = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.contactName !== undefined) updateData.contactName = body.contactName;
    if (body.contactPhone !== undefined) updateData.contactPhone = body.contactPhone;
    if (body.assignedTo !== undefined) updateData.assignedTo = body.assignedTo;
    if (body.assignedPhone !== undefined) updateData.assignedPhone = body.assignedPhone;
    if (body.recurrence !== undefined) updateData.recurrence = body.recurrence;

    if (body.dueAt) {
      const newDue = new Date(body.dueAt);
      updateData.dueAt = newDue;

      // Update future pending reminders to match new dueAt
      await prisma.taskReminder.updateMany({
        where: { taskId: id, status: "PENDING" },
        data: { reminderAt: newDue },
      });
    }

    if (body.status === "COMPLETED" && existing.status !== "COMPLETED") {
      updateData.completedAt = new Date();
      await prisma.taskReminder.updateMany({
        where: { taskId: id, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
    }

    const updated = await prisma.businessTask.update({
      where: { id },
      data: updateData,
      include: { reminders: true },
    });

    return { success: true, data: updated };
  });

  // 5. One-Click Mark Complete
  app.post("/tasks/:id/complete", async (req, reply) => {
    const auth = await app.authenticate(req);
    const orgId = auth.orgId;
    const { id } = req.params as { id: string };

    const task = await markTaskComplete(id, orgId);
    if (!task) {
      return reply.status(404).send({ success: false, error: { message: "Task not found" } });
    }

    return { success: true, data: task };
  });

  // 6. Snooze Task
  app.post("/tasks/:id/snooze", async (req, reply) => {
    const auth = await app.authenticate(req);
    const orgId = auth.orgId;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        minutes: z.number().optional(),
        tomorrow: z.boolean().optional(),
      })
      .parse(req.body || {});

    // Find latest reminder or create a snoozed reminder
    const reminder = await prisma.taskReminder.findFirst({
      where: { taskId: id, organizationId: orgId },
      orderBy: { reminderAt: "desc" },
    });

    if (reminder) {
      const updated = await snoozeTaskReminder(reminder.id, orgId, body);
      return { success: true, data: updated };
    }

    // If no reminder exists, shift task due date directly
    const task = await prisma.businessTask.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!task) {
      return reply.status(404).send({ success: false, error: { message: "Task not found" } });
    }

    let newDue = new Date();
    if (body.tomorrow) {
      newDue.setDate(newDue.getDate() + 1);
      newDue.setHours(9, 0, 0, 0);
    } else {
      newDue = new Date(Date.now() + (body.minutes || 30) * 60 * 1000);
    }

    const updated = await prisma.businessTask.update({
      where: { id },
      data: { dueAt: newDue, status: "TODO" },
    });

    return { success: true, data: updated };
  });

  // 7. Delete / Cancel Task
  app.delete("/tasks/:id", async (req, reply) => {
    const auth = await app.authenticate(req);
    const orgId = auth.orgId;
    const { id } = req.params as { id: string };

    const task = await prisma.businessTask.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!task) {
      return reply.status(404).send({ success: false, error: { message: "Task not found" } });
    }

    // Cancel pending reminders and delete task
    await prisma.taskReminder.updateMany({
      where: { taskId: id },
      data: { status: "CANCELLED" },
    });

    await prisma.businessTask.delete({
      where: { id },
    });

    return { success: true, message: "Task deleted successfully" };
  });

  // 8. Bulk Shift Today's Tasks to Tomorrow Morning (EOD Action)
  app.post("/tasks/shift-tomorrow", async (req) => {
    const auth = await app.authenticate(req);
    const count = await shiftPendingTasksToTomorrow(auth.orgId);
    return { success: true, data: { shiftedCount: count } };
  });
};
