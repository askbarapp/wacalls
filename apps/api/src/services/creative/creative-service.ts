import fs from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { prisma } from "@wacalls/database";
import { env } from "../../env.js";
import { getCreativeProvider } from "./provider-factory.js";
import { buildCreativePrompt, buildSmartEditPrompt } from "./prompt-builder.js";
import { whatsappClient } from "../whatsapp-client.js";

const log = pino({ name: "creative-service" });

const CREATIVE_DIR = path.join(env.RECORDINGS_DIR, "creatives");

async function ensureCreativeDir(): Promise<string> {
  await fs.mkdir(CREATIVE_DIR, { recursive: true }).catch(() => undefined);
  return CREATIVE_DIR;
}

/**
 * Check organization feature entitlement and internal WaCall credit balance.
 */
export async function assertCreativeEntitlementAndCredits(organizationId: string, channelId?: string | null): Promise<void> {
  // 1. Feature Entitlement Check
  if (channelId) {
    const entitlement = await prisma.featureEntitlement.findFirst({
      where: { organizationId, channelId, feature: "ai_creative_studio" },
    });
    if (entitlement && !entitlement.enabled) {
      throw new Error("🎨 AI Creative Studio आपके इस नंबर पर अभी activated नहीं है। इसे activate करने के लिए admin से संपर्क करें।");
    }
  }

  // 2. WaCall Credit Balance Check
  let credit = await prisma.aiCreditBalance.findUnique({
    where: { organizationId },
  });

  if (!credit) {
    // Provision initial trial balance
    credit = await prisma.aiCreditBalance.create({
      data: {
        organizationId,
        balance: 100,
        monthlyLimit: 100,
        used: 0,
      },
    });
  }

  if (credit.balance < 5) {
    throw new Error("🎨 AI Creative credits खत्म हो गए हैं। कृपया अपना plan upgrade करें।");
  }
}

/**
 * Request Text-to-Image Generation for an organization / channel.
 */
export async function createCreativeRequest(input: {
  organizationId: string;
  channelId?: string | null;
  conversationId?: string | null;
  festivalName?: string;
  userInstruction: string;
  creativeType?: "poster" | "banner" | "status";
  aspect?: "1:1" | "9:16" | "16:9";
  notifyPhone?: string;
}) {
  await assertCreativeEntitlementAndCredits(input.organizationId, input.channelId);

  // Load or construct BusinessProfile
  let profile = await prisma.businessProfile.findFirst({
    where: {
      organizationId: input.organizationId,
      ...(input.channelId ? { channelId: input.channelId } : {}),
    },
  });

  if (!profile && input.channelId) {
    // Fallback: check organization-level profile
    profile = await prisma.businessProfile.findFirst({
      where: { organizationId: input.organizationId },
    });
  }

  // Build the strict prompt (never inventing fictional discounts)
  const prompt = buildCreativePrompt({
    businessName: profile?.businessName,
    businessCategory: profile?.businessCategory || undefined,
    brandColors: profile?.brandColors || undefined,
    brandStyle: profile?.brandStyle || undefined,
    products: profile?.products || undefined,
    services: profile?.services || undefined,
    defaultOffer: profile?.defaultOffer || undefined,
    festivalName: input.festivalName,
    userInstruction: input.userInstruction,
    creativeType: input.creativeType || "poster",
    aspect: input.aspect || "1:1",
    language: profile?.language || "Hindi + English",
  });

  const provider = await getCreativeProvider(input.organizationId);

  // 1. Create CreativeAsset record in GENERATING status
  const title = input.festivalName
    ? `${input.festivalName} Creative — ${profile?.businessName || "Business"}`
    : `Marketing Creative — ${profile?.businessName || "Business"}`;

  const asset = await prisma.creativeAsset.create({
    data: {
      organizationId: input.organizationId,
      channelId: input.channelId || undefined,
      conversationId: input.conversationId || undefined,
      title,
      concept: input.userInstruction,
      status: "GENERATING",
    },
  });

  // 2. Call Provider (UseVelix)
  const res = await provider.generateTextToImage({
    prompt,
    aspect: input.aspect || "1:1",
    type: "3d",
    enhancePrompt: 1,
  });

  // 3. Create AiJob record
  const job = await prisma.aiJob.create({
    data: {
      organizationId: input.organizationId,
      channelId: input.channelId || undefined,
      feature: "creative",
      provider: provider.name,
      providerJobId: res.jobId,
      requestType: "text-to-image",
      prompt,
      status: "QUEUED",
      creditsUsed: res.creditsUsed ?? 5,
    },
  });

  // 4. Create CreativeVersion (v1)
  const version = await prisma.creativeVersion.create({
    data: {
      assetId: asset.id,
      version: 1,
      prompt,
      provider: provider.name,
      providerJobId: res.jobId,
      status: "GENERATING",
      creditsUsed: res.creditsUsed ?? 5,
    },
  });

  await prisma.creativeAsset.update({
    where: { id: asset.id },
    data: { currentVersionId: version.id },
  });

  // 5. Start background polling (BullMQ or asynchronous runner)
  void pollJobUntilDone({
    organizationId: input.organizationId,
    channelId: input.channelId || undefined,
    jobId: res.jobId,
    assetId: asset.id,
    versionId: version.id,
    notifyPhone: input.notifyPhone,
    title,
  });

  return {
    assetId: asset.id,
    versionId: version.id,
    jobId: res.jobId,
    prompt,
  };
}

/**
 * Request Smart-Edit on an existing creative asset.
 * If asset is already LOCKED/FINAL, clones it into a new draft version to preserve immutability!
 */
export async function smartEditCreativeRequest(input: {
  organizationId: string;
  assetId: string;
  channelId?: string | null;
  editInstruction: string;
  notifyPhone?: string;
}) {
  await assertCreativeEntitlementAndCredits(input.organizationId, input.channelId);

  const asset = await prisma.creativeAsset.findUnique({
    where: { id: input.assetId },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });

  if (!asset) throw new Error("Creative asset not found");

  const latestVersion = asset.versions[0];
  if (!latestVersion?.imageUrl && !latestVersion?.localPath) {
    throw new Error("Previous creative image is still generating or unavailable.");
  }

  const imageUrl = latestVersion.imageUrl || `file://${latestVersion.localPath}`;
  const editPrompt = buildSmartEditPrompt(latestVersion.prompt, input.editInstruction);

  const provider = await getCreativeProvider(input.organizationId);

  // Call Provider Smart-Edit
  const res = await provider.smartEdit({
    imageUrl,
    prompt: editPrompt,
    type: "3d",
  });

  const nextVersionNum = latestVersion.version + 1;

  // If asset was locked, create new version and set status to REVISION
  await prisma.creativeAsset.update({
    where: { id: asset.id },
    data: {
      status: "REVISION",
      locked: false, // new draft revision is editable
    },
  });

  // Create new Version
  const newVersion = await prisma.creativeVersion.create({
    data: {
      assetId: asset.id,
      version: nextVersionNum,
      prompt: editPrompt,
      provider: provider.name,
      providerJobId: res.jobId,
      status: "GENERATING",
      creditsUsed: res.creditsUsed ?? 8,
    },
  });

  await prisma.creativeAsset.update({
    where: { id: asset.id },
    data: { currentVersionId: newVersion.id },
  });

  // Start background polling
  void pollJobUntilDone({
    organizationId: input.organizationId,
    channelId: input.channelId || undefined,
    jobId: res.jobId,
    assetId: asset.id,
    versionId: newVersion.id,
    notifyPhone: input.notifyPhone,
    title: `${asset.title} (v${nextVersionNum})`,
  });

  return {
    assetId: asset.id,
    versionId: newVersion.id,
    version: nextVersionNum,
    jobId: res.jobId,
  };
}

/**
 * Lock and finalize a creative version (Immutable).
 */
export async function finalizeCreativeAsset(assetId: string) {
  return prisma.creativeAsset.update({
    where: { id: assetId },
    data: {
      status: "FINAL",
      locked: true,
      lockedAt: new Date(),
    },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });
}

/**
 * Asynchronous job poller with exponential backoff and maximum retry timeout.
 * Downloads the ready image, saves locally, updates database, deducts credits,
 * and sends the image to WhatsApp!
 */
async function pollJobUntilDone(opts: {
  organizationId: string;
  channelId?: string;
  jobId: string;
  assetId: string;
  versionId: string;
  notifyPhone?: string;
  title: string;
}) {
  const provider = await getCreativeProvider(opts.organizationId).catch(() => null);
  if (!provider) return;

  const intervals = [5000, 8000, 10000, 15000, 20000, 25000, 30000, 30000, 30000]; // ~3 mins
  let isDone = false;

  for (let i = 0; i < intervals.length; i++) {
    await new Promise((r) => setTimeout(r, intervals[i]));

    try {
      const status = await provider.getJobStatus(opts.jobId);
      log.info({ attempt: i + 1, status: status.status, jobId: opts.jobId }, "Polled creative job status");

      if (status.status === "done" && status.imageUrl) {
        isDone = true;

        // 1. Download image to shared local media storage
        const dir = await ensureCreativeDir();
        const filename = `creative-${opts.assetId}-${opts.versionId}.jpg`;
        const localPath = path.join(dir, filename);

        try {
          const imgRes = await fetch(status.imageUrl);
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            await fs.writeFile(localPath, buf);
          }
        } catch (downloadErr: any) {
          log.warn({ err: downloadErr?.message }, "Failed to write local image; using remote URL");
        }

        // 2. Update CreativeVersion & CreativeAsset
        await prisma.creativeVersion.update({
          where: { id: opts.versionId },
          data: {
            status: "READY",
            imageUrl: status.imageUrl,
            localPath,
            creditsUsed: status.creditsUsed ?? 5,
          },
        });

        await prisma.creativeAsset.update({
          where: { id: opts.assetId },
          data: { status: "READY" },
        });

        // 3. Update AiJob
        await prisma.aiJob.updateMany({
          where: { providerJobId: opts.jobId },
          data: {
            status: "DONE",
            outputUrl: status.imageUrl,
            creditsUsed: status.creditsUsed ?? 5,
            completedAt: new Date(),
          },
        });

        // 4. Deduct WaCall internal credits
        await prisma.aiCreditBalance.update({
          where: { organizationId: opts.organizationId },
          data: {
            balance: { decrement: 5 },
            used: { increment: 5 },
          },
        }).catch(() => undefined);

        // 5. Send directly to WhatsApp if notifyPhone is present!
        if (opts.channelId && opts.notifyPhone) {
          const caption = `🎨 *WaCall Creative Studio — Poster Ready!*\n━━━━━━━━━━━━━━━━━━━━\n✨ *${opts.title}*\n\nकैसी लगी यह creative? आप कह सकते हैं:\n• *"Logo छोटा करो"*\n• *"Background blue करो"*\n• *"एक और बनाओ"*\n• *"Final"* (lock करने के लिए)`;

          await whatsappClient.sendText(opts.channelId, opts.notifyPhone, caption, {
            imagePath: localPath,
          }).catch((sendErr) => log.error({ err: sendErr?.message }, "Failed to dispatch creative to WhatsApp"));
        }

        break;
      }

      if (status.status === "failed") {
        await markJobFailed(opts.jobId, opts.assetId, opts.versionId, status.error || "Provider generation failed");
        if (opts.channelId && opts.notifyPhone) {
          await whatsappClient.sendText(
            opts.channelId,
            opts.notifyPhone,
            "❌ इस समय creative generate नहीं हो सकी। कृपया कुछ देर बाद फिर प्रयास करें।",
          ).catch(() => undefined);
        }
        break;
      }
    } catch (pollErr: any) {
      log.warn({ err: pollErr?.message, attempt: i + 1 }, "Error polling UseVelix job");
    }
  }

  if (!isDone) {
    await markJobFailed(opts.jobId, opts.assetId, opts.versionId, "Generation timed out after 3 minutes");
  }
}

async function markJobFailed(jobId: string, assetId: string, versionId: string, error: string) {
  await prisma.creativeVersion.update({
    where: { id: versionId },
    data: { status: "FAILED" },
  }).catch(() => undefined);

  await prisma.creativeAsset.update({
    where: { id: assetId },
    data: { status: "DRAFT" },
  }).catch(() => undefined);

  await prisma.aiJob.updateMany({
    where: { providerJobId: jobId },
    data: {
      status: "FAILED",
      error,
      completedAt: new Date(),
    },
  }).catch(() => undefined);
}
