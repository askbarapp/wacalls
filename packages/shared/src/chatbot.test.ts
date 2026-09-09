import { describe, expect, it } from "vitest";
import {
  isHandoffCommand,
  isStartCommand,
  isStopCommand,
  matchChatKeyword,
  normalizeChatText,
} from "./chatbot.js";

describe("chatbot keywords", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeChatText("  hi!! ")).toBe("HI");
  });

  it("detects STOP before other words", () => {
    expect(isStopCommand("stop")).toBe(true);
    expect(isStopCommand("please stop this")).toBe(false);
  });

  it("detects AGENT and START", () => {
    expect(isHandoffCommand("human")).toBe(true);
    expect(isStartCommand("Hello")).toBe(true);
  });

  it("matches exact then contains by sort order", () => {
    const keywords = [
      { trigger: "PRICE", matchType: "contains", enabled: true, sortOrder: 30, action: "reply" },
      { trigger: "HI", matchType: "exact", enabled: true, sortOrder: 20, action: "reply" },
      { trigger: "STOP", matchType: "exact", enabled: true, sortOrder: 0, action: "opt_out" },
    ];
    expect(matchChatKeyword("STOP", keywords)?.action).toBe("opt_out");
    expect(matchChatKeyword("hi", keywords)?.trigger).toBe("HI");
    expect(matchChatKeyword("send PRICE list", keywords)?.trigger).toBe("PRICE");
    expect(matchChatKeyword("this is high", keywords)).toBeNull();
  });
});
