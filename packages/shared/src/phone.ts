import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export type PhoneNormalizeResult =
  | { ok: true; e164: string }
  | { ok: false; reason: string };

export function normalizePhone(
  raw: string,
  defaultCountry: CountryCode = "IN",
): PhoneNormalizeResult {
  const trimmed = raw.trim().replace(/[\s()-]/g, "");
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }

  const withPlus = trimmed.startsWith("+") ? trimmed : `+${trimmed.replace(/^\+/, "")}`;
  let parsed = parsePhoneNumberFromString(withPlus);

  if (!parsed || !parsed.isValid()) {
    parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  }

  if (!parsed || !parsed.isValid()) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, e164: parsed.number };
}

export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function toWhatsAppJid(e164: string): string {
  return `${digitsOnly(e164)}@s.whatsapp.net`;
}
