import { describe, expect, it } from "vitest";
import { roleHas } from "./enums.js";

describe("RBAC", () => {
  it("isolates agent from sessions/credentials permissions", () => {
    expect(roleHas("AGENT", "channels.manage")).toBe(false);
    expect(roleHas("AGENT", "api_keys.manage")).toBe(false);
    expect(roleHas("AGENT", "dialer.use")).toBe(true);
  });

  it("gives org admin tenant admin powers", () => {
    expect(roleHas("ORG_ADMIN", "campaigns.manage")).toBe(true);
  });
});
