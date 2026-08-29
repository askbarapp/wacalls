import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { ForbiddenError, roleHas, type Role } from "@wacalls/shared";

export type AccessClaims = {
  sub: string;
  email: string;
  orgId: string;
  role: Role;
  superAdmin: boolean;
};

const encoder = new TextEncoder();

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export async function signAccessToken(
  claims: AccessClaims,
  secret: string,
  ttl = "15m",
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(encoder.encode(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, encoder.encode(secret));
  return payload as unknown as AccessClaims;
}

export function assertPermission(role: Role, permission: string): void {
  if (!roleHas(role, permission)) {
    throw new ForbiddenError("Insufficient permissions");
  }
}

export function newApiKey(): { plaintext: string; prefix: string } {
  const raw = randomBytes(24).toString("base64url");
  const plaintext = `wc_live_${raw}`;
  return { plaintext, prefix: plaintext.slice(0, 16) };
}
