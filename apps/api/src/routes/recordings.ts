import type { FastifyPluginAsync } from "fastify";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { prisma } from "@wacalls/database";
import { ConflictError, MAX_UPLOAD_AUDIO_DURATION_MS, NotFoundError, ok } from "@wacalls/shared";
import { env } from "../env.js";
import { probeAudioDurationMs } from "../services/audio-duration.js";
import { z } from "zod";

export const recordingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/recordings", async (req) => {
    const auth = await app.authenticate(req);
    return ok(
      await prisma.recording.findMany({
        where: { organizationId: auth.orgId },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  app.post("/recordings", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("recordings.manage")(req);
    const file = await req.file();
    if (!file) throw new ConflictError("Audio file required");
    const ext = path.extname(file.filename).toLowerCase();
    if (![".wav", ".mp3"].includes(ext)) throw new ConflictError("Only WAV and MP3 are accepted");
    const dir = path.join(env.RECORDINGS_DIR, auth.orgId);
    await mkdir(dir, { recursive: true });
    const stored = `${crypto.randomUUID()}${ext}`;
    const filePath = path.join(dir, stored);
    await pipeline(file.file, createWriteStream(filePath));

    let durationMs = 0;
    try {
      durationMs = await probeAudioDurationMs(filePath, ext);
    } catch {
      await unlink(filePath).catch(() => undefined);
      throw new ConflictError("Could not read audio duration. Upload a valid WAV or MP3.");
    }
    if (durationMs > MAX_UPLOAD_AUDIO_DURATION_MS) {
      await unlink(filePath).catch(() => undefined);
      throw new ConflictError("Audio must be 3 minutes or shorter.");
    }

    const byteSize = existsSync(filePath) ? statSync(filePath).size : Number(file.file.bytesRead ?? 0);
    const rec = await prisma.recording.create({
      data: {
        organizationId: auth.orgId,
        name: file.filename,
        filePath,
        mimeType: file.mimetype,
        durationMs,
        byteSize,
      },
    });
    return ok(rec);
  });

  app.get("/recordings/:id/file", async (req, reply) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const rec = await prisma.recording.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { filePath: true, mimeType: true, name: true },
    });
    if (!rec || !existsSync(rec.filePath)) throw new NotFoundError();
    const stat = statSync(rec.filePath);
    const safeName = rec.name.replace(/[^\w.\- ]+/g, "_") || `recording-${id}`;
    reply.header("content-type", rec.mimeType || "audio/wav");
    reply.header("content-length", String(stat.size));
    reply.header("content-disposition", `inline; filename="${safeName}"`);
    reply.header("accept-ranges", "bytes");
    return reply.send(createReadStream(rec.filePath));
  });

  app.patch("/recordings/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("recordings.manage")(req);
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().optional(), description: z.string().optional() }).parse(req.body);
    const existing = await prisma.recording.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!existing) throw new NotFoundError();
    return ok(
      await prisma.recording.update({
        where: { id },
        data: body,
      }),
    );
  });

  app.delete("/recordings/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("recordings.manage")(req);
    const { id } = req.params as { id: string };
    const rec = await prisma.recording.findFirst({
      where: { id, organizationId: auth.orgId },
      select: { id: true, filePath: true },
    });
    if (!rec) throw new NotFoundError();

    const usedBy = await prisma.campaign.count({ where: { recordingId: id, organizationId: auth.orgId } });
    if (usedBy > 0) {
      throw new ConflictError(
        `This audio is used by ${usedBy} campaign${usedBy === 1 ? "" : "s"}. Remove it from those campaigns first.`,
      );
    }

    await prisma.recording.delete({ where: { id } });
    if (rec.filePath && existsSync(rec.filePath)) {
      await unlink(rec.filePath).catch(() => undefined);
    }
    return ok({ deleted: true });
  });
};
