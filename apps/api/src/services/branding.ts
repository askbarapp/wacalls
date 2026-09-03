import { createReadStream, existsSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@wacalls/database";
import { env } from "../env.js";

export const BRANDING_KEY = "white_label";

export type WhiteLabel = {
  brandName: string;
  tagline: string;
  supportEmail: string;
  supportPhone: string;
  website: string;
  companyAddress: string;
  copyright: string;
  logoPath: string | null;
  logoMime: string | null;
  faviconPath: string | null;
  faviconMime: string | null;
};

export type PublicBranding = {
  brandName: string;
  tagline: string;
  supportEmail: string;
  supportPhone: string;
  website: string;
  companyAddress: string;
  copyright: string;
  hasLogo: boolean;
  hasFavicon: boolean;
  updatedAt: string | null;
};

export function defaultBranding(): WhiteLabel {
  return {
    brandName: env.APP_NAME || "WaCalls",
    tagline: "WhatsApp calling, messaging, and sequential dialer",
    supportEmail: "",
    supportPhone: "",
    website: "",
    companyAddress: "",
    copyright: "",
    logoPath: null,
    logoMime: null,
    faviconPath: null,
    faviconMime: null,
  };
}

function asBranding(value: unknown): WhiteLabel {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const base = defaultBranding();
  const str = (key: string, fallback: string) => (typeof raw[key] === "string" ? (raw[key] as string) : fallback);
  const pathOrNull = (key: string) => (typeof raw[key] === "string" && raw[key] ? (raw[key] as string) : null);
  return {
    brandName: str("brandName", base.brandName) || base.brandName,
    tagline: str("tagline", base.tagline),
    supportEmail: str("supportEmail", base.supportEmail),
    supportPhone: str("supportPhone", base.supportPhone),
    website: str("website", base.website),
    companyAddress: str("companyAddress", base.companyAddress),
    copyright: str("copyright", base.copyright),
    logoPath: pathOrNull("logoPath"),
    logoMime: pathOrNull("logoMime"),
    faviconPath: pathOrNull("faviconPath"),
    faviconMime: pathOrNull("faviconMime"),
  };
}

export function toPublicBranding(brand: WhiteLabel, updatedAt?: Date | null): PublicBranding {
  return {
    brandName: brand.brandName,
    tagline: brand.tagline,
    supportEmail: brand.supportEmail,
    supportPhone: brand.supportPhone,
    website: brand.website,
    companyAddress: brand.companyAddress,
    copyright: brand.copyright,
    hasLogo: Boolean(brand.logoPath && existsSync(brand.logoPath)),
    hasFavicon: Boolean(brand.faviconPath && existsSync(brand.faviconPath)),
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  };
}

export function brandingDir(orgId: string) {
  return path.join(env.RECORDINGS_DIR, "branding", orgId);
}

export async function loadBranding(orgId?: string | null): Promise<{ brand: WhiteLabel; updatedAt: Date | null }> {
  if (orgId) {
    const row = await prisma.setting.findFirst({
      where: { organizationId: orgId, key: BRANDING_KEY },
    });
    if (row) return { brand: asBranding(row.value), updatedAt: row.updatedAt };
  }
  const instance = await prisma.setting.findFirst({
    where: { organizationId: null, key: BRANDING_KEY },
  });
  if (instance) return { brand: asBranding(instance.value), updatedAt: instance.updatedAt };
  const latest = await prisma.setting.findFirst({
    where: { key: BRANDING_KEY },
    orderBy: { updatedAt: "desc" },
  });
  if (latest) return { brand: asBranding(latest.value), updatedAt: latest.updatedAt };
  return { brand: defaultBranding(), updatedAt: null };
}

export async function saveBranding(orgId: string, patch: Partial<WhiteLabel>) {
  const current = await loadBranding(orgId);
  const next: WhiteLabel = { ...current.brand, ...patch };
  if (!next.brandName.trim()) next.brandName = defaultBranding().brandName;
  const value = next as object;
  await prisma.setting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: BRANDING_KEY } },
    update: { value },
    create: { organizationId: orgId, key: BRANDING_KEY, value },
  });
  const instance = await prisma.setting.findFirst({
    where: { organizationId: null, key: BRANDING_KEY },
  });
  if (instance) {
    await prisma.setting.update({ where: { id: instance.id }, data: { value } });
  } else {
    await prisma.setting.create({ data: { organizationId: null, key: BRANDING_KEY, value } });
  }
  return next;
}

export function isSafeBrandingFile(filePath: string | null | undefined) {
  if (!filePath) return false;
  const root = path.resolve(path.join(env.RECORDINGS_DIR, "branding"));
  const resolved = path.resolve(filePath);
  return resolved.startsWith(root + path.sep) && existsSync(resolved);
}

export async function removeBrandingFile(filePath: string | null) {
  if (!isSafeBrandingFile(filePath) || !filePath) return;
  await unlink(filePath).catch(() => undefined);
}

export async function ensureBrandingDir(orgId: string) {
  const dir = brandingDir(orgId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function brandingFileStream(filePath: string, mime: string | null) {
  return {
    stream: createReadStream(filePath),
    mime: mime || "application/octet-stream",
  };
}
