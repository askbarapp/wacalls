import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { ConflictError, ForbiddenError, NotFoundError, ok } from "@wacalls/shared";

function requirePlatform(auth: { superAdmin?: boolean }) {
  if (!auth.superAdmin) throw new ForbiddenError("Platform admin only");
}

export const platformRoutes: FastifyPluginAsync = async (app) => {
  app.get("/platform/overview", async (req) => {
    const auth = await app.authenticate(req);
    requirePlatform(auth);
    const [users, organizations, plans, orgs] = await Promise.all([
      prisma.user.count(),
      prisma.organization.count(),
      prisma.plan.count(),
      prisma.organization.findMany({
        select: {
          status: true,
          plan: { select: { name: true } },
          _count: { select: { users: true } },
        },
      }),
    ]);
    const byPlan = new Map<string, { name: string; organizations: number; users: number }>();
    const byStatus = { TRIAL: 0, ACTIVE: 0, SUSPENDED: 0 };
    for (const org of orgs) {
      const name = org.plan?.name ?? "No plan";
      const row = byPlan.get(name) ?? { name, organizations: 0, users: 0 };
      row.organizations += 1;
      row.users += org._count.users;
      byPlan.set(name, row);
      if (org.status === "TRIAL" || org.status === "ACTIVE" || org.status === "SUSPENDED") {
        byStatus[org.status] += 1;
      }
    }
    return ok({
      users,
      organizations,
      plans,
      byPlan: [...byPlan.values()].sort((a, b) => b.users - a.users),
      byStatus,
    });
  });

  app.get("/platform/plans", async (req) => {
    const auth = await app.authenticate(req);
    requirePlatform(auth);
    return ok(await prisma.plan.findMany({ orderBy: { priceMonthly: "asc" } }));
  });

  app.post("/platform/plans", async (req) => {
    const auth = await app.authenticate(req);
    requirePlatform(auth);
    const body = z
      .object({
        name: z.string().min(1),
        slug: z.string().min(2),
        description: z.string().optional(),
        maxChannels: z.number().int().min(1).default(1),
        maxAgents: z.number().int().min(1).default(3),
        maxKnowledgeBases: z.number().int().min(1).max(20).default(1),
        maxAiAgents: z.number().int().min(1).max(50).default(1),
        maxMessagesPerDay: z.number().int().min(1).default(200),
        maxCallsPerDay: z.number().int().min(1).default(50),
        allowCloudApi: z.boolean().default(false),
        allowSdk: z.boolean().default(true),
        priceMonthly: z.number().int().min(0).default(0),
        isPublic: z.boolean().default(true),
        isDefault: z.boolean().default(false),
      })
      .parse(req.body);
    if (body.isDefault) {
      await prisma.plan.updateMany({ data: { isDefault: false } });
    }
    return ok(await prisma.plan.create({ data: body }));
  });

  app.patch("/platform/plans/:id", async (req) => {
    const auth = await app.authenticate(req);
    requirePlatform(auth);
    const { id } = req.params as { id: string };
    const body = z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
        maxChannels: z.number().int().optional(),
        maxAgents: z.number().int().optional(),
        maxKnowledgeBases: z.number().int().min(1).max(20).optional(),
        maxAiAgents: z.number().int().min(1).max(50).optional(),
        maxMessagesPerDay: z.number().int().optional(),
        maxCallsPerDay: z.number().int().optional(),
        allowCloudApi: z.boolean().optional(),
        allowSdk: z.boolean().optional(),
        priceMonthly: z.number().int().optional(),
        isPublic: z.boolean().optional(),
        isDefault: z.boolean().optional(),
      })
      .parse(req.body);
    if (body.isDefault) {
      await prisma.plan.updateMany({ data: { isDefault: false } });
    }
    return ok(await prisma.plan.update({ where: { id }, data: body }));
  });

  app.get("/platform/organizations", async (req) => {
    const auth = await app.authenticate(req);
    requirePlatform(auth);
    return ok(
      await prisma.organization.findMany({
        include: { plan: true, _count: { select: { users: true, channels: true, calls: true } } },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  app.patch("/platform/organizations/:id", async (req) => {
    const auth = await app.authenticate(req);
    requirePlatform(auth);
    const { id } = req.params as { id: string };
    const body = z
      .object({
        status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED"]).optional(),
        planId: z.string().uuid().nullable().optional(),
        name: z.string().optional(),
        billingEmail: z.preprocess(
          (v) => (v === "" || v == null ? null : v),
          z.string().email().nullable().optional(),
        ),
      })
      .parse(req.body);
    const org = await prisma.organization.update({ where: { id }, data: body });
    return ok(org);
  });

  app.get("/platform/users", async (req) => {
    const auth = await app.authenticate(req);
    requirePlatform(auth);
    return ok(
      await prisma.user.findMany({
        include: {
          memberships: {
            include: {
              organization: {
                select: {
                  name: true,
                  slug: true,
                  status: true,
                  billingEmail: true,
                  plan: { select: { id: true, name: true, slug: true, priceMonthly: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    );
  });

  app.patch("/platform/users/:id", async (req) => {
    const auth = await app.authenticate(req);
    requirePlatform(auth);
    const { id } = req.params as { id: string };
    const body = z.object({ isActive: z.boolean().optional(), isSuperAdmin: z.boolean().optional() }).parse(req.body);
    if (id === auth.sub && body.isActive === false) {
      throw new ConflictError("You cannot deactivate your own platform admin.");
    }
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError("User not found");
    return ok(await prisma.user.update({ where: { id }, data: body }));
  });
};
