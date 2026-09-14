import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { NotFoundError, ok } from "@wacalls/shared";
import { okPage, pageMeta, pageQuerySchema, pageSkip } from "../lib/pagination.js";
import {
  getProviderAdminSettings,
  getCreativeProvider,
} from "../services/creative/provider-factory.js";
import { UseVelixProvider } from "../services/creative/usevelix-provider.js";
import {
  createCreativeRequest,
  smartEditCreativeRequest,
  finalizeCreativeAsset,
  deleteCreativeAsset,
} from "../services/creative/creative-service.js";
import {
  seedStandardFestivals,
  runFestivalAutopilotTick,
} from "../services/creative/festival-scheduler.js";

export const creativeRoutes: FastifyPluginAsync = async (app) => {
  // -------------------------------------------------------------
  // 1. Business Profile Endpoints
  // -------------------------------------------------------------
  app.get("/creative/profile", async (req) => {
    const auth = await app.authenticate(req);
    const { channelId } = req.query as { channelId?: string };

    const profile = await prisma.businessProfile.findFirst({
      where: {
        organizationId: auth.orgId,
        ...(channelId ? { channelId } : {}),
      },
    });

    if (!profile) return ok(null);

    return ok({
      ...profile,
      products: profile.products ? profile.products.split(",").map((s) => s.trim()).filter(Boolean) : [],
      services: profile.services ? profile.services.split(",").map((s) => s.trim()).filter(Boolean) : [],
      tagline: profile.usp || null,
    });
  });

  app.put("/creative/profile", async (req) => {
    const auth = await app.authenticate(req);
    const schema = z.object({
      channelId: z.string().optional().nullable(),
      businessName: z.string().min(1),
      businessCategory: z.string().optional().nullable(),
      brandColors: z.string().optional().nullable(),
      brandStyle: z.string().optional().nullable(),
      tagline: z.string().optional().nullable(),
      products: z.array(z.string()).optional().default([]),
      services: z.array(z.string()).optional().default([]),
      defaultOffer: z.string().optional().nullable(),
      phone: z.string().optional().nullable(),
      email: z.string().optional().nullable(),
      address: z.string().optional().nullable(),
      website: z.string().optional().nullable(),
      logoUrl: z.string().optional().nullable(),
      creativePreferences: z.any().optional().nullable(),
      language: z.string().optional().default("Hindi + English"),
    });

    const body = schema.parse(req.body);
    const productsStr = Array.isArray(body.products) ? body.products.join(", ") : (body.products || null);
    const servicesStr = Array.isArray(body.services) ? body.services.join(", ") : (body.services || null);

    const existing = await prisma.businessProfile.findFirst({
      where: {
        organizationId: auth.orgId,
        ...(body.channelId ? { channelId: body.channelId } : { channelId: null }),
      },
    });

    const saved = existing
      ? await prisma.businessProfile.update({
          where: { id: existing.id },
          data: {
            businessName: body.businessName,
            businessCategory: body.businessCategory,
            brandColors: body.brandColors,
            brandStyle: body.brandStyle,
            usp: body.tagline || null,
            products: productsStr,
            services: servicesStr,
            defaultOffer: body.defaultOffer,
            phone: body.phone,
            email: body.email,
            address: body.address,
            website: body.website,
            logoUrl: body.logoUrl,
            creativePreferences: body.creativePreferences !== undefined ? body.creativePreferences : undefined,
            language: body.language,
          },
        })
      : await prisma.businessProfile.create({
          data: {
            organizationId: auth.orgId,
            channelId: body.channelId || null,
            businessName: body.businessName,
            businessCategory: body.businessCategory,
            brandColors: body.brandColors,
            brandStyle: body.brandStyle,
            usp: body.tagline || null,
            products: productsStr,
            services: servicesStr,
            defaultOffer: body.defaultOffer,
            phone: body.phone,
            email: body.email,
            address: body.address,
            website: body.website,
            logoUrl: body.logoUrl,
            creativePreferences: body.creativePreferences || undefined,
            language: body.language,
          },
        });

    return ok(saved);
  });

  // -------------------------------------------------------------
  // 2. AI Provider Settings (UseVelix)
  // -------------------------------------------------------------
  app.get("/creative/providers/usevelix", async (req) => {
    const auth = await app.authenticate(req);
    const settings = await getProviderAdminSettings(auth.orgId);
    return ok(settings);
  });

  app.put("/creative/providers/usevelix", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("settings.manage")(req).catch(async () => {
      if (!auth.superAdmin) throw new Error("forbidden");
    });

    const schema = z.object({
      apiKey: z.string().optional(),
      baseUrl: z.string().url().optional(),
      enabled: z.boolean().optional(),
      defaultType: z.string().optional(),
      defaultAspect: z.string().optional(),
    });

    const body = schema.parse(req.body);

    if (body.apiKey !== undefined && body.apiKey.trim() !== "") {
      await prisma.setting.upsert({
        where: { organizationId_key: { organizationId: auth.orgId, key: "usevelix_api_key" } },
        update: { value: body.apiKey.trim() },
        create: { organizationId: auth.orgId, key: "usevelix_api_key", value: body.apiKey.trim() },
      });
    }

    if (body.baseUrl !== undefined) {
      await prisma.setting.upsert({
        where: { organizationId_key: { organizationId: auth.orgId, key: "usevelix_base_url" } },
        update: { value: body.baseUrl.trim() },
        create: { organizationId: auth.orgId, key: "usevelix_base_url", value: body.baseUrl.trim() },
      });
    }

    if (body.enabled !== undefined) {
      await prisma.setting.upsert({
        where: { organizationId_key: { organizationId: auth.orgId, key: "usevelix_status" } },
        update: { value: body.enabled },
        create: { organizationId: auth.orgId, key: "usevelix_status", value: body.enabled },
      });
    }

    if (body.defaultType !== undefined) {
      await prisma.setting.upsert({
        where: { organizationId_key: { organizationId: auth.orgId, key: "usevelix_default_type" } },
        update: { value: body.defaultType },
        create: { organizationId: auth.orgId, key: "usevelix_default_type", value: body.defaultType },
      });
    }

    if (body.defaultAspect !== undefined) {
      await prisma.setting.upsert({
        where: { organizationId_key: { organizationId: auth.orgId, key: "usevelix_default_aspect" } },
        update: { value: body.defaultAspect },
        create: { organizationId: auth.orgId, key: "usevelix_default_aspect", value: body.defaultAspect },
      });
    }

    const updated = await getProviderAdminSettings(auth.orgId);
    return ok(updated);
  });

  app.post("/creative/providers/usevelix/test", async (req) => {
    const auth = await app.authenticate(req);
    const body = z
      .object({
        apiKey: z.string().optional(),
        baseUrl: z.string().url().optional(),
      })
      .parse(req.body ?? {});

    let provider: UseVelixProvider;
    if (body.apiKey && body.apiKey.trim()) {
      provider = new UseVelixProvider({
        apiKey: body.apiKey.trim(),
        baseUrl: body.baseUrl || "https://api.usevelix.com",
      });
    } else {
      const active = await getCreativeProvider(auth.orgId);
      if (!(active instanceof UseVelixProvider)) {
        throw new Error("Active provider is not UseVelix");
      }
      provider = active;
    }

    const result = await provider.testConnection();
    return ok(result);
  });

  // -------------------------------------------------------------
  // 3. Creative Credits & Balance
  // -------------------------------------------------------------
  app.get("/creative/credits", async (req) => {
    const auth = await app.authenticate(req);
    let credit = await prisma.aiCreditBalance.findUnique({
      where: { organizationId: auth.orgId },
    });

    if (!credit) {
      credit = await prisma.aiCreditBalance.create({
        data: {
          organizationId: auth.orgId,
          balance: 100,
          monthlyLimit: 100,
          used: 0,
        },
      });
    }

    return ok(credit);
  });

  // -------------------------------------------------------------
  // 4. Creative Generation & Edit Operations
  // -------------------------------------------------------------
  app.post("/creative/generate", async (req) => {
    const auth = await app.authenticate(req);
    const schema = z.object({
      channelId: z.string().optional().nullable(),
      festivalName: z.string().optional(),
      userInstruction: z.string().min(1, "Instruction is required"),
      creativeType: z.enum(["poster", "banner", "status"]).optional().default("poster"),
      aspect: z.enum(["1:1", "9:16", "16:9", "4:5"]).optional().default("1:1"),
      headlineText: z.string().optional(),
      ctaText: z.string().optional(),
      conceptTheme: z.string().optional(),
      showPhone: z.boolean().optional(),
      showWebsite: z.boolean().optional(),
      showEmail: z.boolean().optional(),
      showLogo: z.boolean().optional(),
      notifyPhone: z.string().optional(),
    });

    const body = schema.parse(req.body);

    const result = await createCreativeRequest({
      organizationId: auth.orgId,
      channelId: body.channelId,
      festivalName: body.festivalName,
      userInstruction: body.userInstruction,
      creativeType: body.creativeType,
      aspect: body.aspect,
      headlineText: body.headlineText,
      ctaText: body.ctaText,
      conceptTheme: body.conceptTheme,
      showPhone: body.showPhone,
      showWebsite: body.showWebsite,
      showEmail: body.showEmail,
      showLogo: body.showLogo,
      notifyPhone: body.notifyPhone,
    });

    return ok(result);
  });

  app.post("/creative/edit", async (req) => {
    const auth = await app.authenticate(req);
    const schema = z.object({
      assetId: z.string().min(1),
      channelId: z.string().optional().nullable(),
      editInstruction: z.string().min(1, "Edit instruction is required"),
      notifyPhone: z.string().optional(),
    });

    const body = schema.parse(req.body);

    const result = await smartEditCreativeRequest({
      organizationId: auth.orgId,
      assetId: body.assetId,
      channelId: body.channelId,
      editInstruction: body.editInstruction,
      notifyPhone: body.notifyPhone,
    });

    return ok(result);
  });

  app.post("/creative/:id/finalize", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };

    const asset = await prisma.creativeAsset.findFirst({
      where: { id, organizationId: auth.orgId },
    });

    if (!asset) throw new NotFoundError("Creative not found");

    const finalized = await finalizeCreativeAsset(id);
    return ok(finalized);
  });

  // -------------------------------------------------------------
  // 5. Creative Assets Query Endpoints
  // -------------------------------------------------------------
  app.get("/creative", async (req) => {
    const auth = await app.authenticate(req);
    const { page, limit } = pageQuerySchema.parse(req.query);
    const { status, channelId } = req.query as { status?: string; channelId?: string };

    const where: any = { organizationId: auth.orgId };
    if (status) where.status = status;
    if (channelId) where.channelId = channelId;

    const [items, total] = await Promise.all([
      prisma.creativeAsset.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pageSkip(page, limit),
        take: limit,
        include: {
          versions: { orderBy: { version: "desc" } },
        },
      }),
      prisma.creativeAsset.count({ where }),
    ]);

    return okPage(items, pageMeta(page, limit, total));
  });

  app.get("/creative/:id", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };

    const asset = await prisma.creativeAsset.findFirst({
      where: { id, organizationId: auth.orgId },
      include: {
        versions: { orderBy: { version: "desc" } },
        channel: { select: { id: true, displayName: true, phoneNumber: true } },
      },
    });

    if (!asset) throw new NotFoundError("Creative not found");

    return ok(asset);
  });

  app.delete("/creative/:id", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };

    const result = await deleteCreativeAsset(auth.orgId, id);
    return ok(result);
  });

  // -------------------------------------------------------------
  // 6. Festival Calendar Endpoints
  // -------------------------------------------------------------
  app.get("/creative/festivals", async (req) => {
    await app.authenticate(req);
    const { upcoming } = req.query as { upcoming?: string };

    const where: any = { active: true };
    if (upcoming === "true") {
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
      where.festivalDate = { gte: yesterday };
    }

    const festivals = await prisma.festival.findMany({
      where,
      orderBy: { festivalDate: "asc" },
    });

    return ok(festivals);
  });

  app.post("/creative/festivals", async (req) => {
    const auth = await app.authenticate(req);
    if (!auth.superAdmin) {
      await app.requirePermission("settings.manage")(req);
    }

    const schema = z.object({
      name: z.string().min(1),
      festivalDate: z.string(),
      triggerDaysBefore: z.number().int().min(0).max(30).default(2),
      creativeType: z.enum(["poster", "banner", "status"]).default("poster"),
      defaultPrompt: z.string().optional(),
      language: z.string().default("Hindi + English"),
      active: z.boolean().default(true),
    });

    const body = schema.parse(req.body);

    const festival = await prisma.festival.create({
      data: {
        name: body.name,
        festivalDate: new Date(body.festivalDate),
        triggerDaysBefore: body.triggerDaysBefore,
        creativeType: body.creativeType,
        defaultPrompt: body.defaultPrompt,
        language: body.language,
        active: body.active,
      },
    });

    return ok(festival);
  });

  app.put("/creative/festivals/:id", async (req) => {
    const auth = await app.authenticate(req);
    if (!auth.superAdmin) {
      await app.requirePermission("settings.manage")(req);
    }
    const { id } = req.params as { id: string };

    const schema = z.object({
      name: z.string().optional(),
      festivalDate: z.string().optional(),
      triggerDaysBefore: z.number().int().min(0).max(30).optional(),
      creativeType: z.enum(["poster", "banner", "status"]).optional(),
      defaultPrompt: z.string().optional(),
      active: z.boolean().optional(),
    });

    const body = schema.parse(req.body);

    const updated = await prisma.festival.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.festivalDate ? { festivalDate: new Date(body.festivalDate) } : {}),
        ...(body.triggerDaysBefore !== undefined ? { triggerDaysBefore: body.triggerDaysBefore } : {}),
        ...(body.creativeType ? { creativeType: body.creativeType } : {}),
        ...(body.defaultPrompt !== undefined ? { defaultPrompt: body.defaultPrompt } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });

    return ok(updated);
  });

  app.delete("/creative/festivals/:id", async (req) => {
    const auth = await app.authenticate(req);
    if (!auth.superAdmin) {
      await app.requirePermission("settings.manage")(req);
    }
    const { id } = req.params as { id: string };

    await prisma.festival.delete({ where: { id } });
    return ok({ deleted: true });
  });

  app.post("/creative/festivals/seed", async (req) => {
    const auth = await app.authenticate(req);
    if (!auth.superAdmin) {
      await app.requirePermission("settings.manage")(req);
    }

    const result = await seedStandardFestivals();
    return ok(result);
  });

  // -------------------------------------------------------------
  // 7. Festival Autopilot Settings & Triggers
  // -------------------------------------------------------------
  app.get("/creative/autopilot", async (req) => {
    const auth = await app.authenticate(req);
    const { channelId } = req.query as { channelId?: string };

    const entitlement = await prisma.featureEntitlement.findFirst({
      where: {
        organizationId: auth.orgId,
        ...(channelId ? { channelId } : {}),
        feature: "festival_autopilot",
      },
    });

    return ok({
      feature: "festival_autopilot",
      enabled: entitlement ? entitlement.enabled : true,
      channelId: channelId || null,
    });
  });

  app.put("/creative/autopilot", async (req) => {
    const auth = await app.authenticate(req);
    const schema = z.object({
      channelId: z.string().optional().nullable(),
      enabled: z.boolean(),
    });

    const body = schema.parse(req.body);

    const existing = await prisma.featureEntitlement.findFirst({
      where: {
        organizationId: auth.orgId,
        channelId: body.channelId || null,
        feature: "festival_autopilot",
      },
    });

    const entitlement = existing
      ? await prisma.featureEntitlement.update({
          where: { id: existing.id },
          data: { enabled: body.enabled },
        })
      : await prisma.featureEntitlement.create({
          data: {
            organizationId: auth.orgId,
            channelId: body.channelId || null,
            feature: "festival_autopilot",
            enabled: body.enabled,
          },
        });

    return ok(entitlement);
  });

  app.post("/creative/autopilot/run-now", async (req) => {
    const auth = await app.authenticate(req);
    if (!auth.superAdmin) {
      await app.requirePermission("settings.manage")(req);
    }

    const result = await runFestivalAutopilotTick();
    return ok(result);
  });

  // -------------------------------------------------------------
  // 8. Festival Campaigns History
  // -------------------------------------------------------------
  app.get("/creative/campaigns", async (req) => {
    const auth = await app.authenticate(req);
    const campaigns = await prisma.festivalCampaign.findMany({
      where: { organizationId: auth.orgId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        festival: { select: { name: true, festivalDate: true } },
        creativeAsset: {
          select: {
            id: true,
            title: true,
            status: true,
            versions: { orderBy: { version: "desc" }, take: 1 },
          },
        },
        channel: { select: { id: true, displayName: true, phoneNumber: true } },
      },
    });

    return ok(campaigns);
  });
};
