import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, assertPermission } from "./index.js";
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
