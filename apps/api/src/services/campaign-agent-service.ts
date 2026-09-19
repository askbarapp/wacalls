import pino from "pino";
import { prisma } from "@wacalls/database";
import { campaignQueue } from "../queues.js";
import { enqueueWebhook } from "./webhooks.js";

const log = pino({ name: "campaign-agent-service", level: process.env.LOG_LEVEL ?? "info" });

export interface CampaignSummaryItem {
  id: string;
  name: string;
  type: string;
  status: string;
  totalContacts: number;
}

/**
 * Returns a summary of campaigns for the WhatsApp Agent.
 */
export async function listCampaignsForAgent(organizationId: string): Promise<string> {
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 6,
    include: {
      _count: {
        select: { campaignContacts: true },
      },
    },
  });

  if (campaigns.length === 0) {
    return `📢 *कोई कैंपेन नहीं मिला!*\n━━━━━━━━━━━━━━━━━━━━\nनया कॉलिंग या मैसेजिंग कैंपेन बनाने के लिए WaCall वेब पोर्टल (Campaigns → New Campaign) खोलें।`;
  }

  let card = `📢 *कॉलिंग व मैसेजिंग कैंपेन स्टेटस* 📊\n━━━━━━━━━━━━━━━━━━━━\n`;
  campaigns.forEach((c, idx) => {
    const statusIcon = c.status === "RUNNING" ? "🟢 चालू (Running)" : c.status === "PAUSED" ? "⏸️ रोका गया (Paused)" : c.status === "COMPLETED" ? "✅ पूर्ण (Completed)" : "📝 ड्राफ्ट (Draft)";
    const typeLabel = c.type === "AI_VOICE" ? "🤖 AI Voice Call" : c.type === "TTS" ? "🗣️ TTS Call" : c.type === "RECORDED" ? "🎙️ Audio Call" : c.type === "MESSAGE" ? "💬 WhatsApp Message" : "📞 Voice Dialer";

    card += `${idx + 1}. *${c.name}*\n   📌 प्रकार: ${typeLabel}\n   📊 स्थिति: ${statusIcon}\n   👥 कुल कॉन्टैक्ट्स: ${c._count.campaignContacts}\n\n`;
  });

  card += `━━━━━━━━━━━━━━━━━━━━\n_कैंपेन शुरू करने के लिए "Start campaign [नाम]" या रोकने के लिए "Pause campaign [नाम]" लिखें।_`;
  return card;
}

/**
 * Starts a campaign by name or ID directly from a WhatsApp command.
 */
export async function startCampaignFromAgent(
  organizationId: string,
  query: string,
): Promise<{ success: boolean; message: string }> {
  const clean = query.trim();
  const campaign = await prisma.campaign.findFirst({
    where: {
      organizationId,
      OR: [
        { id: clean },
        { name: { contains: clean, mode: "insensitive" } },
      ],
    },
  });

  if (!campaign) {
    return {
      success: false,
      message: `⚠️ '${clean}' नाम का कोई कैंपेन नहीं मिला। पहले 'Campaign status' लिखकर लिस्ट देख लें।`,
    };
  }

  if (campaign.status === "RUNNING") {
    return {
      success: true,
      message: `ℹ️ कैंपेन *${campaign.name}* पहले से ही चालू (RUNNING) है!`,
    };
  }

  // Update status to RUNNING
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "RUNNING" },
  });

  // Enqueue run job in BullMQ
  await campaignQueue.add(
    "run",
    { campaignId: campaign.id, organizationId },
    { jobId: `camp-${campaign.id}-${Date.now()}`, removeOnComplete: 100, removeOnFail: 50 },
  );

  await enqueueWebhook(organizationId, "campaign.started", { campaign_id: campaign.id }).catch(() => undefined);

  log.info({ campaignId: campaign.id, name: campaign.name }, "Started campaign via WhatsApp agent");

  return {
    success: true,
    message: `🚀 *कैंपेन सफलतापूर्वक शुरू कर दिया गया!* 🎉\n━━━━━━━━━━━━━━━━━━━━\n📢 *कैंपेन:* ${campaign.name}\n📊 *स्थिति:* 🟢 चालू (Running)\n\nWaCall इंजन अब कतारबद्ध लीड्स को कॉल्स/मैसेज डिलीवर कर रहा है।`,
  };
}

/**
 * Pauses a campaign by name or ID directly from a WhatsApp command.
 */
export async function pauseCampaignFromAgent(
  organizationId: string,
  query: string,
): Promise<{ success: boolean; message: string }> {
  const clean = query.trim();
  const campaign = await prisma.campaign.findFirst({
    where: {
      organizationId,
      OR: [
        { id: clean },
        { name: { contains: clean, mode: "insensitive" } },
      ],
    },
  });

  if (!campaign) {
    return {
      success: false,
      message: `⚠️ '${clean}' नाम का कोई कैंपेन नहीं मिला।`,
    };
  }

  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "PAUSED" },
  });

  log.info({ campaignId: campaign.id, name: campaign.name }, "Paused campaign via WhatsApp agent");

  return {
    success: true,
    message: `⏸️ *कैंपेन रोक दिया गया है (PAUSED)!*\n━━━━━━━━━━━━━━━━━━━━\n📢 *कैंपेन:* ${campaign.name}\nपुनः शुरू करने के लिए *"Start campaign ${campaign.name}"* लिखें।`,
  };
}
