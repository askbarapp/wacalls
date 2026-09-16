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
      throw new Error("🎨 AI Creative Studio is not active on this number. Please contact admin to activate.");
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
    throw new Error("🎨 AI Creative credits are exhausted. Please upgrade your plan.");
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
  aspect?: "1:1" | "9:16" | "16:9" | "4:5";
  headlineText?: string;
  ctaText?: string;
  conceptTheme?: string;
  showPhone?: boolean;
  showWebsite?: boolean;
  showEmail?: boolean;
  showLogo?: boolean;
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
    headlineText: input.headlineText,
    ctaText: input.ctaText,
    conceptTheme: input.conceptTheme,
    phone: profile?.phone || undefined,
    email: profile?.email || undefined,
    website: profile?.website || undefined,
    logoUrl: profile?.logoUrl || undefined,
    showPhone: input.showPhone ?? true,
    showWebsite: input.showWebsite ?? true,
    showEmail: input.showEmail ?? true,
    showLogo: input.showLogo ?? true,
  });

  let provider: any = null;
  try {
    provider = await getCreativeProvider(input.organizationId);
  } catch (provErr: any) {
    log.warn({ err: provErr?.message }, "Creative provider not configured, routing to fast FLUX fallback");
  }

  const title = input.festivalName
    ? `${input.festivalName} Creative — ${profile?.businessName || "Business"}`
    : `Marketing Creative — ${profile?.businessName || "Business"}`;

  if (!provider) {
    return await generateWithFastFallback({
      organizationId: input.organizationId,
      channelId: input.channelId,
      conversationId: input.conversationId,
      prompt,
      title,
      concept: input.userInstruction,
      aspect: input.aspect || "1:1",
      notifyPhone: input.notifyPhone,
    });
  }

  // 1. Create CreativeAsset record in GENERATING status
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

  // 2. Call Provider (UseVelix with fast settings)
  const typeRow = await prisma.setting.findFirst({
    where: { organizationId: input.organizationId, key: "usevelix_default_type" },
  });
  const defaultType = typeof typeRow?.value === "string" ? typeRow.value : "photorealistic";

  let res: any;
  try {
    res = await provider.generateTextToImage({
      prompt,
      aspect: input.aspect || "1:1",
      type: defaultType,
      enhancePrompt: 0,
    });
  } catch (genErr: any) {
    log.warn({ err: genErr?.message }, "UseVelix generation request failed, using high-speed fallback");
    return await generateWithFastFallback({
      organizationId: input.organizationId,
      assetId: asset.id,
      channelId: input.channelId,
      conversationId: input.conversationId,
      prompt,
      title,
      concept: input.userInstruction,
      aspect: input.aspect || "1:1",
      notifyPhone: input.notifyPhone,
    });
  }

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
    prompt,
    aspect: input.aspect || "1:1",
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

  let provider: any = null;
  try {
    provider = await getCreativeProvider(input.organizationId);
  } catch (provErr: any) {
    log.warn({ err: provErr?.message }, "Creative provider not configured for smart edit, routing to fast FLUX fallback");
  }

  const nextVersionNum = latestVersion.version + 1;

  if (!provider) {
    return await generateWithFastFallback({
      organizationId: input.organizationId,
      assetId: asset.id,
      channelId: input.channelId,
      prompt: editPrompt,
      title: `${asset.title} (v${nextVersionNum})`,
      concept: input.editInstruction,
      aspect: "1:1",
      notifyPhone: input.notifyPhone,
    });
  }

  // Call Provider Smart-Edit
  let res: any;
  try {
    res = await provider.smartEdit({
      imageUrl,
      prompt: editPrompt,
      type: "photorealistic",
    });
  } catch (editErr: any) {
    log.warn({ err: editErr?.message }, "Smart edit failed on provider, falling back to fast FLUX");
    return await generateWithFastFallback({
      organizationId: input.organizationId,
      assetId: asset.id,
      channelId: input.channelId,
      prompt: editPrompt,
      title: `${asset.title} (v${nextVersionNum})`,
      concept: input.editInstruction,
      aspect: "1:1",
      notifyPhone: input.notifyPhone,
    });
  }

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
    prompt: editPrompt,
    aspect: "1:1",
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
 * High-speed fallback image generator using FLUX.
 * Produces vibrant, high-aesthetic posters in 2-4 seconds.
 */
function getFastFallbackUrl(prompt: string, aspect: string = "1:1"): string {
  const seed = Math.floor(Math.random() * 1000000);
  let width = 1024;
  let height = 1024;
  if (aspect === "9:16") {
    width = 768;
    height = 1344;
  } else if (aspect === "16:9") {
    width = 1344;
    height = 768;
  } else if (aspect === "4:5") {
    width = 864;
    height = 1080;
  }
  const cleanPrompt = encodeURIComponent(prompt.slice(0, 600));
  return `https://image.pollinations.ai/prompt/${cleanPrompt}?width=${width}&height=${height}&model=flux&seed=${seed}&nologo=true`;
}

/**
 * Complete asset generation using fast fallback provider.
 */
async function completeWithFastFallback(
  opts: {
    organizationId: string;
    channelId?: string;
    jobId: string;
    assetId: string;
    versionId: string;
    prompt: string;
    aspect?: string;
    notifyPhone?: string;
    title: string;
  }
): Promise<boolean> {
  try {
    const fallbackUrl = getFastFallbackUrl(opts.prompt, opts.aspect || "1:1");
    log.info({ assetId: opts.assetId, fallbackUrl }, "Generating creative with fast FLUX fallback");

    const dir = await ensureCreativeDir();
    const filename = `creative-${opts.assetId}-${opts.versionId}.jpg`;
    const localPath = path.join(dir, filename);
    let fileSaved = false;

    try {
      const imgRes = await fetch(fallbackUrl);
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        if (buf.length > 0) {
          await fs.writeFile(localPath, buf);
          fileSaved = true;
        }
      }
    } catch (saveErr: any) {
      log.warn({ err: saveErr?.message }, "Failed to write local fallback image");
    }

    await prisma.creativeVersion.update({
      where: { id: opts.versionId },
      data: {
        status: "READY",
        imageUrl: fallbackUrl,
        localPath: fileSaved ? localPath : null,
        creditsUsed: 5,
      },
    });

    await prisma.creativeAsset.update({
      where: { id: opts.assetId },
      data: { status: "READY" },
    });

    await prisma.aiJob.updateMany({
      where: { providerJobId: opts.jobId },
      data: {
        status: "DONE",
        outputUrl: fallbackUrl,
        creditsUsed: 5,
        completedAt: new Date(),
      },
    });

    await prisma.aiCreditBalance.update({
      where: { organizationId: opts.organizationId },
      data: {
        balance: { decrement: 5 },
        used: { increment: 5 },
      },
    }).catch(() => undefined);

    if (opts.channelId && opts.notifyPhone) {
      const caption = `🎨 *TenSy Creative Studio — पोस्टर तैयार है!*\n━━━━━━━━━━━━━━━━━━━━\n✨ *${opts.title}*\n\nयह पोस्टर आपकी व्यावसायिक ब्रांडिंग के अनुसार तैयार किया गया है।\n\nबदलाव या सुधार के लिए आप बोल या लिख सकते हैं:\n• *"रंग बदलो"*\n• *"लोगो छोटा करो"*\n• *"दूसरा बनाओ"*\n• *"Final"* (स्वीकृत करने के लिए)`;

      await whatsappClient.sendText(opts.channelId, opts.notifyPhone, caption, {
        imagePath: fileSaved ? localPath : undefined,
      }).catch((sendErr) => log.error({ err: sendErr?.message }, "Failed to dispatch creative to WhatsApp"));
    }

    log.info({ assetId: opts.assetId }, "Fast fallback creative generation succeeded!");
    return true;
  } catch (fallbackErr: any) {
    log.error({ err: fallbackErr?.message }, "Fast fallback creative generation also failed");
    return false;
  }
}

/**
 * Generates creative entirely via fast FLUX engine if primary provider is unavailable.
 */
async function generateWithFastFallback(input: {
  organizationId: string;
  assetId?: string;
  channelId?: string | null;
  conversationId?: string | null;
  prompt: string;
  title: string;
  concept: string;
  aspect: string;
  notifyPhone?: string;
}) {
  let assetId = input.assetId;
  if (!assetId) {
    const asset = await prisma.creativeAsset.create({
      data: {
        organizationId: input.organizationId,
        channelId: input.channelId || undefined,
        conversationId: input.conversationId || undefined,
        title: input.title,
        concept: input.concept,
        status: "GENERATING",
      },
    });
    assetId = asset.id;
  }

  const fallbackJobId = `fast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  const job = await prisma.aiJob.create({
    data: {
      organizationId: input.organizationId,
      channelId: input.channelId || undefined,
      feature: "creative",
      provider: "flux-fast",
      providerJobId: fallbackJobId,
      requestType: "text-to-image",
      prompt: input.prompt,
      status: "QUEUED",
      creditsUsed: 5,
    },
  });

  const existingCount = await prisma.creativeVersion.count({
    where: { assetId },
  });

  const version = await prisma.creativeVersion.create({
    data: {
      assetId,
      version: existingCount + 1,
      prompt: input.prompt,
      provider: "flux-fast",
      providerJobId: fallbackJobId,
      status: "GENERATING",
      creditsUsed: 5,
    },
  });

  await prisma.creativeAsset.update({
    where: { id: assetId },
    data: { currentVersionId: version.id, status: "GENERATING" },
  });

  void completeWithFastFallback({
    organizationId: input.organizationId,
    channelId: input.channelId || undefined,
    jobId: fallbackJobId,
    assetId,
    versionId: version.id,
    prompt: input.prompt,
    aspect: input.aspect,
    notifyPhone: input.notifyPhone,
    title: input.title,
  });

  return {
    assetId,
    versionId: version.id,
    jobId: fallbackJobId,
    prompt: input.prompt,
  };
}

/**
 * Asynchronous job poller with fast early polling.
 * Catches completion in 15-20 seconds. If provider fails, seamlessly falls back.
 */
async function pollJobUntilDone(opts: {
  organizationId: string;
  channelId?: string;
  jobId: string;
  assetId: string;
  versionId: string;
  prompt: string;
  aspect?: string;
  notifyPhone?: string;
  title: string;
}) {
  const provider = await getCreativeProvider(opts.organizationId).catch(() => null);
  if (!provider) return;

  // Fast intervals: 3s, 3s, 4s, 4s, 5s, 5s, 6s, 6s, 8s, 10s, 10s (~64s total)
  const intervals = [3000, 3000, 4000, 4000, 5000, 5000, 6000, 6000, 8000, 10000, 10000];
  let isDone = false;

  for (let i = 0; i < intervals.length; i++) {
    await new Promise((r) => setTimeout(r, intervals[i]));

    try {
      const status = await provider.getJobStatus(opts.jobId);
      log.info({ attempt: i + 1, status: status.status, hasUrl: !!status.imageUrl, jobId: opts.jobId }, "Polled creative job status");

      if (status.status === "done" && status.imageUrl) {
        isDone = true;

        // 1. Download image to shared local media storage
        const dir = await ensureCreativeDir();
        const filename = `creative-${opts.assetId}-${opts.versionId}.jpg`;
        const localPath = path.join(dir, filename);
        let fileSaved = false;

        try {
          const imgRes = await fetch(status.imageUrl);
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            if (buf.length > 0) {
              await fs.writeFile(localPath, buf);
              fileSaved = true;
            }
          }
        } catch (downloadErr: any) {
          log.warn({ err: downloadErr?.message }, "Failed to write local image");
        }

        // 2. Update CreativeVersion & CreativeAsset
        await prisma.creativeVersion.update({
          where: { id: opts.versionId },
          data: {
            status: "READY",
            imageUrl: status.imageUrl,
            localPath: fileSaved ? localPath : null,
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
          const caption = `🎨 *TenSy Creative Studio — पोस्टर तैयार है!*\n━━━━━━━━━━━━━━━━━━━━\n✨ *${opts.title}*\n\nयह पोस्टर आपकी व्यावसायिक ब्रांडिंग के अनुसार तैयार किया गया है।\n\nबदलाव या सुधार के लिए आप बोल या लिख सकते हैं:\n• *"रंग बदलो"*\n• *"लोगो छोटा करो"*\n• *"दूसरा बनाओ"*\n• *"Final"* (स्वीकृत करने के लिए)`;

          await whatsappClient.sendText(opts.channelId, opts.notifyPhone, caption, {
            imagePath: fileSaved ? localPath : undefined,
          }).catch((sendErr) => log.error({ err: sendErr?.message }, "Failed to dispatch creative to WhatsApp"));
        }

        break;
      }

      if (status.status === "failed") {
        log.warn({ jobId: opts.jobId, error: status.error }, "Provider returned failure, attempting fast fallback");
        const fallbackOk = await completeWithFastFallback(opts);
        if (fallbackOk) {
          isDone = true;
          break;
        }

        isDone = true;
        await markJobFailed(opts.jobId, opts.assetId, opts.versionId, status.error || "Provider generation failed");
        if (opts.channelId && opts.notifyPhone) {
          await whatsappClient.sendText(
            opts.channelId,
            opts.notifyPhone,
            "❌ Creative generation could not be completed at this time. Please try again in a few moments.",
          ).catch(() => undefined);
        }
        break;
      }
    } catch (pollErr: any) {
      log.warn({ err: pollErr?.message, attempt: i + 1 }, "Error polling UseVelix job");
    }
  }

  if (!isDone) {
    log.warn({ jobId: opts.jobId }, "Provider polling timed out, attempting fast fallback");
    const fallbackOk = await completeWithFastFallback(opts);
    if (!fallbackOk) {
      await markJobFailed(opts.jobId, opts.assetId, opts.versionId, "Generation timed out after 60 seconds");
    }
  }
}

async function markJobFailed(jobId: string, assetId: string, versionId: string, error: string) {
  await prisma.creativeVersion.update({
    where: { id: versionId },
    data: { status: "FAILED" },
  }).catch(() => undefined);

  await prisma.creativeAsset.update({
    where: { id: assetId },
    data: { status: "FAILED" },
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

/**
 * Permanently delete a creative asset and associated local files and versions.
 */
export async function deleteCreativeAsset(organizationId: string, assetId: string) {
  const asset = await prisma.creativeAsset.findFirst({
    where: { id: assetId, organizationId },
    include: { versions: true },
  });

  if (!asset) {
    throw new Error("Creative not found or unauthorized");
  }

  // Delete associated local files
  for (const ver of asset.versions) {
    if (ver.localPath) {
      await fs.unlink(ver.localPath).catch(() => undefined);
    }
  }

  // Unlink any festival campaigns referencing this creative
  await prisma.festivalCampaign.updateMany({
    where: { creativeAssetId: assetId },
    data: { creativeAssetId: null },
  }).catch(() => undefined);

  // Delete asset (versions cascade-delete)
  await prisma.creativeAsset.delete({
    where: { id: assetId },
  });

  return { success: true, deletedId: assetId };
}

