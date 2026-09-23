import { prisma } from "@wacalls/database";
import {
  extractGeminiApiKey,
  extractSarvamApiKey,
  normalizeVoiceProvider,
  type VoiceAiProviderId,
} from "@wacalls/audio-engine";
import { ConflictError } from "@wacalls/shared";

export async function resolveSarvamApiKey(organizationId: string): Promise<string> {
  const row = await prisma.setting.findFirst({
    where: { organizationId, key: "sarvam_api_key" },
  });
  let key = extractSarvamApiKey(row?.value) || process.env.SARVAM_API_KEY || process.env.AI_API_KEY || "";
  if (!key) {
    // Fallback: check if any organization has a configured key (system default)
    const anyRow = await prisma.setting.findFirst({
      where: { key: "sarvam_api_key" },
      orderBy: { createdAt: "desc" },
    });
    key = extractSarvamApiKey(anyRow?.value) || "";
  }
  if (!key) {
    throw new ConflictError(
      "Sarvam AI API key is not configured. Add it on AI calling → API keys, or set SARVAM_API_KEY.",
    );
  }
  return key;
}

export async function hasSarvamApiKey(organizationId: string): Promise<boolean> {
  try {
    await resolveSarvamApiKey(organizationId);
    return true;
  } catch {
    return false;
  }
}

export async function resolveGeminiApiKey(organizationId: string): Promise<string> {
  const row = await prisma.setting.findFirst({
    where: { organizationId, key: "gemini_api_key" },
  });
  let key = extractGeminiApiKey(row?.value) || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  if (!key) {
    // Fallback: check if any organization has a configured key (system default)
    const anyRow = await prisma.setting.findFirst({
      where: { key: "gemini_api_key" },
      orderBy: { createdAt: "desc" },
    });
    key = extractGeminiApiKey(anyRow?.value) || "";
  }
  if (!key) {
    throw new ConflictError(
      "Google Gemini API key is not configured. Add it on AI calling → API keys, or set GEMINI_API_KEY.",
    );
  }
  return key;
}

export async function hasGeminiApiKey(organizationId: string): Promise<boolean> {
  try {
    await resolveGeminiApiKey(organizationId);
    return true;
  } catch {
    return false;
  }
}

export async function resolveVoiceApiKey(
  organizationId: string,
  provider?: string | null,
): Promise<{ provider: VoiceAiProviderId; apiKey: string }> {
  const id = normalizeVoiceProvider(provider);
  if (id === "gemini") {
    return { provider: id, apiKey: await resolveGeminiApiKey(organizationId) };
  }
  return { provider: id, apiKey: await resolveSarvamApiKey(organizationId) };
}

export async function hasVoiceApiKey(organizationId: string, provider?: string | null): Promise<boolean> {
  try {
    await resolveVoiceApiKey(organizationId, provider);
    return true;
  } catch {
    return false;
  }
}
