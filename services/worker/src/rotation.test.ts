import { describe, expect, it } from "vitest";
import { pickRotatedChannel, rotationPool } from "./rotation.js";

const lines = [
  { id: "a", status: "CONNECTED", provider: "WEB" },
  { id: "b", status: "CONNECTED", provider: "WEB" },
  { id: "c", status: "DISCONNECTED", provider: "WEB" },
  { id: "d", status: "CONNECTED", provider: "CLOUD" },
];

describe("rotationPool", () => {
  it("honors rotation limit", () => {
    expect(rotationPool(lines, 2).map((c) => c.id)).toEqual(["a", "b"]);
    expect(rotationPool(lines, 0)).toHaveLength(4);
  });
});

describe("pickRotatedChannel", () => {
  it("round-robins connected voice lines and skips busy or cloud", () => {
    const pool = rotationPool(lines, 0);
    expect(pickRotatedChannel(pool, 0, new Set(), { voice: true })?.id).toBe("a");
    expect(pickRotatedChannel(pool, 1, new Set(), { voice: true })?.id).toBe("b");
    expect(pickRotatedChannel(pool, 2, new Set(), { voice: true })?.id).toBe("a");
    expect(pickRotatedChannel(pool, 0, new Set(["a"]), { voice: true })?.id).toBe("b");
    expect(pickRotatedChannel(pool, 0, new Set(["a", "b"]), { voice: true })).toBeNull();
  });

  it("uses cloud lines for messaging", () => {
    const pool = rotationPool(lines, 0);
    expect(pickRotatedChannel(pool, 3, new Set())?.id).toBe("d");
  });
});
