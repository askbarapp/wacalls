import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@wacalls/database";
import {
  sha256,
  verifyAccessToken,
  type AccessClaims,
} from "@wacalls/auth";
import { AppError, ForbiddenError, UnauthorizedError, roleHas, type Role } from "@wacalls/shared";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AccessClaims;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<AccessClaims>;
    requirePermission: (permission: string) => (req: FastifyRequest) => Promise<void>;
    requireScope: (scope: string) => (req: FastifyRequest) => Promise<void>;
  }
}

async function authenticate(req: FastifyRequest): Promise<AccessClaims> {
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const cookie = req.cookies?.access_token;
  const apiKey = req.headers["x-api-key"];

  if (typeof apiKey === "string" && (apiKey.startsWith("wc_live_") || apiKey.startsWith("wc_pub_"))) {
    const prefix = apiKey.slice(0, 16);
    const row = await prisma.apiKey.findFirst({
      where: { prefix, revokedAt: null },
    });
    if (!row || sha256(apiKey) !== row.keyHash) {
      throw new UnauthorizedError("Invalid API key");
    }
    const org = await prisma.organization.findUnique({
      where: { id: row.organizationId },
      include: { plan: true },
    });
    if (!org) throw new UnauthorizedError("Invalid API key");
    if (org.status === "SUSPENDED") {
      throw new ForbiddenError("This account is suspended.");
    }
    if (org.plan && !org.plan.allowSdk) {
      throw new ForbiddenError("API / SDK access is not included in the current plan.");
    }
    await prisma.apiKey.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    });
    const membership = await prisma.organizationUser.findFirst({
      where: { organizationId: row.organizationId, role: { in: ["ORG_ADMIN", "MANAGER"] } },
      include: { user: true },
    });
    const claims: AccessClaims = {
      sub: membership?.userId ?? "api-key",
      email: membership?.user.email ?? "api@key",
      orgId: row.organizationId,
      role: "ORG_ADMIN",
      superAdmin: false,
      scopes: row.scopes ?? ["calls:write", "messages:write", "channels:read"],
    };
    req.auth = claims;
    return claims;
  }

  const token = bearer ?? cookie;
  if (!token) throw new UnauthorizedError();
  try {
    const claims = await verifyAccessToken(token, env.JWT_SECRET);
    if (claims.orgId && !claims.superAdmin) {
      const org = await prisma.organization.findUnique({
        where: { id: claims.orgId },
        select: { status: true },
      });
      if (org?.status === "SUSPENDED") {
        throw new ForbiddenError("This account is suspended.");
      }
    }
    req.auth = claims;
    return claims;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new UnauthorizedError("Invalid or expired token");
  }
}

export const registerAuth = fp(async (app: FastifyInstance) => {
  app.decorate("authenticate", authenticate);
  app.decorate("requirePermission", (permission: string) => async (req: FastifyRequest) => {
    const auth = await authenticate(req);
    if (auth.superAdmin) return;
    if (!roleHas(auth.role as Role, permission)) {
      throw new ForbiddenError();
    }
  });
  app.decorate("requireScope", (scope: string) => async (req: FastifyRequest) => {
    const auth = await authenticate(req);
    if (auth.superAdmin || !auth.scopes?.length) return;
    if (!auth.scopes.includes(scope) && !auth.scopes.includes("*")) {
      throw new ForbiddenError(`API key is missing scope ${scope}`);
    }
  });
});
