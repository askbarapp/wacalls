import { describe, expect, it } from "vitest";
import { createCallingEngine } from "./factory.js";
import { EngineMisconfiguredError } from "./types.js";

describe("createCallingEngine", () => {
  it("refuses mock in production", () => {
    expect(() => createCallingEngine({ name: "mock", appEnv: "production" })).toThrow(
      EngineMisconfiguredError,
    );
  });

  it("allows mock in development", () => {
    const engine = createCallingEngine({ name: "mock", appEnv: "development" });
    expect(engine.name).toBe("mock");
    expect(engine.capabilities.outboundVoice).toBe(true);
  });
});
