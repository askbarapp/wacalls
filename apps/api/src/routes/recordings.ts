import type { FastifyPluginAsync } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { prisma } from "@wacalls/database";
import { ConflictError, ok } from "@wacalls/shared";
import { env } from "../env.js";
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
    const rec = await prisma.recording.create({
      data: {
        organizationId: auth.orgId,
        name: file.filename,
        filePath,
        mimeType: file.mimetype,
        byteSize: Number(file.file.bytesRead ?? 0),
      },
    });
    return ok(rec);
  });

  app.patch("/recordings/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("recordings.manage")(req);
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().optional(), description: z.string().optional() }).parse(req.body);
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
    await prisma.recording.deleteMany({ where: { id, organizationId: auth.orgId } });
    return ok({ deleted: true });
  });
};
