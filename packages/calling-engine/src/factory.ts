import { EngineMisconfiguredError, type CallingEngine, type EngineName } from "./types.js";
import { MockEngine } from "./mock-engine.js";
import { SelfHostedWhatsAppEngine, type SelfHostedEngineOptions } from "./self-hosted-engine.js";
import { WavoipAdapter } from "./wavoip-adapter.js";

export type CreateEngineInput = {
  name: EngineName | string;
  appEnv: string;
  selfHosted?: SelfHostedEngineOptions;
};

export function createCallingEngine(input: CreateEngineInput): CallingEngine {
  const name = (input.name || "selfhosted") as EngineName;

  if (name === "mock") {
    if (input.appEnv !== "development") {
      throw new EngineMisconfiguredError(
        "MockEngine is development-only. Set CALLING_ENGINE=selfhosted in production.",
      );
    }
    return new MockEngine();
  }

  if (name === "wavoip") {
    return new WavoipAdapter();
  }

  if (!input.selfHosted) {
    throw new EngineMisconfiguredError("SelfHostedWhatsAppEngine requires sessionRoot options");
  }

  return new SelfHostedWhatsAppEngine(input.selfHosted);
}
