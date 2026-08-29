import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@wacalls/database";
import {
  sha256,
  verifyAccessToken,
  type AccessClaims,
} from "@wacalls/auth";
import { ForbiddenError, UnauthorizedError, roleHas, type Role } from "@wacalls/shared";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AccessClaims;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<AccessClaims>;
    requirePermission: (permission: string) => (req: FastifyRequest) => Promise<void>;
  }
}

async function authenticate(req: FastifyRequest): Promise<AccessClaims> {
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const cookie = req.cookies?.access_token;
  const apiKey = req.headers["x-api-key"];

  if (typeof apiKey === "string" && apiKey.startsWith("wc_live_")) {
    const prefix = apiKey.slice(0, 16);
    const row = await prisma.apiKey.findFirst({
      where: { prefix, revokedAt: null },
    });
    if (!row || sha256(apiKey) !== row.keyHash) {
      throw new UnauthorizedError("Invalid API key");
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
    };
    req.auth = claims;
    return claims;
  }

  const token = bearer ?? cookie;
  if (!token) throw new UnauthorizedError();
  try {
    const claims = await verifyAccessToken(token, env.JWT_SECRET);
    req.auth = claims;
    return claims;
  } catch {
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
});
