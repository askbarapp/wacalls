import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import {
  hashPassword,
  randomToken,
  sha256,
  signAccessToken,
  verifyPassword,
} from "@wacalls/auth";
import { ConflictError, ok, UnauthorizedError, type Role } from "@wacalls/shared";
import { env } from "../env.js";
import { sendMail } from "../services/mail.js";
import { defaultPlan, uniqueOrgSlug } from "../services/org.js";
import { loadBranding } from "../services/branding.js";
import { existsSync } from "node:fs";

function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)\s*([smhd])$/i.exec(ttl.trim());
  if (!match?.[1] || !match[2]) return 12 * 3600;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "s") return value;
  if (unit === "m") return value * 60;
  if (unit === "h") return value * 3600;
  return value * 86400;
}

function cookieBase() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: env.APP_ENV === "production",
  };
}

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[^\s@]+@[^\s@]+$/, "Invalid email");

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(8),
  remember: z.boolean().optional(),
});

async function issueSession(
  reply: FastifyReply,
  user: {
    id: string;
    email: string;
    name: string;
    isSuperAdmin: boolean;
  },
  membership: { organizationId: string; role: Role } | undefined,
  remember?: boolean,
) {
  const claims = {
    sub: user.id,
    email: user.email,
    orgId: membership?.organizationId ?? "",
    role: membership?.role ?? ("SUPER_ADMIN" as Role),
    superAdmin: user.isSuperAdmin,
  };
  const access = await signAccessToken(claims, env.JWT_SECRET, env.JWT_ACCESS_TTL);
  const refresh = randomToken();
  const days = remember ? 30 : 7;
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refresh),
      expiresAt: new Date(Date.now() + days * 86400_000),
    },
  });
  const accessCookie = {
    ...cookieBase(),
    ...(remember ? { maxAge: ttlToSeconds(env.JWT_ACCESS_TTL) } : {}),
  };
  const refreshCookie = {
    ...cookieBase(),
    ...(remember ? { maxAge: days * 86400 } : {}),
  };
  reply.setCookie("access_token", access, accessCookie);
  reply.setCookie("refresh_token", refresh, refreshCookie);
  return {
    accessToken: access,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: claims.role,
      organizationId: claims.orgId,
      superAdmin: user.isSuperAdmin,
    },
  };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/register", async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(2),
        email: emailField,
        password: z.string().min(8),
        organizationName: z.string().trim().min(2),
      })
      .parse(req.body);
    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictError("An account with this email already exists. Sign in instead.");
    }
    const plan = await defaultPlan();
    const slug = await uniqueOrgSlug(body.organizationName);
    const created = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: body.organizationName,
          slug,
          status: "TRIAL",
          planId: plan?.id,
          billingEmail: email,
        },
      });
      const user = await tx.user.create({
        data: {
          email,
          name: body.name,
          passwordHash: await hashPassword(body.password),
        },
      });
      const membership = await tx.organizationUser.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          role: "ORG_ADMIN",
        },
      });
      return { user, membership };
    });
    return ok(await issueSession(reply, created.user, created.membership, true));
  });

  app.post("/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
      include: { memberships: true },
    });
    if (!user || !user.isActive || !(await verifyPassword(user.passwordHash, body.password))) {
      throw new UnauthorizedError("Invalid email or password");
    }
    const membership = user.memberships[0];
    if (!membership && !user.isSuperAdmin) {
      throw new UnauthorizedError("No organization membership");
    }
    if (membership && !user.isSuperAdmin) {
      const org = await prisma.organization.findUnique({ where: { id: membership.organizationId } });
      if (org?.status === "SUSPENDED") {
        throw new UnauthorizedError("This account is suspended. Contact support.");
      }
    }
    return ok(await issueSession(reply, user, membership, body.remember));
  });

  app.post("/refresh", async (req, reply) => {
    const token = req.cookies.refresh_token;
    if (!token) throw new UnauthorizedError();
    const row = await prisma.refreshToken.findFirst({
      where: { tokenHash: sha256(token), revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { include: { memberships: true } } },
    });
    if (!row || !row.user.isActive) throw new UnauthorizedError();
    const membership = row.user.memberships[0];
    const access = await signAccessToken(
      {
        sub: row.user.id,
        email: row.user.email,
        orgId: membership?.organizationId ?? "",
        role: membership?.role ?? "SUPER_ADMIN",
        superAdmin: row.user.isSuperAdmin,
      },
      env.JWT_SECRET,
      env.JWT_ACCESS_TTL,
    );
    reply.setCookie("access_token", access, {
      ...cookieBase(),
      ...(row.expiresAt.getTime() - Date.now() > 14 * 86400_000
        ? { maxAge: ttlToSeconds(env.JWT_ACCESS_TTL) }
        : {}),
    });
    return ok({ accessToken: access });
  });

  app.post("/logout", async (req, reply) => {
    const token = req.cookies.refresh_token;
    if (token) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(token) },
        data: { revokedAt: new Date() },
      });
    }
    reply.clearCookie("access_token", { path: "/" });
    reply.clearCookie("refresh_token", { path: "/" });
    return ok({ loggedOut: true });
  });

  app.get("/me", async (req) => {
    const auth = await app.authenticate(req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.sub } });
    const organization = auth.orgId
      ? await prisma.organization.findUnique({
          where: { id: auth.orgId },
          include: { plan: true },
        })
      : null;
    return ok({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone ?? "",
      hasAvatar: Boolean(user.avatarPath && existsSync(user.avatarPath)),
      role: auth.role,
      organizationId: auth.orgId,
      superAdmin: auth.superAdmin,
      organization,
    });
  });

  app.post("/change-password", async (req) => {
    const auth = await app.authenticate(req);
    const body = z
      .object({ current: z.string(), next: z.string().min(10) })
      .parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.sub } });
    if (!(await verifyPassword(user.passwordHash, body.current))) {
      throw new UnauthorizedError("Current password is incorrect");
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.next) },
    });
    return ok({ changed: true });
  });

  app.post("/forgot-password", async (req) => {
    const body = z.object({ email: emailField }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (user) {
      const token = randomToken();
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      const { brand } = await loadBranding();
      await sendMail(
        user.email,
        `Reset your ${brand.brandName} password`,
        `Reset token (expires 1 hour): ${token}\nUse POST /api/v1/auth/reset-password`,
      );
    }
    return ok({ sent: true });
  });

  app.post("/reset-password", async (req) => {
    const body = z.object({ token: z.string(), password: z.string().min(10) }).parse(req.body);
    const row = await prisma.passwordReset.findFirst({
      where: { tokenHash: sha256(body.token), usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!row) throw new UnauthorizedError("Invalid reset token");
    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash: await hashPassword(body.password) },
      }),
      prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);
    return ok({ reset: true });
  });
};
