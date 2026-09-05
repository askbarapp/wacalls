import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, listOpenSlots, listContactMemories, getContactMemory, saveContactMemoryManual, deleteContactMemory, memoryPhoneKey, intentAnalytics, getMemoryRetentionDays, DEFAULT_MEMORY_RETENTION_DAYS } from "@wacalls/database";
import { NotFoundError, ConflictError, ok } from "@wacalls/shared";
import { okPage, pageMeta, pageQuerySchema } from "../lib/pagination.js";
import {
  SARVAM_CHAT_MODEL,
  GEMINI_CHAT_MODEL,
  extractSarvamApiKey,
  extractGeminiApiKey,
  buildVoiceAgentGreeting,
  buildVoiceAgentSystemPrompt,
  inferSpokenLanguage,
  createVoiceAiClient,
  normalizeVoiceProvider,
  defaultModelForProvider,
  defaultVoiceForProvider,
  voicesForProvider,
  normalizeIntentPlaybook,
  DEFAULT_INTENT_PLAYBOOK,
  DEFAULT_MAX_CALL_DURATION_SEC,
  DEFAULT_WRAP_UP_SEC,
} from "@wacalls/audio-engine";
import {
  hasSarvamApiKey,
  resolveSarvamApiKey,
  hasGeminiApiKey,
  resolveGeminiApiKey,
  resolveVoiceApiKey,
} from "../services/sarvam-key.js";
import { assertAiAgentQuota } from "../services/org.js";

const intentItem = z.object({
  intent: z.string().min(1).max(64),
  examples: z.string().max(2000).default(""),
  reply: z.string().min(1).max(500),
  action: z.enum(["continue", "hangup"]).default("continue"),
});

const aiBody = z.object({
  name: z.string().min(1),
  provider: z.enum(["sarvam", "gemini"]).default("sarvam"),
  model: z.string().default(SARVAM_CHAT_MODEL),
  voice: z.string().optional().default("shubh"),
  language: z.string().default("hi-IN"),
  systemPrompt: z.string().min(1),
  greeting: z.string().optional(),
  objective: z.string().optional(),
  questions: z.string().optional(),
  disallowed: z.string().optional(),
  appointmentMessage: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.4),
  maxTokens: z.number().int().default(400),
  knowledgeBaseId: z.string().uuid().nullable().optional(),
  maxCallDurationSec: z.number().int().min(30).max(900).default(DEFAULT_MAX_CALL_DURATION_SEC),
  wrapUpSec: z.number().int().min(5).max(120).default(DEFAULT_WRAP_UP_SEC),
  memoryRecallMode: z.enum(["related_only", "always", "never"]).default("related_only"),
  intentPlaybook: z.array(intentItem).max(40).optional(),
});

export const aiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/ai/providers", async (req) => {
    const auth = await app.authenticate(req);
    const [sarvam, gemini] = await Promise.all([hasSarvamApiKey(auth.orgId), hasGeminiApiKey(auth.orgId)]);
    return ok({
      sarvam: { configured: sarvam, voices: voicesForProvider("sarvam"), defaultModel: SARVAM_CHAT_MODEL },
      gemini: { configured: gemini, voices: voicesForProvider("gemini"), defaultModel: GEMINI_CHAT_MODEL },
      defaults: {
        maxCallDurationSec: DEFAULT_MAX_CALL_DURATION_SEC,
        wrapUpSec: DEFAULT_WRAP_UP_SEC,
        intentPlaybook: DEFAULT_INTENT_PLAYBOOK,
      },
    });
  });

  app.get("/ai/sarvam", async (req) => {
    const auth = await app.authenticate(req);
    const configured = await hasSarvamApiKey(auth.orgId);
    const row = await prisma.setting.findFirst({
      where: { organizationId: auth.orgId, key: "sarvam_api_key" },
    });
    const key = extractSarvamApiKey(row?.value);
    return ok({
      configured,
      last4: key ? key.slice(-4) : "",
      envFallback: Boolean(process.env.SARVAM_API_KEY || process.env.AI_API_KEY),
    });
  });

  app.put("/ai/sarvam", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const body = z.object({ apiKey: z.string().min(8) }).parse(req.body);
    await prisma.setting.upsert({
      where: { organizationId_key: { organizationId: auth.orgId, key: "sarvam_api_key" } },
      update: { value: { apiKey: body.apiKey.trim() } },
      create: { organizationId: auth.orgId, key: "sarvam_api_key", value: { apiKey: body.apiKey.trim() } },
    });
    return ok({ configured: true, last4: body.apiKey.trim().slice(-4) });
  });

  app.post("/ai/sarvam/test", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const body = z.object({ apiKey: z.string().optional() }).parse(req.body ?? {});
    const pasted = body.apiKey?.trim() ?? "";
    const key =
      pasted.length >= 8 ? pasted : await resolveSarvamApiKey(auth.orgId).catch(() => "");
    if (!key) {
      throw new ConflictError("Paste a Sarvam key first, or save one, then tap Test.");
    }
    const result = await createVoiceAiClient("sarvam", key).testConnection();
    return ok(result);
  });

  app.get("/ai/gemini", async (req) => {
    const auth = await app.authenticate(req);
    const configured = await hasGeminiApiKey(auth.orgId);
    const row = await prisma.setting.findFirst({
      where: { organizationId: auth.orgId, key: "gemini_api_key" },
    });
    const key = extractGeminiApiKey(row?.value);
    return ok({
      configured,
      last4: key ? key.slice(-4) : "",
      envFallback: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    });
  });

  app.put("/ai/gemini", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const body = z.object({ apiKey: z.string().min(8) }).parse(req.body);
    await prisma.setting.upsert({
      where: { organizationId_key: { organizationId: auth.orgId, key: "gemini_api_key" } },
      update: { value: { apiKey: body.apiKey.trim() } },
      create: { organizationId: auth.orgId, key: "gemini_api_key", value: { apiKey: body.apiKey.trim() } },
    });
    return ok({ configured: true, last4: body.apiKey.trim().slice(-4) });
  });

  app.post("/ai/gemini/test", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const body = z.object({ apiKey: z.string().optional() }).parse(req.body ?? {});
    const pasted = body.apiKey?.trim() ?? "";
    const key =
      pasted.length >= 8 ? pasted : await resolveGeminiApiKey(auth.orgId).catch(() => "");
    if (!key) {
      throw new ConflictError("Paste a Gemini key first, or save one, then tap Test.");
    }
    const result = await createVoiceAiClient("gemini", key).testConnection();
    return ok(result);
  });

  app.get("/ai-configs", async (req) => {
    const auth = await app.authenticate(req);
    const [rows, sarvam, gemini] = await Promise.all([
      prisma.aiConfig.findMany({
        where: { organizationId: auth.orgId },
        include: {
          knowledgeBase: { select: { id: true, name: true } },
          appointmentSlots: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] },
          appointments: {
            where: { status: "BOOKED", startsAt: { gte: new Date() } },
            orderBy: { startsAt: "asc" },
            take: 8,
            select: { id: true, phone: true, contactName: true, startsAt: true },
          },
          _count: { select: { appointments: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      hasSarvamApiKey(auth.orgId),
      hasGeminiApiKey(auth.orgId),
    ]);
    return ok({
      configs: rows,
      sarvamConfigured: sarvam,
      geminiConfigured: gemini,
    });
  });

  app.post("/ai-configs", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const body = aiBody.parse(req.body);
    if (!body.knowledgeBaseId) {
      throw new ConflictError("Create a knowledge base first, then assign it to this AI agent.");
    }
    const kb = await prisma.knowledgeBase.findFirst({
      where: { id: body.knowledgeBaseId, organizationId: auth.orgId },
    });
    if (!kb) throw new NotFoundError("Knowledge base not found");
    await assertAiAgentQuota(auth.orgId);
    const playbook = normalizeIntentPlaybook(body.intentPlaybook ?? DEFAULT_INTENT_PLAYBOOK);
    return ok(
      await prisma.aiConfig.create({
        data: {
          ...body,
          intentPlaybook: playbook,
          knowledgeBaseId: body.knowledgeBaseId,
          organizationId: auth.orgId,
        },
      }),
    );
  });

  app.patch("/ai-configs/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.aiConfig.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!existing) throw new NotFoundError("AI agent not found");
    const body = aiBody.partial().parse(req.body);
    return ok(
      await prisma.aiConfig.update({
        where: { id },
        data: {
          ...body,
          ...(body.intentPlaybook !== undefined
            ? { intentPlaybook: normalizeIntentPlaybook(body.intentPlaybook) }
            : {}),
          knowledgeBaseId: body.knowledgeBaseId === null ? null : body.knowledgeBaseId,
        },
      }),
    );
  });

  app.delete("/ai-configs/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { id } = req.params as { id: string };
    await prisma.aiConfig.deleteMany({ where: { id, organizationId: auth.orgId } });
    return ok({ deleted: true });
  });

  app.post(
    "/ai-configs/:id/test",
    { bodyLimit: 2 * 1024 * 1024 },
    async (req) => {
      const auth = await app.authenticate(req);
      const { id } = req.params as { id: string };
      const body = z
        .object({
          contactName: z.string().max(80).optional(),
          text: z.string().max(2000).optional(),
          audioBase64: z.string().max(2_000_000).optional(),
          history: z
            .array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string().max(2000),
              }),
            )
            .max(16)
            .optional(),
        })
        .parse(req.body ?? {});

      const ai = await prisma.aiConfig.findFirst({
        where: { id, organizationId: auth.orgId },
        include: { knowledgeBase: { include: { documents: { take: 40 } } } },
      });
      if (!ai) throw new NotFoundError("AI agent not found");

      const provider = normalizeVoiceProvider(ai.provider);
      const { apiKey } = await resolveVoiceApiKey(auth.orgId, provider);
      const voice = createVoiceAiClient(provider, apiKey);
      const contact = { name: body.contactName?.trim() || "there", phone: "" };
      const history = body.history ?? [];
      const spoken = Boolean(body.audioBase64?.trim());
      const typed = body.text?.trim() ?? "";
      const modelName = ai.model || defaultModelForProvider(provider);

      let transcript: string | undefined;
      let reply: string;
      let replyLanguage = ai.language || "hi-IN";
      if (!spoken && !typed && history.length === 0) {
        reply = buildVoiceAgentGreeting(ai.greeting, contact);
      } else {
        if (spoken) {
          const raw = body.audioBase64!.replace(/^data:audio\/[a-zA-Z0-9.+-]+;base64,/, "");
          const wav = Buffer.from(raw, "base64");
          if (wav.length < 1000) {
            return ok({
              transcript: null,
              reply: null,
              audioBase64: null,
              history,
              listenAgain: true,
              provider,
              model: modelName,
            });
          }
          const stt = await voice.transcribe(wav, "unknown");
          transcript = stt.transcript;
          if (!transcript) {
            return ok({
              transcript: null,
              reply: null,
              audioBase64: null,
              history,
              listenAgain: true,
              provider,
              model: modelName,
            });
          }
          replyLanguage = inferSpokenLanguage(transcript, stt.languageCode, ai.language);
        } else if (typed) {
          transcript = typed;
          replyLanguage = inferSpokenLanguage(transcript, null, ai.language);
        } else {
          throw new ConflictError("Speak to continue the test call.");
        }
        reply = await voice.chat(
          [
            {
              role: "system",
              content: buildVoiceAgentSystemPrompt(
                {
                  ...ai,
                  intentPlaybook: normalizeIntentPlaybook(ai.intentPlaybook),
                  maxCallDurationSec: ai.maxCallDurationSec,
                  wrapUpSec: ai.wrapUpSec,
                },
                contact,
              ),
            },
            ...history.slice(-12),
            { role: "user", content: `[Speak in ${replyLanguage}]\n${transcript}` },
          ],
          {
            model: modelName,
            temperature: Math.min(ai.temperature, 0.45),
            maxTokens: Math.min(ai.maxTokens, 96),
          },
        );
        if (!reply.trim()) throw new ConflictError("AI returned an empty reply. Try again.");
      }

      const wav = await voice.synthesize(reply, {
        language: replyLanguage,
        speaker: ai.voice || defaultVoiceForProvider(provider),
        sampleRate: 16_000,
        pace: 1.08,
      });
      const nextHistory = spoken || typed
        ? [...history, { role: "user" as const, content: transcript ?? "" }, { role: "assistant" as const, content: reply }].slice(-16)
        : [{ role: "assistant" as const, content: reply }];

      return ok({
        transcript: transcript ?? null,
        reply,
        language: replyLanguage,
        audioBase64: wav.toString("base64"),
        mimeType: "audio/wav",
        history: nextHistory,
        provider,
        model: modelName,
      });
    },
  );

  app.get("/ai-configs/:id/appointments", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.aiConfig.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!existing) throw new NotFoundError("AI agent not found");
    const [slots, upcoming, open] = await Promise.all([
      prisma.appointmentSlot.findMany({
        where: { aiConfigId: id },
        orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
      }),
      prisma.appointment.findMany({
        where: { aiConfigId: id, startsAt: { gte: new Date() } },
        orderBy: { startsAt: "asc" },
        take: 40,
      }),
      listOpenSlots(prisma, id),
    ]);
    return ok({ slots, upcoming, open });
  });

  app.post("/ai-configs/:id/appointment-slots", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.aiConfig.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!existing) throw new NotFoundError("AI agent not found");
    const body = z
      .object({
        weekday: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(24 * 60 - 1),
        endMinute: z.number().int().min(1).max(24 * 60),
        durationMin: z.number().int().min(10).max(180).default(30),
        timezone: z.string().default("Asia/Kolkata"),
      })
      .parse(req.body);
    if (body.endMinute <= body.startMinute) throw new ConflictError("End time must be after start time.");
    return ok(
      await prisma.appointmentSlot.create({
        data: { ...body, aiConfigId: id, organizationId: auth.orgId },
      }),
    );
  });

  app.delete("/ai-configs/:id/appointment-slots/:slotId", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { id, slotId } = req.params as { id: string; slotId: string };
    await prisma.appointmentSlot.deleteMany({ where: { id: slotId, aiConfigId: id, organizationId: auth.orgId } });
    return ok({ deleted: true });
  });

  app.get("/ai/memories", async (req) => {
    const auth = await app.authenticate(req);
    const q = pageQuerySchema
      .extend({ q: z.string().optional() })
      .parse(req.query ?? {});
    const result = await listContactMemories(prisma, auth.orgId, {
      q: q.q,
      limit: q.limit,
      page: q.page,
    });
    return okPage(result.rows, pageMeta(result.page, result.limit, result.total));
  });

  app.get("/ai/memories/:phone", async (req) => {
    const auth = await app.authenticate(req);
    const { phone } = req.params as { phone: string };
    const row = await getContactMemory(prisma, auth.orgId, phone);
    if (!row) throw new NotFoundError("No memory for this number yet");
    return ok(row);
  });

  app.put("/ai/memories/:phone", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { phone } = req.params as { phone: string };
    const body = z
      .object({
        summary: z.string().max(1000).nullable().optional(),
        facts: z.array(z.string().max(200)).max(12).optional(),
        lastIntent: z.string().max(80).nullable().optional(),
        optOut: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    if (!memoryPhoneKey(phone)) throw new ConflictError("Enter a valid phone number.");
    return ok(
      await saveContactMemoryManual(prisma, {
        organizationId: auth.orgId,
        phone,
        summary: body.summary,
        facts: body.facts,
        lastIntent: body.lastIntent,
        optOut: body.optOut,
      }),
    );
  });

  app.delete("/ai/memories/:phone", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const { phone } = req.params as { phone: string };
    return ok(await deleteContactMemory(prisma, auth.orgId, phone));
  });

  app.get("/ai/analytics/intents", async (req) => {
    const auth = await app.authenticate(req);
    const q = z
      .object({
        days: z.coerce.number().int().min(1).max(365).optional(),
      })
      .parse(req.query ?? {});
    return ok(await intentAnalytics(prisma, auth.orgId, q.days ?? 30));
  });

  app.get("/ai/memory-settings", async (req) => {
    const auth = await app.authenticate(req);
    const days = await getMemoryRetentionDays(prisma, auth.orgId);
    return ok({ retentionDays: days, defaultDays: DEFAULT_MEMORY_RETENTION_DAYS });
  });

  app.put("/ai/memory-settings", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("ai.manage")(req);
    const body = z
      .object({
        retentionDays: z.number().int().min(0).max(3650),
      })
      .parse(req.body);
    await prisma.setting.upsert({
      where: { organizationId_key: { organizationId: auth.orgId, key: "memory_retention_days" } },
      create: { organizationId: auth.orgId, key: "memory_retention_days", value: { days: body.retentionDays } },
      update: { value: { days: body.retentionDays } },
    });
    return ok({ retentionDays: body.retentionDays });
  });
};
