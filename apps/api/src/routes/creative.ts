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
} from "../services/creative/creative-service.js";

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
      address: z.string().optional().nullable(),
      website: z.string().optional().nullable(),
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
            address: body.address,
            website: body.website,
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
            address: body.address,
            website: body.website,
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
      aspect: z.enum(["1:1", "9:16", "16:9"]).optional().default("1:1"),
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
};
