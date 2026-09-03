import { prisma } from "@wacalls/database";
import { extractSarvamApiKey } from "@wacalls/audio-engine";
import { ConflictError } from "@wacalls/shared";

export async function resolveSarvamApiKey(organizationId: string): Promise<string> {
  const row = await prisma.setting.findFirst({
    where: { organizationId, key: "sarvam_api_key" },
  });
  const key = extractSarvamApiKey(row?.value) || process.env.SARVAM_API_KEY || process.env.AI_API_KEY || "";
  if (!key) {
    throw new ConflictError(
      "Sarvam AI API key is not configured. Add it on AI calling → API key, or set SARVAM_API_KEY.",
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
