import pino from "pino";
import { prisma } from "@wacalls/database";
import { getIstDateBoundaries } from "./tasks/task-service.js";

const log = pino({ name: "team-performance", level: process.env.LOG_LEVEL ?? "info" });

export interface MemberPerformanceCard {
  name: string;
  phone: string;
  role: string;
  completedTodayCount: number;
  pendingTodayCount: number;
  overdueCount: number;
}

/**
 * Generates an executive team accountability scorecard for the Business Owner.
 */
export async function getTeamPerformanceScorecard(params: {
  organizationId: string;
  channelId: string;
  filterMemberName?: string | null;
}): Promise<{ members: MemberPerformanceCard[]; formattedSummary: string }> {
  const { startOfTodayUtc, endOfTodayUtc } = getIstDateBoundaries();

  // Fetch active team members
  const commanderMembers = await prisma.commanderMember.findMany({
    where: {
      channelId: params.channelId,
      enabled: true,
      ...(params.filterMemberName
        ? { name: { contains: params.filterMemberName, mode: "insensitive" } }
        : {}),
    },
    select: { name: true, phone: true, role: true },
  });

  const memberCards: MemberPerformanceCard[] = [];

  for (const m of commanderMembers) {
    const cleanPhoneSuffix = m.phone.replace(/\D/g, "").slice(-10);

    const memberWhere = {
      organizationId: params.organizationId,
      OR: [
        { assignedTo: { contains: m.name, mode: "insensitive" as const } },
        { assignedPhone: { contains: cleanPhoneSuffix } },
      ],
    };

    // 1. Completed today
    const completedTodayCount = await prisma.businessTask.count({
      where: {
        ...memberWhere,
        status: "COMPLETED",
        completedAt: { gte: startOfTodayUtc, lte: endOfTodayUtc },
      },
    });

    // 2. Pending today
    const pendingTodayCount = await prisma.businessTask.count({
      where: {
        ...memberWhere,
        status: { in: ["TODO", "IN_PROGRESS", "PENDING"] },
        dueAt: { gte: startOfTodayUtc, lte: endOfTodayUtc },
      },
    });

    // 3. Overdue / Past incomplete
    const overdueCount = await prisma.businessTask.count({
      where: {
        ...memberWhere,
        status: { in: ["TODO", "IN_PROGRESS", "PENDING", "OVERDUE"] },
        dueAt: { lt: startOfTodayUtc },
      },
    });

    memberCards.push({
      name: m.name,
      phone: m.phone,
      role: m.role,
      completedTodayCount,
      pendingTodayCount,
      overdueCount,
    });
  }

  // Build formatted WhatsApp message
  const todayFormatted = new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  let summary = `👥 *टीम परफॉर्मेंस व अकाउंटेबिलिटी स्कोरकार्ड* 📊\n📅 ${todayFormatted}\n━━━━━━━━━━━━━━━━━━━━\n`;

  if (memberCards.length === 0) {
    summary += `• _कोई एक्टिव टीम मेंबर्स कॉन्फ़िगर नहीं हैं।_\n(टीम जोड़ने के लिए Settings → Commander Members खोलें)`;
  } else {
    memberCards.forEach((c, idx) => {
      const statusIcon = c.overdueCount > 0 ? "⚠️" : c.completedTodayCount > 0 ? "🟢" : "⏳";
      summary += `${idx + 1}. *${c.name}* [${c.role}]\n`;
      summary += `   ${statusIcon} आज पूरे किए: *${c.completedTodayCount}* कार्य\n`;
      summary += `   ⏳ आज पेंडिंग: *${c.pendingTodayCount}* कार्य\n`;
      if (c.overdueCount > 0) {
        summary += `   🔴 पुराने छूटे कार्य: *${c.overdueCount}* (अतिदेय)\n`;
      }
      summary += `\n`;
    });

    const totalCompleted = memberCards.reduce((s, m) => s + m.completedTodayCount, 0);
    const totalPending = memberCards.reduce((s, m) => s + m.pendingTodayCount, 0);
    const totalOverdue = memberCards.reduce((s, m) => s + m.overdueCount, 0);

    summary += `━━━━━━━━━━━━━━━━━━━━\n📌 *टीम कुल योग:* ${totalCompleted} पूर्ण | ${totalPending} पेंडिंग | ${totalOverdue} अतिदेय`;
  }

  return { members: memberCards, formattedSummary: summary };
}
