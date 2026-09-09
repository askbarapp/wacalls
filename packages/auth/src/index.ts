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
  scopes?: string[];
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

/** Letters + digits, skipping look-alikes (0/O, 1/l/I) so keys are easy to copy. */
const API_KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const API_KEY_BODY_LENGTH = 16;
export const API_KEY_PREFIX_LENGTH = 16;

function randomAlphanumeric(length: number): string {
  const alphabet = API_KEY_ALPHABET;
  const chars: string[] = [];
  while (chars.length < length) {
    const bytes = randomBytes(length);
    for (const byte of bytes) {
      if (byte >= 248) continue;
      chars.push(alphabet[byte % alphabet.length]!);
      if (chars.length === length) break;
    }
  }
  const joined = chars.join("");
  const hasLetter = /[A-Za-z]/.test(joined);
  const hasDigit = /[0-9]/.test(joined);
  if (hasLetter && hasDigit) return joined;
  chars[0] = "K";
  chars[1] = "7";
  return chars.join("");
}

export function newApiKey(kind: "secret" | "publishable" = "secret"): { plaintext: string; prefix: string } {
  const raw = randomAlphanumeric(API_KEY_BODY_LENGTH);
  const plaintext = kind === "publishable" ? `wc_pub_${raw}` : `wc_live_${raw}`;
  return { plaintext, prefix: plaintext.slice(0, API_KEY_PREFIX_LENGTH) };
}

export function isWaCallsApiKey(value: string): boolean {
  return value.startsWith("wc_live_") || value.startsWith("wc_pub_");
}
