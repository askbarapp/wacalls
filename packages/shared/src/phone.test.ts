import { describe, expect, it } from "vitest";
import { normalizePhone, toWhatsAppJid } from "./phone.js";

describe("normalizePhone", () => {
  it("normalizes Indian numbers without plus", () => {
    const result = normalizePhone("919876543210");
    expect(result).toEqual({ ok: true, e164: "+919876543210" });
  });

  it("normalizes local numbers with default country", () => {
    const result = normalizePhone("9876543210", "IN");
    expect(result).toEqual({ ok: true, e164: "+919876543210" });
  });

  it("rejects empty", () => {
    expect(normalizePhone("").ok).toBe(false);
  });

  it("rejects invalid", () => {
    expect(normalizePhone("123").ok).toBe(false);
  });
});

describe("toWhatsAppJid", () => {
  it("strips plus and formatting", () => {
    expect(toWhatsAppJid("+91 98765 43210")).toBe("919876543210@s.whatsapp.net");
  });
});
