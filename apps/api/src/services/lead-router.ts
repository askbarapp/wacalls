import { prisma } from "@wacalls/database";
import pino from "pino";

const log = pino({ name: "lead-router", level: process.env.LOG_LEVEL ?? "info" });
const WHATSAPP_URL = process.env.WHATSAPP_URL ?? "http://whatsapp:4010";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? "";

export interface RouteInboundLeadInput {
  organizationId: string;
  channelId: string;
  phone: string;
  text: string;
  conversationId: string;
  contactId?: string | null;
}

export interface RouteInboundLeadResult {
  matched: boolean;
  ruleId?: string;
  ruleName?: string;
  assignType?: string;
  assignedUserId?: string | null;
  assignedUserName?: string | null;
  assignedGroupJid?: string | null;
  assignedGroupName?: string | null;
  autoReplied?: boolean;
}

async function sendWhatsAppMessage(channelId: string, phoneOrJid: string, text: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${WHATSAPP_URL}/internal/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": INTERNAL_TOKEN,
      },
      body: JSON.stringify({ channelId, phone: phoneOrJid, text }),
    });
    const json = (await res.json()) as { id?: string; data?: { id?: string }; error?: { message?: string } };
    if (!res.ok) {
      log.warn({ phoneOrJid, err: json.error?.message }, "lead-router: sendWhatsAppMessage failed");
      return undefined;
    }
    return json.id ?? json.data?.id;
  } catch (err) {
    log.warn({ phoneOrJid, err }, "lead-router: sendWhatsAppMessage network error");
    return undefined;
  }
}

export function matchesLeadCondition(text: string, matchType: string, matchContent: string): boolean {
  const normText = text.trim().toLowerCase();
  const normPattern = matchContent.trim().toLowerCase();
  if (!normPattern) return false;

  switch (matchType.toUpperCase()) {
    case "EXACT":
      return normText === normPattern;
    case "STARTS_WITH":
      return normText.startsWith(normPattern);
    case "REGEX":
      try {
        const regex = new RegExp(matchContent.trim(), "i");
        return regex.test(text.trim());
      } catch {
        return false;
      }
    case "CONTAINS":
    default:
      return normText.includes(normPattern);
  }
}

export async function routeInboundLead(input: RouteInboundLeadInput): Promise<RouteInboundLeadResult> {
  const { organizationId, channelId, phone, text, conversationId, contactId } = input;

  // 1. Fetch active rules for this organization (ordered by priority descending, createdAt ascending)
  const rules = await (prisma as any).leadRoutingRule.findMany({
    where: {
      organizationId,
      enabled: true,
      OR: [{ channelId: null }, { channelId }],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    include: {
      assignedUser: {
        select: { id: true, name: true, phone: true },
      },
    },
  });

  if (!rules || rules.length === 0) {
    return { matched: false };
  }

  // 2. Find first matching rule
  const matchedRule = rules.find((r: any) => matchesLeadCondition(text, r.matchType, r.matchContent));
  if (!matchedRule) {
    return { matched: false };
  }

  log.info(
    { ruleId: matchedRule.id, ruleName: matchedRule.name, phone },
    "lead-router: Inbound message matched lead routing rule",
  );

  let assignedUserId: string | null = null;
  let assignedUserName: string | null = null;
  let assignedUserPhone: string | null = null;
  let assignedGroupJid: string | null = null;
  let assignedGroupName: string | null = null;

  // 3. Determine assignment based on assignType
  if (matchedRule.assignType === "USER") {
    assignedUserId = matchedRule.assignedUserId ?? null;
    if (matchedRule.assignedUser) {
      assignedUserName = matchedRule.assignedUser.name;
      assignedUserPhone = matchedRule.assignedUser.phone ?? null;
    }
  } else if (matchedRule.assignType === "GROUP") {
    assignedGroupJid = matchedRule.assignedGroupJid ?? null;
    assignedGroupName = matchedRule.assignedGroupName ?? "WhatsApp Group";
  } else if (matchedRule.assignType === "ROUND_ROBIN" && matchedRule.roundRobinUserIds?.length > 0) {
    const userPool = matchedRule.roundRobinUserIds as string[];
    const nextIdx = matchedRule.lastAssignedIndex % userPool.length;
    assignedUserId = userPool[nextIdx] ?? null;

    if (assignedUserId) {
      const poolUser = await prisma.user.findUnique({
        where: { id: assignedUserId },
        select: { id: true, name: true, phone: true },
      });
      if (poolUser) {
        assignedUserName = poolUser.name;
        assignedUserPhone = poolUser.phone ?? null;
      }
    }

    await (prisma as any).leadRoutingRule.update({
      where: { id: matchedRule.id },
      data: { lastAssignedIndex: nextIdx + 1 },
    }).catch((err: unknown) => log.warn({ err }, "lead-router: failed to update round robin index"));
  }

  // 4. Update or tag the Contact in CRM
  if (contactId) {
    try {
      const contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (contact) {
        const existingTags = new Set(contact.tags || []);
        if (matchedRule.leadTags && Array.isArray(matchedRule.leadTags)) {
          for (const t of matchedRule.leadTags) {
            existingTags.add(t);
          }
        }
        existingTags.add("lead");
        existingTags.add(matchedRule.sourcePlatform.toLowerCase());

        await prisma.contact.update({
          where: { id: contactId },
          data: {
            tags: Array.from(existingTags),
          },
        });
      }
    } catch (err) {
      log.warn({ err, contactId }, "lead-router: failed to update contact tags");
    }
  }

  // 5. Update ChatConversation with assignment, leadStage, workCategory, intent
  try {
    await prisma.chatConversation.update({
      where: { id: conversationId },
      data: {
        assignedUserId: assignedUserId ?? undefined,
        leadStage: matchedRule.leadStage ?? "NEW",
        workCategory: matchedRule.sourcePlatform,
        intent: matchedRule.name,
        status: "HANDOFF",
      },
    });
  } catch (err) {
    log.warn({ err, conversationId }, "lead-router: failed to update conversation");
  }

  const assignedTargetName =
    assignedUserName ||
    assignedGroupName ||
    (matchedRule.assignType === "ROUND_ROBIN" ? "Team Pool" : "Unassigned");

  const timestamp = new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });

  // 6. Forward alert to WhatsApp Group if enabled
  if (matchedRule.notifyGroup && matchedRule.notifyGroupJid) {
    const groupAlert = [
      "🚨 *New Inbound Lead Alert!*",
      `📍 *Source:* ${matchedRule.sourcePlatform} (${matchedRule.name})`,
      `👤 *Lead Number:* ${phone}`,
      `💬 *Message:* "${text}"`,
      `🎯 *Assigned To:* ${assignedTargetName}`,
      `⏰ *Time:* ${timestamp}`,
    ].join("\n");

    void sendWhatsAppMessage(channelId, matchedRule.notifyGroupJid, groupAlert);
  }

  // 7. Send direct WhatsApp notification to the assigned agent if enabled
  if (matchedRule.notifyAssignee && assignedUserPhone) {
    const agentAlert = [
      "👋 *New Lead Assigned to You!*",
      `📍 *Source:* ${matchedRule.sourcePlatform} (${matchedRule.name})`,
      `👤 *Contact:* ${phone}`,
      `💬 *Message:* "${text}"`,
      "Please review and contact the lead promptly.",
    ].join("\n");

    void sendWhatsAppMessage(channelId, assignedUserPhone, agentAlert);
  }

  // 8. Auto-reply to customer if configured
  let autoReplied = false;
  if (matchedRule.autoReplyCustomer && matchedRule.autoReplyText) {
    void sendWhatsAppMessage(channelId, phone, matchedRule.autoReplyText);
    autoReplied = true;
  }

  // 9. Record LeadRoutingLog for historical tracking and portal analytics
  try {
    await (prisma as any).leadRoutingLog.create({
      data: {
        organizationId,
        ruleId: matchedRule.id,
        phone,
        incomingText: text,
        assignType: matchedRule.assignType,
        assignedUserId: assignedUserId ?? null,
        assignedUserName: assignedUserName ?? null,
        assignedGroupJid: assignedGroupJid ?? null,
        assignedGroupName: assignedGroupName ?? null,
        notifiedGroupJid: matchedRule.notifyGroupJid ?? null,
        notifiedGroupName: matchedRule.notifyGroupName ?? null,
        autoReplied,
        status: "SUCCESS",
      },
    });
  } catch (err) {
    log.warn({ err }, "lead-router: failed to create lead routing log");
  }

  return {
    matched: true,
    ruleId: matchedRule.id,
    ruleName: matchedRule.name,
    assignType: matchedRule.assignType,
    assignedUserId,
    assignedUserName,
    assignedGroupJid,
    assignedGroupName,
    autoReplied,
  };
}
