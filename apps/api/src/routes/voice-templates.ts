import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { ConflictError, NotFoundError, ok } from "@wacalls/shared";
import { SarvamClient, SARVAM_LANGUAGES, SARVAM_SPEAKERS, renderVoiceScript } from "@wacalls/audio-engine";
import { resolveSarvamApiKey } from "../services/sarvam-key.js";

const templateBody = z.object({
  name: z.string().min(1),
  body: z.string().min(1),
  language: z.string().default("hi-IN"),
  speaker: z.string().default("shubh"),
  pace: z.number().min(0.5).max(2).default(1),
});

export const voiceTemplateRoutes: FastifyPluginAsync = async (app) => {
  app.get("/voice-templates/options", async (req) => {
    await app.authenticate(req);
    return ok({ languages: SARVAM_LANGUAGES, speakers: SARVAM_SPEAKERS });
  });

  app.get("/voice-templates", async (req) => {
    const auth = await app.authenticate(req);
    return ok(
      await prisma.voiceTemplate.findMany({
        where: { organizationId: auth.orgId },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  app.post("/voice-templates", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const body = templateBody.parse(req.body);
    return ok(await prisma.voiceTemplate.create({ data: { ...body, organizationId: auth.orgId } }));
  });

  app.patch("/voice-templates/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.voiceTemplate.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!existing) throw new NotFoundError("Template not found");
    const body = templateBody.partial().parse(req.body);
    return ok(await prisma.voiceTemplate.update({ where: { id }, data: body }));
  });

  app.delete("/voice-templates/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("campaigns.manage")(req);
    const { id } = req.params as { id: string };
    await prisma.voiceTemplate.deleteMany({ where: { id, organizationId: auth.orgId } });
    return ok({ deleted: true });
  });

  app.post("/voice-templates/preview", async (req, reply) => {
    const auth = await app.authenticate(req);
    const body = z
      .object({
        body: z.string().min(1),
        language: z.string().default("hi-IN"),
        speaker: z.string().default("shubh"),
        pace: z.number().min(0.5).max(2).default(1),
      })
      .parse(req.body);
    const key = await resolveSarvamApiKey(auth.orgId);
    const script = renderVoiceScript(body.body, {
      name: "Rahul",
      phone: "+919876543210",
      email: "rahul@example.com",
    });
    const wav = await new SarvamClient(key).synthesize(script, {
      language: body.language,
      speaker: body.speaker,
      pace: body.pace,
      sampleRate: 16_000,
    });
    return reply
      .header("content-type", "audio/wav")
      .header("content-disposition", 'inline; filename="preview.wav"')
      .send(wav);
  });

  app.post("/voice-templates/:id/preview", async (req, reply) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const tpl = await prisma.voiceTemplate.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!tpl) throw new NotFoundError("Template not found");
    if (!tpl.body.trim()) throw new ConflictError("Template text is empty");
    const key = await resolveSarvamApiKey(auth.orgId);
    const wav = await new SarvamClient(key).synthesize(tpl.body, {
      language: tpl.language,
      speaker: tpl.speaker,
      pace: tpl.pace,
      sampleRate: 16_000,
    });
    return reply
      .header("content-type", "audio/wav")
      .header("content-disposition", `inline; filename="${tpl.name.replace(/[^\w.-]+/g, "_")}.wav"`)
      .send(wav);
  });
};
