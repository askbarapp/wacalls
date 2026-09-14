import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function getKey(): Buffer {
  const secret =
    process.env.EMAIL_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    "wacalls-default-email-security-key-32b!";
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a plain string (such as an IMAP/SMTP password) using AES-256-GCM.
 * Output format: iv:authTag:encryptedHex
 */
export function encryptCredential(plainText: string): string {
  if (!plainText) return "";
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * Gracefully falls back to plainText if it is an unencrypted legacy string.
 */
export function decryptCredential(cipherText: string): string {
  if (!cipherText) return "";
  const parts = cipherText.split(":");
  if (parts.length !== 3) {
    return cipherText;
  }
  const ivHex = parts[0];
  const authTagHex = parts[1];
  const encryptedHex = parts[2];
  if (!ivHex || !authTagHex || !encryptedHex) {
    return cipherText;
  }
  try {
    const key = getKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = decipher.update(encryptedHex, "hex", "utf8") + decipher.final("utf8");
    return decrypted;
  } catch (err) {
    return cipherText;
  }
}

/**
 * Mask password for API responses (never reveal plaintext password to frontend).
 */
export function maskPassword(password?: string | null): string {
  if (!password) return "";
  return "••••••••";
}
