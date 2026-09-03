import type { FastifyPluginAsync } from "fastify";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { ConflictError, ForbiddenError, ok } from "@wacalls/shared";
import {
  brandingFileStream,
  ensureBrandingDir,
  isSafeBrandingFile,
  loadBranding,
  removeBrandingFile,
  saveBranding,
  toPublicBranding,
} from "../services/branding.js";

const brandingBody = z.object({
  brandName: z.string().trim().min(1).max(80).optional(),
  tagline: z.string().trim().max(200).optional(),
  supportEmail: z.string().trim().max(120).optional(),
  supportPhone: z.string().trim().max(40).optional(),
  website: z.string().trim().max(200).optional(),
  companyAddress: z.string().trim().max(400).optional(),
  copyright: z.string().trim().max(200).optional(),
});

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".ico"];

export const brandingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/branding", async (req) => {
    const auth = await app.authenticate(req);
    const { brand, updatedAt } = await loadBranding(auth.orgId);
    return ok(toPublicBranding(brand, updatedAt));
  });

  app.put("/branding", async (req) => {
    const auth = await app.authenticate(req);
    if (!auth.superAdmin) throw new ForbiddenError("Super admin only");
    if (!auth.orgId) throw new ForbiddenError("Workspace required");
    const body = brandingBody.parse(req.body);
    const brand = await saveBranding(auth.orgId, body);
    const { updatedAt } = await loadBranding(auth.orgId);
    return ok(toPublicBranding(brand, updatedAt));
  });

  app.post("/branding/logo", async (req) => {
    const auth = await app.authenticate(req);
    if (!auth.superAdmin) throw new ForbiddenError("Super admin only");
    if (!auth.orgId) throw new ForbiddenError("Workspace required");
    const file = await req.file();
    if (!file) throw new ConflictError("Logo file required");
    const ext = path.extname(file.filename).toLowerCase();
    if (!IMAGE_EXT.includes(ext) || ext === ".ico") {
      throw new ConflictError("Use a PNG, JPG, or WebP logo");
    }
    const { brand } = await loadBranding(auth.orgId);
    await removeBrandingFile(brand.logoPath);
    const dir = await ensureBrandingDir(auth.orgId);
    const stored = `logo${ext === ".jpeg" ? ".jpg" : ext}`;
    const filePath = path.join(dir, stored);
    await pipeline(file.file, createWriteStream(filePath));
    const mime = file.mimetype.startsWith("image/") ? file.mimetype : "image/png";
    const next = await saveBranding(auth.orgId, { logoPath: filePath, logoMime: mime });
    const { updatedAt } = await loadBranding(auth.orgId);
    return ok(toPublicBranding(next, updatedAt));
  });

  app.delete("/branding/logo", async (req) => {
    const auth = await app.authenticate(req);
    if (!auth.superAdmin) throw new ForbiddenError("Super admin only");
    if (!auth.orgId) throw new ForbiddenError("Workspace required");
    const { brand } = await loadBranding(auth.orgId);
    await removeBrandingFile(brand.logoPath);
    const next = await saveBranding(auth.orgId, { logoPath: null, logoMime: null });
    const { updatedAt } = await loadBranding(auth.orgId);
    return ok(toPublicBranding(next, updatedAt));
  });

  app.post("/branding/favicon", async (req) => {
    const auth = await app.authenticate(req);
    if (!auth.superAdmin) throw new ForbiddenError("Super admin only");
    if (!auth.orgId) throw new ForbiddenError("Workspace required");
    const file = await req.file();
    if (!file) throw new ConflictError("Favicon file required");
    const ext = path.extname(file.filename).toLowerCase();
    if (!IMAGE_EXT.includes(ext)) {
      throw new ConflictError("Use a PNG, JPG, WebP, or ICO favicon");
    }
    const { brand } = await loadBranding(auth.orgId);
    await removeBrandingFile(brand.faviconPath);
    const dir = await ensureBrandingDir(auth.orgId);
    const stored = `favicon${ext === ".jpeg" ? ".jpg" : ext}`;
    const filePath = path.join(dir, stored);
    await pipeline(file.file, createWriteStream(filePath));
    const mime =
      ext === ".ico"
        ? "image/x-icon"
        : file.mimetype.startsWith("image/")
          ? file.mimetype
          : "image/png";
    const next = await saveBranding(auth.orgId, { faviconPath: filePath, faviconMime: mime });
    const { updatedAt } = await loadBranding(auth.orgId);
    return ok(toPublicBranding(next, updatedAt));
  });

  app.delete("/branding/favicon", async (req) => {
    const auth = await app.authenticate(req);
    if (!auth.superAdmin) throw new ForbiddenError("Super admin only");
    if (!auth.orgId) throw new ForbiddenError("Workspace required");
    const { brand } = await loadBranding(auth.orgId);
    await removeBrandingFile(brand.faviconPath);
    const next = await saveBranding(auth.orgId, { faviconPath: null, faviconMime: null });
    const { updatedAt } = await loadBranding(auth.orgId);
    return ok(toPublicBranding(next, updatedAt));
  });
};

export const publicBrandingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/public/branding", async () => {
    const { brand, updatedAt } = await loadBranding();
    return ok(toPublicBranding(brand, updatedAt));
  });

  app.get("/public/branding/logo", async (_req, reply) => {
    const { brand } = await loadBranding();
    if (!isSafeBrandingFile(brand.logoPath) || !brand.logoPath) {
      return reply.status(404).send({ success: false, error: { message: "No logo" } });
    }
    const { stream, mime } = brandingFileStream(brand.logoPath, brand.logoMime);
    return reply
      .header("cache-control", "public, max-age=3600")
      .header("cross-origin-resource-policy", "cross-origin")
      .type(mime)
      .send(stream);
  });

  app.get("/public/branding/favicon", async (_req, reply) => {
    const { brand } = await loadBranding();
    if (!isSafeBrandingFile(brand.faviconPath) || !brand.faviconPath) {
      return reply.status(404).send({ success: false, error: { message: "No favicon" } });
    }
    const { stream, mime } = brandingFileStream(brand.faviconPath, brand.faviconMime);
    return reply
      .header("cache-control", "public, max-age=3600")
      .header("cross-origin-resource-policy", "cross-origin")
      .type(mime)
      .send(stream);
  });
};
