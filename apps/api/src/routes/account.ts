import type { FastifyPluginAsync } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { ConflictError, NotFoundError, ok } from "@wacalls/shared";
import { env } from "../env.js";

function isSafeAvatar(filePath: string | null | undefined) {
  if (!filePath) return false;
  const root = path.resolve(path.join(env.RECORDINGS_DIR, "avatars"));
  const resolved = path.resolve(filePath);
  return resolved.startsWith(root + path.sep) && existsSync(resolved);
}

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.get("/account", async (req) => {
    const auth = await app.authenticate(req);
    const user = await prisma.user.findUnique({
      where: { id: auth.sub },
      select: { id: true, email: true, name: true, phone: true, avatarPath: true },
    });
    const org = auth.orgId
      ? await prisma.organization.findUnique({
          where: { id: auth.orgId },
          include: {
            plan: true,
            _count: { select: { users: true, channels: true, calls: true, messages: true } },
          },
        })
      : null;
    return ok({
      user: {
        id: auth.sub,
        email: auth.email,
        name: user?.name ?? "",
        phone: user?.phone ?? "",
        hasAvatar: isSafeAvatar(user?.avatarPath),
        role: auth.role,
        superAdmin: auth.superAdmin,
      },
      organization: org,
    });
  });

  app.patch("/account/profile", async (req) => {
    const auth = await app.authenticate(req);
    const body = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        phone: z.string().trim().max(40).optional(),
      })
      .parse(req.body);
    const user = await prisma.user.update({
      where: { id: auth.sub },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
      },
      select: { id: true, email: true, name: true, phone: true, avatarPath: true },
    });
    return ok({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone ?? "",
      hasAvatar: isSafeAvatar(user.avatarPath),
    });
  });

  app.post("/account/avatar", async (req) => {
    const auth = await app.authenticate(req);
    const file = await req.file();
    if (!file) throw new ConflictError("Photo required");
    const ext = path.extname(file.filename).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
      throw new ConflictError("Use a PNG, JPG, or WebP photo");
    }
    const existing = await prisma.user.findUnique({
      where: { id: auth.sub },
      select: { avatarPath: true },
    });
    if (isSafeAvatar(existing?.avatarPath) && existing?.avatarPath) {
      await unlink(existing.avatarPath).catch(() => undefined);
    }
    const dir = path.join(env.RECORDINGS_DIR, "avatars");
    await mkdir(dir, { recursive: true });
    const stored = `${auth.sub}${ext === ".jpeg" ? ".jpg" : ext}`;
    const filePath = path.join(dir, stored);
    await pipeline(file.file, createWriteStream(filePath));
    await prisma.user.update({ where: { id: auth.sub }, data: { avatarPath: filePath } });
    return ok({ hasAvatar: true });
  });

  app.delete("/account/avatar", async (req) => {
    const auth = await app.authenticate(req);
    const existing = await prisma.user.findUnique({
      where: { id: auth.sub },
      select: { avatarPath: true },
    });
    if (isSafeAvatar(existing?.avatarPath) && existing?.avatarPath) {
      await unlink(existing.avatarPath).catch(() => undefined);
    }
    await prisma.user.update({ where: { id: auth.sub }, data: { avatarPath: null } });
    return ok({ hasAvatar: false });
  });

  app.get("/account/avatar", async (req, reply) => {
    const auth = await app.authenticate(req);
    const user = await prisma.user.findUnique({
      where: { id: auth.sub },
      select: { avatarPath: true },
    });
    if (!isSafeAvatar(user?.avatarPath) || !user?.avatarPath) throw new NotFoundError("No profile photo");
    const ext = path.extname(user.avatarPath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return reply.header("cache-control", "private, max-age=300").type(mime).send(createReadStream(user.avatarPath));
  });

  app.patch("/account/organization", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("settings.manage")(req);
    const body = z.object({ name: z.string().min(2).optional(), billingEmail: z.string().optional() }).parse(req.body);
    const org = await prisma.organization.update({
      where: { id: auth.orgId },
      data: {
        name: body.name,
        billingEmail: body.billingEmail,
      },
    });
    return ok(org);
  });
};
