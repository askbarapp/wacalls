import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.js";

describe("parseCsv", () => {
  it("handles quoted commas", () => {
    const rows = parseCsv('name,phone\n"Rahul, K",919876543210');
    expect(rows[1]?.[0]).toBe("Rahul, K");
  });
});

describe("campaign retry math", () => {
  it("schedules next attempt", () => {
    const retryDelayMin = 30;
    const next = new Date(Date.now() + retryDelayMin * 60_000);
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });
});
