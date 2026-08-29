import { describe, expect, it } from "vitest";
import { nextRetryAt, shouldRetry } from "./retry.js";

describe("retry logic", () => {
  it("waits the configured delay", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(nextRetryAt(from, 30).toISOString()).toBe("2026-01-01T00:30:00.000Z");
  });

  it("never retries DO_NOT_CALL", () => {
    expect(shouldRetry({ attempts: 1, maxAttempts: 3, doNotCall: true, outcome: "NO_ANSWER" })).toBe(
      false,
    );
  });

  it("retries no-answer until max", () => {
    expect(shouldRetry({ attempts: 1, maxAttempts: 3, doNotCall: false, outcome: "NO_ANSWER" })).toBe(
      true,
    );
    expect(shouldRetry({ attempts: 3, maxAttempts: 3, doNotCall: false, outcome: "NO_ANSWER" })).toBe(
      false,
    );
  });
});
