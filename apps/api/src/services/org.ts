import { prisma } from "@wacalls/database";
import { ConflictError, ForbiddenError, NotFoundError } from "@wacalls/shared";

export async function uniqueOrgSlug(name: string) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "account";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const exists = await prisma.organization.findUnique({ where: { slug } });
    if (!exists) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function loadOrg(orgId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { plan: true },
  });
  if (!org) throw new NotFoundError("Organization not found");
  return org;
}

export async function assertOrgActive(orgId: string) {
  const org = await loadOrg(orgId);
  if (org.status === "SUSPENDED") {
    throw new ForbiddenError("This account is suspended. Contact the platform admin.");
  }
  return org;
}

export async function assertChannelQuota(orgId: string) {
  const org = await assertOrgActive(orgId);
  if (!org.plan) return org;
  const count = await prisma.whatsAppChannel.count({ where: { organizationId: orgId } });
  if (count >= org.plan.maxChannels) {
    throw new ConflictError(
      `Plan limit: ${org.plan.maxChannels} WhatsApp channel(s). Ask the platform admin to upgrade.`,
    );
  }
  return org;
}

export async function assertAgentQuota(orgId: string) {
  const org = await assertOrgActive(orgId);
  if (!org.plan) return org;
  const count = await prisma.organizationUser.count({ where: { organizationId: orgId } });
  if (count >= org.plan.maxAgents) {
    throw new ConflictError(
      `Plan limit: ${org.plan.maxAgents} team member(s). Ask the platform admin to upgrade.`,
    );
  }
  return org;
}

export async function assertCallQuota(orgId: string) {
  const org = await assertOrgActive(orgId);
  if (!org.plan) return org;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const count = await prisma.call.count({
    where: { organizationId: orgId, createdAt: { gte: start } },
  });
  if (count >= org.plan.maxCallsPerDay) {
    throw new ConflictError(`Daily call limit reached (${org.plan.maxCallsPerDay}). Upgrade the plan.`);
  }
  return org;
}

export async function assertKnowledgeQuota(orgId: string) {
  const org = await assertOrgActive(orgId);
  if (!org.plan) return org;
  const count = await prisma.knowledgeBase.count({ where: { organizationId: orgId } });
  if (count >= org.plan.maxKnowledgeBases) {
    throw new ConflictError(
      `Plan limit: ${org.plan.maxKnowledgeBases} knowledge base(s). Upgrade to add more.`,
    );
  }
  return org;
}

export async function assertAiAgentQuota(orgId: string) {
  const org = await assertOrgActive(orgId);
  if (!org.plan) return org;
  const count = await prisma.aiConfig.count({ where: { organizationId: orgId } });
  if (count >= org.plan.maxAiAgents) {
    throw new ConflictError(
      `Plan limit: ${org.plan.maxAiAgents} AI agent(s). Upgrade to add more.`,
    );
  }
  return org;
}

export async function defaultPlan() {
  return (
    (await prisma.plan.findFirst({ where: { isDefault: true } })) ??
    (await prisma.plan.findFirst({ where: { slug: "starter" } }))
  );
}
