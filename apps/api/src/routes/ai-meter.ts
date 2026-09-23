import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { ok } from "@wacalls/shared";
import { createVoiceAiClient } from "@wacalls/audio-engine";
import {
  hasSarvamApiKey,
  resolveSarvamApiKey,
  hasGeminiApiKey,
  resolveGeminiApiKey,
} from "../services/sarvam-key.js";

const DEFAULT_MONTHLY_AI_QUOTA = 5000;

export const aiMeterRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /ai/meter
   * Returns real-time AI quota meter ("kilometer gauge"), provider status, and bot health diagnostics
   */
  app.get("/ai/meter", async (req) => {
    const auth = await app.authenticate(req);
    const orgId = auth.orgId;

    // Time ranges for usage counts
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      todayCount,
      monthCount,
      totalCount,
      handoffCount,
      openCount,
      sarvamConfigured,
      geminiConfigured,
      channels,
    ] = await Promise.all([
      // AI messages sent today
      prisma.chatMessage.count({
        where: {
          organizationId: orgId,
          source: { in: ["ai", "bot"] },
          createdAt: { gte: startOfToday },
        },
      }),
      // AI messages sent this month
      prisma.chatMessage.count({
        where: {
          organizationId: orgId,
          source: { in: ["ai", "bot"] },
          createdAt: { gte: startOfMonth },
        },
      }),
      // Total AI messages ever sent
      prisma.chatMessage.count({
        where: {
          organizationId: orgId,
          source: { in: ["ai", "bot"] },
        },
      }),
      // Conversations currently paused in HANDOFF mode
      prisma.chatConversation.count({
        where: {
          organizationId: orgId,
          status: "HANDOFF",
        },
      }),
      // Active conversations handled by AI bot
      prisma.chatConversation.count({
        where: {
          organizationId: orgId,
          status: "OPEN",
        },
      }),
      // Provider keys availability
      hasSarvamApiKey(orgId),
      hasGeminiApiKey(orgId),
      // Connected channels and their bot status
      prisma.whatsAppChannel.findMany({
        where: { organizationId: orgId },
        select: {
          id: true,
          displayName: true,
          phoneNumber: true,
          status: true,
          chatBot: {
            select: {
              id: true,
              enabled: true,
              aiEnabled: true,
              aiConfig: {
                select: { id: true, name: true, provider: true, model: true },
              },
            },
          },
        },
      }),
    ]);

    const monthlyQuota = DEFAULT_MONTHLY_AI_QUOTA;
    const percentUsed = Math.min(100, Math.round((monthCount / monthlyQuota) * 100));

    // Active AI provider
    const activeProvider = sarvamConfigured ? "sarvam" : geminiConfigured ? "gemini" : "none";

    const channelDiagnostics = channels.map((c) => ({
      channelId: c.id,
      displayName: c.displayName,
      phoneNumber: c.phoneNumber,
      whatsappStatus: c.status,
      hasBotRecord: Boolean(c.chatBot),
      botEnabled: Boolean(c.chatBot?.enabled),
      aiEnabled: Boolean(c.chatBot?.aiEnabled),
      agentName: c.chatBot?.aiConfig?.name ?? "Default Assistant",
      engineProvider: c.chatBot?.aiConfig?.provider ?? (sarvamConfigured ? "sarvam" : "gemini"),
      statusLabel: !c.chatBot
        ? "Not Initialized (Auto-recovers on next message)"
        : !c.chatBot.enabled
        ? "Disabled (OFF)"
        : !c.chatBot.aiEnabled
        ? "Keywords Only (AI OFF)"
        : "Healthy & Active",
    }));

    return ok({
      usage: {
        todayCount,
        monthCount,
        totalCount,
        monthlyQuota,
        percentUsed,
        handoffCount,
        openCount,
      },
      providers: {
        active: activeProvider,
        sarvam: {
          configured: sarvamConfigured,
          model: "sarvam-105b-conversations",
          name: "Sarvam AI 105B (Indian Languages / English)",
        },
        gemini: {
          configured: geminiConfigured,
          model: "gemini-3.6-flash",
          name: "Google Gemini Flash",
        },
      },
      channels: channelDiagnostics,
    });
  });

  /**
   * POST /ai/meter/test
   * Pings the active AI provider in real-time and measures round-trip latency (ms)
   */
  app.post("/ai/meter/test", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);

    const body = z
      .object({
        provider: z.enum(["sarvam", "gemini"]).optional(),
      })
      .parse(req.body ?? {});

    const targetProvider =
      body.provider ||
      ((await hasSarvamApiKey(auth.orgId)) ? "sarvam" : "gemini");

    let apiKey = "";
    try {
      apiKey =
        targetProvider === "gemini"
          ? await resolveGeminiApiKey(auth.orgId)
          : await resolveSarvamApiKey(auth.orgId);
    } catch {
      return ok({
        ok: false,
        provider: targetProvider,
        latencyMs: 0,
        status: 400,
        message: `${targetProvider.toUpperCase()} API key is not configured. Please add an API key in AI calling -> API keys.`,
      });
    }

    const t0 = Date.now();
    try {
      const client = createVoiceAiClient(targetProvider, apiKey);
      const result = await client.testConnection();
      const latencyMs = Date.now() - t0;

      return ok({
        ok: result.ok,
        provider: targetProvider,
        latencyMs,
        status: result.status,
        message: result.message,
      });
    } catch (err: any) {
      const latencyMs = Date.now() - t0;
      return ok({
        ok: false,
        provider: targetProvider,
        latencyMs,
        status: 500,
        message: err?.message || "Connection failed to AI provider",
      });
    }
  });

  /**
   * POST /ai/meter/resume-all
   * Resumes all conversations currently locked in HANDOFF mode back to OPEN
   */
  app.post("/ai/meter/resume-all", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("chatbot.inbox")(req);

    const result = await prisma.chatConversation.updateMany({
      where: {
        organizationId: auth.orgId,
        status: "HANDOFF",
      },
      data: {
        status: "OPEN",
        optOut: false,
      },
    });

    return ok({
      resumedCount: result.count,
      message: `Successfully resumed ${result.count} conversation${result.count === 1 ? "" : "s"} to AI Bot.`,
    });
  });
};
