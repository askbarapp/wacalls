import { describe, expect, it } from "vitest";
import { parseBaileysInbound } from "./inbound-text.js";

describe("parseBaileysInbound", () => {
  it("skips fromMe and groups", () => {
    expect(
      parseBaileysInbound({
        key: { fromMe: true, remoteJid: "9198@s.whatsapp.net", id: "1" },
        message: { conversation: "hi" },
      }),
    ).toBeNull();
    expect(
      parseBaileysInbound({
        key: { fromMe: false, remoteJid: "120363@g.us", id: "1" },
        message: { conversation: "hi" },
      }),
    ).toBeNull();
  });

  it("extracts 1:1 text", () => {
    expect(
      parseBaileysInbound({
        key: { fromMe: false, remoteJid: "919876543210@s.whatsapp.net", id: "abc" },
        message: { conversation: "Hello" },
      }),
    ).toEqual({ phone: "+919876543210", text: "Hello", messageId: "abc" });
  });
});
