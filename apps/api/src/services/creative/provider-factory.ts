import { prisma } from "@wacalls/database";
import { UseVelixProvider } from "./usevelix-provider.js";
import type { CreativeProvider } from "./creative-provider.js";

/**
 * Resolves the configured AI Creative Provider for an organization.
 * Prioritizes Organization Setting, then global Environment Variables.
 */
export async function getCreativeProvider(organizationId: string): Promise<CreativeProvider> {
  const [keyRow, baseRow, statusRow, typeRow, aspectRow] = await Promise.all([
    prisma.setting.findFirst({ where: { organizationId, key: "usevelix_api_key" } }),
    prisma.setting.findFirst({ where: { organizationId, key: "usevelix_base_url" } }),
    prisma.setting.findFirst({ where: { organizationId, key: "usevelix_status" } }),
    prisma.setting.findFirst({ where: { organizationId, key: "usevelix_default_type" } }),
    prisma.setting.findFirst({ where: { organizationId, key: "usevelix_default_aspect" } }),
  ]);

  const extractString = (val: any): string => {
    if (typeof val === "string") return val.trim();
    if (val && typeof val === "object" && typeof val.value === "string") return val.value.trim();
    if (val && typeof val === "object" && typeof val.apiKey === "string") return val.apiKey.trim();
    return "";
  };

  const apiKey = extractString(keyRow?.value) || process.env.USEVELIX_API_KEY || "";
  const baseUrl = extractString(baseRow?.value) || process.env.USEVELIX_BASE_URL || "https://api.usevelix.com";
  const enabled = statusRow ? statusRow.value === true || statusRow.value === "true" || (typeof statusRow.value === "object" && (statusRow.value as any)?.enabled === true) : true;

  if (!apiKey) {
    throw new Error("UseVelix API key is not configured. Add it in Admin Platform → AI Providers or set USEVELIX_API_KEY.");
  }

  if (!enabled && statusRow) {
    throw new Error("UseVelix provider is currently disabled by Admin.");
  }

  return new UseVelixProvider({
    apiKey,
    baseUrl,
    defaultType: extractString(typeRow?.value) || "3d",
    defaultAspect: extractString(aspectRow?.value) || "1:1",
  });
}

/**
 * Checks if a creative provider is configured for the organization.
 */
export async function hasCreativeProvider(organizationId: string): Promise<boolean> {
  try {
    const provider = await getCreativeProvider(organizationId);
    return Boolean(provider);
  } catch {
    return false;
  }
}

/**
 * Returns safe provider settings for Admin display (API key is never exposed).
 */
export async function getProviderAdminSettings(organizationId: string) {
  const [keyRow, baseRow, statusRow, typeRow, aspectRow] = await Promise.all([
    prisma.setting.findFirst({ where: { organizationId, key: "usevelix_api_key" } }),
    prisma.setting.findFirst({ where: { organizationId, key: "usevelix_base_url" } }),
    prisma.setting.findFirst({ where: { organizationId, key: "usevelix_status" } }),
    prisma.setting.findFirst({ where: { organizationId, key: "usevelix_default_type" } }),
    prisma.setting.findFirst({ where: { organizationId, key: "usevelix_default_aspect" } }),
  ]);

  const extractString = (val: any): string => {
    if (typeof val === "string") return val.trim();
    if (val && typeof val === "object" && typeof val.value === "string") return val.value.trim();
    if (val && typeof val === "object" && typeof val.apiKey === "string") return val.apiKey.trim();
    return "";
  };

  const rawKey = extractString(keyRow?.value) || process.env.USEVELIX_API_KEY || "";
  const isConfigured = rawKey.length >= 6;
  const maskedKey = isConfigured ? `${rawKey.slice(0, 4)}••••••••${rawKey.slice(-3)}` : "";

  return {
    provider: "usevelix",
    configured: isConfigured,
    maskedApiKey: maskedKey,
    baseUrl: extractString(baseRow?.value) || process.env.USEVELIX_BASE_URL || "https://api.usevelix.com",
    enabled: statusRow ? statusRow.value === true || statusRow.value === "true" || (typeof statusRow.value === "object" && (statusRow.value as any)?.enabled === true) : true,
    defaultType: extractString(typeRow?.value) || "3d",
    defaultAspect: extractString(aspectRow?.value) || "1:1",
    envFallback: Boolean(process.env.USEVELIX_API_KEY),
  };
}
