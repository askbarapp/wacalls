import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import {
  hashPassword,
  randomToken,
  sha256,
  signAccessToken,
  verifyPassword,
} from "@wacalls/auth";
import { ok, UnauthorizedError } from "@wacalls/shared";
import { env } from "../env.js";
import { sendMail } from "../services/mail.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  remember: z.boolean().optional(),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
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
    const claims = {
      sub: user.id,
      email: user.email,
      orgId: membership?.organizationId ?? "",
      role: membership?.role ?? "SUPER_ADMIN",
      superAdmin: user.isSuperAdmin,
    };
    const access = await signAccessToken(claims, env.JWT_SECRET, env.JWT_ACCESS_TTL);
    const refresh = randomToken();
    const days = body.remember ? 30 : 7;
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refresh),
        expiresAt: new Date(Date.now() + days * 86400_000),
      },
    });
    reply.setCookie("access_token", access, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: env.APP_ENV === "production",
      maxAge: 15 * 60,
    });
    reply.setCookie("refresh_token", refresh, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: env.APP_ENV === "production",
      maxAge: days * 86400,
    });
    return ok({
      accessToken: access,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: claims.role,
        organizationId: claims.orgId,
        superAdmin: user.isSuperAdmin,
      },
    });
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
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: env.APP_ENV === "production",
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
    return ok({
      id: user.id,
      email: user.email,
      name: user.name,
      role: auth.role,
      organizationId: auth.orgId,
      superAdmin: auth.superAdmin,
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
    const body = z.object({ email: z.string().email() }).parse(req.body);
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
      await sendMail(
        user.email,
        "Reset your WaCalls password",
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
