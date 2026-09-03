import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PLANS = [
  {
    name: "Starter",
    slug: "starter",
    description: "Trial for a single WhatsApp Web line, calling, and light messaging.",
    maxChannels: 1,
    maxAgents: 3,
    maxKnowledgeBases: 1,
    maxAiAgents: 1,
    maxMessagesPerDay: 200,
    maxCallsPerDay: 50,
    allowCloudApi: false,
    allowSdk: true,
    priceMonthly: 0,
    isPublic: true,
    isDefault: true,
  },
  {
    name: "Growth",
    slug: "growth",
    description: "Multiple lines, Cloud API messaging, higher daily limits, and the calling SDK.",
    maxChannels: 5,
    maxAgents: 15,
    maxKnowledgeBases: 2,
    maxAiAgents: 3,
    maxMessagesPerDay: 2000,
    maxCallsPerDay: 500,
    allowCloudApi: true,
    allowSdk: true,
    priceMonthly: 4900,
    isPublic: true,
    isDefault: false,
  },
  {
    name: "Business",
    slug: "business",
    description: "Higher volume calling and bulk WhatsApp for agencies and larger teams.",
    maxChannels: 20,
    maxAgents: 50,
    maxKnowledgeBases: 4,
    maxAiAgents: 8,
    maxMessagesPerDay: 20000,
    maxCallsPerDay: 5000,
    allowCloudApi: true,
    allowSdk: true,
    priceMonthly: 14900,
    isPublic: true,
    isDefault: false,
  },
] as const;

async function seedPlans() {
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { slug: plan.slug },
      create: { ...plan },
      update: {
        name: plan.name,
        description: plan.description,
        maxChannels: plan.maxChannels,
        maxAgents: plan.maxAgents,
        maxKnowledgeBases: plan.maxKnowledgeBases,
        maxAiAgents: plan.maxAiAgents,
        maxMessagesPerDay: plan.maxMessagesPerDay,
        maxCallsPerDay: plan.maxCallsPerDay,
        allowCloudApi: plan.allowCloudApi,
        allowSdk: plan.allowSdk,
        priceMonthly: plan.priceMonthly,
        isPublic: plan.isPublic,
        isDefault: plan.isDefault,
      },
    });
  }
  const defaults = PLANS.filter((p) => p.isDefault).map((p) => p.slug);
  await prisma.plan.updateMany({
    where: { slug: { notIn: [...defaults] } },
    data: { isDefault: false },
  });
}

async function main() {
  await seedPlans();
  console.log("Seeded plans: starter, growth, business.");

  const email = process.env.ADMIN_EMAIL ?? "admin@localhost";
  const password = process.env.ADMIN_PASSWORD;
  const orgName = process.env.ADMIN_ORG_NAME ?? "WaCalls";

  const starter = await prisma.plan.findUnique({ where: { slug: "starter" } });
  const growth = await prisma.plan.findUnique({ where: { slug: "growth" } });
  const localPlan = process.env.APP_ENV === "development" ? growth ?? starter : starter;

  if (!password) {
    console.log("ADMIN_PASSWORD not set; skipping admin user.");
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.organization.updateMany({
      where: { planId: null },
      data: { planId: localPlan?.id, status: "ACTIVE" },
    });
    if (process.env.APP_ENV === "development" && growth) {
      await prisma.organization.updateMany({
        where: { OR: [{ billingEmail: email }, { name: orgName }] },
        data: { planId: growth.id, billingEmail: email },
      });
    }
    console.log("Admin user already exists.");
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "wacalls";

  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: orgName,
        slug,
        status: "ACTIVE",
        planId: localPlan?.id,
        billingEmail: email,
      },
    });
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        name: "Administrator",
        isSuperAdmin: true,
      },
    });
    await tx.organizationUser.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        role: "ORG_ADMIN",
      },
    });
  });

  console.log(`Seeded platform admin ${email} for organization ${orgName}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
