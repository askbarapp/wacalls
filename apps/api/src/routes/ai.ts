import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, listOpenSlots } from "@wacalls/database";
import { NotFoundError, ConflictError, ok } from "@wacalls/shared";
import { SARVAM_CHAT_MODEL, extractSarvamApiKey, SarvamClient, buildVoiceAgentGreeting, buildVoiceAgentSystemPrompt, inferSpokenLanguage } from "@wacalls/audio-engine";
import { hasSarvamApiKey, resolveSarvamApiKey } from "../services/sarvam-key.js";
import { assertAiAgentQuota } from "../services/org.js";

const aiBody = z.object({
  name: z.string().min(1),
  provider: z.string().default("sarvam"),
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
});

export const aiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/ai/sarvam", async (req) => {
    const auth = await app.authenticate(req);
    const configured = await hasSarvamApiKey(auth.orgId);
    const row = await prisma.setting.findFirst({
      where: { organizationId: auth.orgId, key: "sarvam_api_key" },
    });
    const key = extractSarvamApiKey(row?.value);
    return ok({ configured, last4: key ? key.slice(-4) : "", envFallback: Boolean(process.env.SARVAM_API_KEY || process.env.AI_API_KEY) });
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
      pasted.length >= 8
        ? pasted
        : await resolveSarvamApiKey(auth.orgId).catch(() => "");
    if (!key) {
      throw new ConflictError("Paste a Sarvam key first, or save one, then tap Test.");
    }
    const result = await new SarvamClient(key).testConnection();
    return ok(result);
  });
  app.get("/ai-configs", async (req) => {
    const auth = await app.authenticate(req);
    const [rows, sarvam] = await Promise.all([
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
    ]);
    return ok({ configs: rows, sarvamConfigured: sarvam });
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
    return ok(
      await prisma.aiConfig.create({
        data: {
          ...body,
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
        data: { ...body, knowledgeBaseId: body.knowledgeBaseId === null ? null : body.knowledgeBaseId },
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

      const key = await resolveSarvamApiKey(auth.orgId);
      const sarvam = new SarvamClient(key);
      const contact = { name: body.contactName?.trim() || "there", phone: "" };
      const history = body.history ?? [];
      const spoken = Boolean(body.audioBase64?.trim());
      const typed = body.text?.trim() ?? "";

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
              provider: "sarvam",
              model: ai.model || SARVAM_CHAT_MODEL,
            });
          }
          const stt = await sarvam.transcribe(wav, "unknown");
          transcript = stt.transcript;
          if (!transcript) {
            return ok({
              transcript: null,
              reply: null,
              audioBase64: null,
              history,
              listenAgain: true,
              provider: "sarvam",
              model: ai.model || SARVAM_CHAT_MODEL,
            });
          }
          replyLanguage = inferSpokenLanguage(transcript, stt.languageCode, ai.language);
        } else if (typed) {
          transcript = typed;
          replyLanguage = inferSpokenLanguage(transcript, null, ai.language);
        } else {
          throw new ConflictError("Speak to continue the test call.");
        }
        reply = await sarvam.chat(
          [
            { role: "system", content: buildVoiceAgentSystemPrompt(ai, contact) },
            ...history.slice(-12),
            { role: "user", content: `[Speak in ${replyLanguage}]\n${transcript}` },
          ],
          {
            model: ai.model || SARVAM_CHAT_MODEL,
            temperature: Math.min(ai.temperature, 0.45),
            maxTokens: Math.min(ai.maxTokens, 96),
          },
        );
        if (!reply.trim()) throw new ConflictError("Sarvam returned an empty reply. Try again.");
      }

      const wav = await sarvam.synthesize(reply, {
        language: replyLanguage,
        speaker: ai.voice || "shubh",
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
        provider: "sarvam",
        model: ai.model || SARVAM_CHAT_MODEL,
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
};
