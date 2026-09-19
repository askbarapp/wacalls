import pino from "pino";
import { prisma } from "@wacalls/database";
import { sendWhatsAppText } from "../messaging.js";

const log = pino({ name: "project-service" });

export interface CreateProjectInput {
  organizationId: string;
  channelId?: string | null;
  projectCode?: string;
  title: string;
  description?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  budget?: number | null;
  currency?: string;
  startDate?: string | Date;
  targetDeadline?: string | Date | null;
  status?: string;
  progressPercent?: number;
  healthStatus?: string;
  keyDeliverables?: string[] | null;
  nextStepAction?: string | null;
  nextStepOwner?: string | null;
  nextStepDueAt?: string | Date | null;
  members?: Array<{
    name: string;
    phone: string;
    roleInProject: string;
    isLead?: boolean;
  }>;
  notifyMembersOnWhatsApp?: boolean;
}

export interface LogProjectUpdateInput {
  organizationId: string;
  projectId: string;
  authorName: string;
  authorPhone: string;
  authorRole?: string | null;
  updateText: string;
  source?: "WHATSAPP" | "WEB_PORTAL" | "VOICE_NOTE" | "SYSTEM";
  sentiment?: "POSITIVE" | "NEUTRAL" | "BLOCKED";
  blockers?: string | null;
  nextStepSuggested?: string | null;
  nextStepOwner?: string | null;
  progressPercent?: number | null;
  healthStatus?: "ON_TRACK" | "AT_RISK" | "DELAYED" | null;
  mediaUrls?: string[];
  notifyNextOwnerOnWhatsApp?: boolean;
}

/**
 * Creates a new business project with team member assignments and optional WhatsApp dispatches.
 */
export async function createBusinessProject(input: CreateProjectInput) {
  let code = input.projectCode?.trim();
  if (!code) {
    const count = await prisma.businessProject.count({
      where: { organizationId: input.organizationId },
    });
    code = `PRJ-${String(count + 101).padStart(3, "0")}`;
  }

  const project = await prisma.businessProject.create({
    data: {
      organizationId: input.organizationId,
      channelId: input.channelId || null,
      projectCode: code,
      title: input.title.trim(),
      description: input.description || null,
      clientName: input.clientName || null,
      clientPhone: input.clientPhone || null,
      budget: input.budget != null ? Number(input.budget) : null,
      currency: input.currency || "INR",
      startDate: input.startDate ? new Date(input.startDate) : new Date(),
      targetDeadline: input.targetDeadline ? new Date(input.targetDeadline) : null,
      status: input.status || "PLANNING",
      progressPercent: input.progressPercent ?? 0,
      healthStatus: input.healthStatus || "ON_TRACK",
      keyDeliverables: input.keyDeliverables ? (input.keyDeliverables as any) : [],
      nextStepAction: input.nextStepAction || null,
      nextStepOwner: input.nextStepOwner || null,
      nextStepDueAt: input.nextStepDueAt ? new Date(input.nextStepDueAt) : null,
    },
  });

  // Assign team members
  if (input.members && input.members.length > 0) {
    for (const m of input.members) {
      if (!m.name || !m.phone) continue;
      await prisma.projectMember.create({
        data: {
          projectId: project.id,
          organizationId: input.organizationId,
          name: m.name.trim(),
          phone: m.phone.trim(),
          roleInProject: m.roleInProject?.trim() || "Team Member",
          isLead: Boolean(m.isLead),
        },
      }).catch((err) => log.warn({ err: err?.message }, "Failed to create project member"));
    }
  }

  // Initial timeline log
  await prisma.projectUpdateLog.create({
    data: {
      projectId: project.id,
      organizationId: input.organizationId,
      authorName: "System",
      authorPhone: "System",
      authorRole: "Admin",
      updateText: `🚀 प्रोजेक्ट प्रारंभ किया गया (Project Initiated)। कोड: ${code}`,
      source: "SYSTEM",
      sentiment: "POSITIVE",
      nextStepSuggested: input.nextStepAction || "प्रारंभिक योजना व टीम ब्रीफिंग",
    },
  });

  // Optional: Dispatch WhatsApp assignment notifications to assigned members
  if (input.notifyMembersOnWhatsApp && input.members && input.members.length > 0) {
    const channelId = input.channelId || (await resolveDefaultChannelId(input.organizationId));
    if (channelId) {
      const deadlineStr = input.targetDeadline
        ? new Date(input.targetDeadline).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
        : "जल्द सूचित की जाएगी";

      for (const m of input.members) {
        const messageBody = `🚀 *नए प्रोजेक्ट में आपका स्वागत है!*
━━━━━━━━━━━━━━━━━━━━
📌 *प्रोजेक्ट:* ${project.title} (${project.projectCode})
💼 *आपकी भूमिका:* ${m.roleInProject}
⏰ *डेडलाइन:* ${deadlineStr}
${input.clientName ? `👤 *क्लाइंट:* ${input.clientName}` : ""}
${input.nextStepAction ? `🎯 *पहला कदम:* ${input.nextStepAction}` : ""}

इस प्रोजेक्ट से संबंधित कोई भी दैनिक प्रगति, रुकावट या पूर्ण कार्य इसी WhatsApp चैट में भेजें। TenSy इसे प्रोजेक्ट टाइमलाइन में सुरक्षित दर्ज करेगा! ✨`;

        void sendWhatsAppText({
          organizationId: input.organizationId,
          channelId,
          phone: m.phone,
          body: messageBody,
          chatSource: "bot",
        }).catch((err) => log.warn({ err: err?.message, phone: m.phone }, "Failed to notify project member on WhatsApp"));
      }
    }
  }

  log.info({ projectId: project.id, code }, "Business project created successfully");
  return project;
}

/**
 * Logs an update into a project's living journey timeline and updates project status/progress.
 */
export async function logProjectUpdate(input: LogProjectUpdateInput) {
  const project = await prisma.businessProject.findUnique({
    where: { id: input.projectId },
    include: { members: true },
  });
  if (!project) throw new Error("Project not found");

  const logEntry = await prisma.projectUpdateLog.create({
    data: {
      projectId: input.projectId,
      organizationId: input.organizationId,
      authorName: input.authorName,
      authorPhone: input.authorPhone,
      authorRole: input.authorRole || "Team Member",
      updateText: input.updateText.trim(),
      source: input.source || "WHATSAPP",
      sentiment: input.sentiment || "NEUTRAL",
      blockers: input.blockers || null,
      nextStepSuggested: input.nextStepSuggested || null,
      mediaUrls: input.mediaUrls || [],
    },
  });

  // Calculate updates to parent project
  const projectUpdateData: any = {};
  if (input.progressPercent != null) {
    projectUpdateData.progressPercent = Math.min(100, Math.max(0, input.progressPercent));
    if (input.progressPercent >= 100) {
      projectUpdateData.status = "COMPLETED";
      projectUpdateData.completedAt = new Date();
    }
  }
  if (input.healthStatus) {
    projectUpdateData.healthStatus = input.healthStatus;
  }
  if (input.nextStepSuggested) {
    projectUpdateData.nextStepAction = input.nextStepSuggested;
  }
  if (input.nextStepOwner) {
    projectUpdateData.nextStepOwner = input.nextStepOwner;
  }

  if (Object.keys(projectUpdateData).length > 0) {
    await prisma.businessProject.update({
      where: { id: input.projectId },
      data: projectUpdateData,
    });
  }

  // If next owner has the baton passed and notification is desired
  if (input.notifyNextOwnerOnWhatsApp && input.nextStepOwner) {
    const nextMember = project.members.find(
      (m) =>
        m.name.toLowerCase().includes(input.nextStepOwner!.toLowerCase()) ||
        m.roleInProject.toLowerCase().includes(input.nextStepOwner!.toLowerCase()),
    );

    const channelId = project.channelId || (await resolveDefaultChannelId(input.organizationId));
    if (nextMember && channelId) {
      const batonMessage = `🔔 *प्रोजेक्ट अगला कदम आपके ज़िम्मे (Action Required)!*
━━━━━━━━━━━━━━━━━━━━
📌 *प्रोजेक्ट:* ${project.title} (${project.projectCode})
👤 *पिछला अपडेट:* ${input.authorName} (${input.updateText})
🎯 *अब आपकी बारी है:* ${input.nextStepSuggested || "कृपया अगला कार्य पूर्ण करें"}

कार्य पूरा होने पर इसी चैट में 'Done' या स्टेटस अपडेट भेजें।`;

      void sendWhatsAppText({
        organizationId: input.organizationId,
        channelId,
        phone: nextMember.phone,
        body: batonMessage,
        chatSource: "bot",
      }).catch(() => undefined);
    }
  }

  return logEntry;
}

/**
 * Returns project list with aggregate counts and recent activity for the web dashboard.
 */
export async function getProjectsList(
  organizationId: string,
  filter?: { status?: string; healthStatus?: string; search?: string },
) {
  const where: any = { organizationId };

  if (filter?.status && filter.status !== "ALL") {
    where.status = filter.status;
  }
  if (filter?.healthStatus && filter.healthStatus !== "ALL") {
    where.healthStatus = filter.healthStatus;
  }
  if (filter?.search?.trim()) {
    const s = filter.search.trim();
    where.OR = [
      { title: { contains: s, mode: "insensitive" } },
      { projectCode: { contains: s, mode: "insensitive" } },
      { clientName: { contains: s, mode: "insensitive" } },
    ];
  }

  const projects = await prisma.businessProject.findMany({
    where,
    include: {
      members: {
        select: { id: true, name: true, phone: true, roleInProject: true, isLead: true },
      },
      updates: {
        orderBy: { createdAt: "desc" },
        take: 3,
      },
      tasks: {
        select: { id: true, status: true },
      },
    },
    orderBy: [{ healthStatus: "desc" }, { updatedAt: "desc" }],
  });

  return projects.map((p) => {
    const totalTasks = p.tasks.length;
    const completedTasks = p.tasks.filter((t) => t.status === "COMPLETED").length;

    return {
      id: p.id,
      projectCode: p.projectCode,
      title: p.title,
      description: p.description,
      clientName: p.clientName,
      clientPhone: p.clientPhone,
      budget: p.budget,
      currency: p.currency,
      startDate: p.startDate,
      targetDeadline: p.targetDeadline,
      completedAt: p.completedAt,
      status: p.status,
      progressPercent: p.progressPercent,
      healthStatus: p.healthStatus,
      keyDeliverables: p.keyDeliverables,
      nextStepAction: p.nextStepAction,
      nextStepOwner: p.nextStepOwner,
      nextStepDueAt: p.nextStepDueAt,
      members: p.members,
      recentUpdates: p.updates,
      taskStats: { total: totalTasks, completed: completedTasks },
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  });
}

/**
 * Returns executive dashboard statistics.
 */
export async function getProjectsStats(organizationId: string) {
  const [total, inProgress, review, delayed, completed] = await Promise.all([
    prisma.businessProject.count({ where: { organizationId } }),
    prisma.businessProject.count({ where: { organizationId, status: "IN_PROGRESS" } }),
    prisma.businessProject.count({ where: { organizationId, status: "REVIEW" } }),
    prisma.businessProject.count({ where: { organizationId, healthStatus: "DELAYED" } }),
    prisma.businessProject.count({ where: { organizationId, status: "COMPLETED" } }),
  ]);

  return {
    total,
    inProgress,
    review,
    delayed,
    completed,
    activeCount: inProgress + review,
  };
}

/**
 * Returns the complete chronological journey timeline for a project.
 */
export async function getProjectJourney(organizationId: string, projectId: string) {
  const project = await prisma.businessProject.findFirst({
    where: { id: projectId, organizationId },
    include: {
      members: true,
      updates: {
        orderBy: { createdAt: "desc" },
      },
      tasks: {
        orderBy: { dueAt: "asc" },
      },
    },
  });

  if (!project) throw new Error("Project not found");
  return project;
}

/**
 * Compiles a daily multi-project executive summary card for WhatsApp (Owner EOD briefing).
 */
export async function compileDailyProjectDigest(organizationId: string): Promise<string> {
  const activeProjects = await prisma.businessProject.findMany({
    where: {
      organizationId,
      status: { in: ["PLANNING", "IN_PROGRESS", "REVIEW"] },
    },
    include: {
      members: true,
      updates: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });

  if (activeProjects.length === 0) {
    return "ℹ️ वर्तमान में कोई सक्रिय प्रोजेक्ट नहीं है। नया प्रोजेक्ट पोर्टल पर बनाएं!";
  }

  let digest = `🏗️ *दैनिक प्रोजेक्ट सुपरविज़न रिपोर्ट (${activeProjects.length} Active Projects)*\n━━━━━━━━━━━━━━━━━━━━\n`;

  activeProjects.forEach((p, idx) => {
    const healthEmoji = p.healthStatus === "ON_TRACK" ? "🟢 On-Track" : p.healthStatus === "AT_RISK" ? "🟡 At-Risk" : "🔴 Delayed";
    const deadlineStr = p.targetDeadline
      ? new Date(p.targetDeadline).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
      : "Open";

    const lastUpdate = p.updates[0]
      ? `• *ताज़ा अपडेट:* ${p.updates[0].authorName}: "${p.updates[0].updateText.slice(0, 70)}..."`
      : "• *अपडेट:* कोई नया अपडेट दर्ज नहीं हुआ";

    digest += `\n*${idx + 1}. ${p.title}* (${p.projectCode})
📊 प्रगति: ${p.progressPercent}% | स्थिति: ${healthEmoji}
⏰ डेडलाइन: ${deadlineStr} | टीम: ${p.members.length} सदस्य
${lastUpdate}
${p.nextStepAction ? `🎯 *अगला कदम:* ${p.nextStepAction} (${p.nextStepOwner || "Team"})` : ""}
━━━━━━━━━━━━━━━━━━━━`;
  });

  digest += `\nकिसी प्रोजेक्ट पर अपडेट देने के लिए WhatsApp पर लिखें: *"Project [कोड/नाम] update: [संदेश]"*`;
  return digest;
}

/**
 * Helper to resolve the primary WhatsApp channel for an organization.
 */
async function resolveDefaultChannelId(organizationId: string): Promise<string | null> {
  const channel = await prisma.whatsAppChannel.findFirst({
    where: { organizationId, status: "CONNECTED" },
    select: { id: true },
  });
  if (channel) return channel.id;

  const anyChannel = await prisma.whatsAppChannel.findFirst({
    where: { organizationId },
    select: { id: true },
  });
  return anyChannel?.id || null;
}
