import pino from "pino";
import { prisma } from "@wacalls/database";
import { sendWhatsAppText } from "../messaging.js";

const log = pino({ name: "task-scheduler", level: process.env.LOG_LEVEL ?? "info" });

let isRunning = false;

/**
 * Runs periodically (every 30 seconds) to process due task reminders and mark overdue tasks.
 */
export async function processTaskRemindersTick(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date();

    // 1. Fetch due reminders (within last 3 hours to now)
    const dueReminders = await prisma.taskReminder.findMany({
      where: {
        status: "PENDING",
        reminderAt: { lte: now },
      },
      include: {
        task: true,
        channel: true,
      },
      take: 20,
    });

    for (const reminder of dueReminders) {
      try {
        const task = reminder.task;
        if (!task || task.status === "COMPLETED" || task.status === "CANCELLED") {
          await prisma.taskReminder.update({
            where: { id: reminder.id },
            data: { status: "CANCELLED" },
          });
          continue;
        }

        const recipientPhone = reminder.recipientPhone || reminder.channel?.ownerPhone;
        if (!recipientPhone) {
          log.warn({ reminderId: reminder.id }, "No recipient phone for task reminder");
          await prisma.taskReminder.update({
            where: { id: reminder.id },
            data: { status: "CANCELLED" },
          });
          continue;
        }

        const priorityEmoji =
          task.priority === "URGENT"
            ? "🚨"
            : task.priority === "HIGH"
            ? "⚡"
            : "📌";

        const dueTimeFormatted = task.dueAt
          ? new Date(task.dueAt).toLocaleTimeString("en-IN", {
              timeZone: "Asia/Kolkata",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "Today";

        const contactStr = task.contactName
          ? `\n👤 *Contact:* ${task.contactName}${task.contactPhone ? ` (${task.contactPhone})` : ""}`
          : "";

        const descStr = task.description ? `\n📝 _${task.description.slice(0, 150)}_` : "";

        const options = task.contactPhone
          ? `━━━━━━━━━━━━━━━━━━━━\nReply to this message:\n*1* → ✅ Mark as Done\n*2* → ⏰ Snooze 30 Min\n*3* → 🌙 Snooze to Tomorrow (9 AM)\n*4* → 📞 Call ${task.contactName || "Contact"}\n*5* → 🤖 Delegate to AI (AI खुद कॉल/मैसेज फॉलो-अप करे)`
          : `━━━━━━━━━━━━━━━━━━━━\nReply to this message:\n*1* → ✅ Mark as Done\n*2* → ⏰ Snooze 30 Min\n*3* → 🌙 Snooze to Tomorrow (9 AM)\n*5* → 🤖 Delegate to AI (AI फॉलो-अप करे)`;

        const alertBody = `⏰ *TASK REMINDER* ${priorityEmoji}
━━━━━━━━━━━━━━━━━━━━
📌 *${task.title}*${contactStr}${descStr}
⏰ *Scheduled For:* ${dueTimeFormatted}
${options}`;

        // Create PendingAction for 1-tap interactive response
        await prisma.pendingAction.create({
          data: {
            organizationId: reminder.organizationId,
            channelId: reminder.channelId,
            actionType: "TASK_REMINDER_ACTION",
            summary: `Task Reminder: ${task.title}`,
            status: "PENDING",
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2h interactive window
            payload: {
              taskId: task.id,
              reminderId: reminder.id,
              title: task.title,
              contactName: task.contactName,
              contactPhone: task.contactPhone,
              dueAt: task.dueAt,
            },
          },
        });

        // Dispatch WhatsApp message
        await sendWhatsAppText({
          organizationId: reminder.organizationId,
          channelId: reminder.channelId,
          phone: recipientPhone,
          body: alertBody,
          chatSource: "bot",
        });

        // Mark reminder sent
        await prisma.taskReminder.update({
          where: { id: reminder.id },
          data: { status: "SENT", sentAt: new Date() },
        });

        log.info({ taskId: task.id, phone: recipientPhone }, "Delivered task reminder via WhatsApp");
      } catch (remErr: any) {
        log.warn({ err: remErr?.message, reminderId: reminder.id }, "Failed to send task reminder");
      }
    }

    // 2. Mark overdue tasks (due date passed by > 1 hour and still TODO)
    const overdueCutoff = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.businessTask.updateMany({
      where: {
        status: { in: ["TODO", "PENDING"] },
        dueAt: { lte: overdueCutoff },
      },
      data: { status: "OVERDUE" },
    });
  } catch (err: any) {
    log.error({ err: err?.message }, "Critical error in processTaskRemindersTick");
  } finally {
    isRunning = false;
  }
}
