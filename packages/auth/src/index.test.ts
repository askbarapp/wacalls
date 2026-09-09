import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, assertPermission, newApiKey, API_KEY_BODY_LENGTH } from "./index.js";
import { ForbiddenError } from "@wacalls/shared";

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword(hash, "correct-horse")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });
});

describe("permissions", () => {
  it("blocks agents from channel management", () => {
    expect(() => assertPermission("AGENT", "channels.manage")).toThrow(ForbiddenError);
  });

  it("allows org admin", () => {
    expect(() => assertPermission("ORG_ADMIN", "channels.manage")).not.toThrow();
  });
});

describe("api keys", () => {
  it("makes a short live key with letters and digits", () => {
    const { plaintext, prefix } = newApiKey("secret");
    expect(plaintext).toMatch(new RegExp(`^wc_live_[A-Za-z0-9]{${API_KEY_BODY_LENGTH}}$`));
    expect(plaintext).toMatch(/[A-Za-z]/);
    expect(plaintext).toMatch(/[0-9]/);
    expect(prefix).toBe(plaintext.slice(0, 16));
    expect(plaintext.length).toBeLessThan(32);
  });

  it("makes a distinct website key", () => {
    const a = newApiKey("publishable");
    const b = newApiKey("publishable");
    expect(a.plaintext.startsWith("wc_pub_")).toBe(true);
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});
