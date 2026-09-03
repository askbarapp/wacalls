import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { ChannelStatus } from "@wacalls/shared";
import {
  MOCK_CAPABILITIES,
  type CallEventHandler,
  type CallingEngine,
  type CallSession,
  type ConnectOptions,
  type EngineCapabilities,
  type EngineName,
  type InitiateCallOptions,
} from "./types.js";

type Active = {
  callId: string;
  channelId: string;
  phoneNumber: string;
  startedAt: number;
  timer?: NodeJS.Timeout;
};

/**
 * Development-only engine. Simulates ringing → answered → ended.
 * Factory refuses to construct this when APP_ENV is production.
 */
export class MockEngine implements CallingEngine {
  readonly name: EngineName = "mock";
  readonly capabilities: EngineCapabilities = MOCK_CAPABILITIES;
  private readonly events = new EventEmitter();
  private readonly channels = new Map<string, ChannelStatus>();
  private readonly qrs = new Map<string, string>();
  private readonly calls = new Map<string, Active>();

  async connect(channelId: string, _options?: ConnectOptions): Promise<void> {
    this.channels.set(channelId, "CONNECTING");
    this.emit({ type: "channel_status", channelId, timestamp: now(), status: "CONNECTING" });
    this.qrs.set(
      channelId,
      "data:image/svg+xml," +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#fff"/><rect x="16" y="16" width="48" height="48" fill="#111"/><rect x="176" y="16" width="48" height="48" fill="#111"/><rect x="16" y="176" width="48" height="48" fill="#111"/><text x="40" y="130" font-size="14" fill="#111">DEV QR</text></svg>`,
        ),
    );
    this.emit({
      type: "qr",
      channelId,
      timestamp: now(),
      qrDataUrl: this.qrs.get(channelId),
      status: "CONNECTING",
    });
    // Keep QR visible long enough for the UI to poll, then mark connected.
    setTimeout(() => {
      this.channels.set(channelId, "CONNECTED");
      this.qrs.delete(channelId);
      this.emit({
        type: "channel_status",
        channelId,
        timestamp: now(),
        status: "CONNECTED",
        phoneNumber: "+10000000000",
        displayName: "Mock WhatsApp",
      });
    }, 12_000);
  }

  async disconnect(channelId: string): Promise<void> {
    this.channels.set(channelId, "DISCONNECTED");
    this.emit({ type: "channel_status", channelId, timestamp: now(), status: "DISCONNECTED" });
  }

  async getStatus(channelId: string): Promise<ChannelStatus> {
    return this.channels.get(channelId) ?? "DISCONNECTED";
  }

  async getQr(channelId: string): Promise<string | null> {
    return this.qrs.get(channelId) ?? null;
  }

  async initiateCall(
    channelId: string,
    phoneNumber: string,
    _options?: InitiateCallOptions,
  ): Promise<CallSession> {
    if ((this.channels.get(channelId) ?? "DISCONNECTED") !== "CONNECTED") {
      throw new Error("Channel is not CONNECTED");
    }
    const callId = randomUUID();
    const session: CallSession = {
      callId,
      engineCallId: `mock_${callId}`,
      channelId,
      phoneNumber,
      status: "CONNECTING",
    };
    this.calls.set(callId, { callId, channelId, phoneNumber, startedAt: Date.now() });
    this.emit({ type: "connecting", callId, channelId, timestamp: now() });
    setTimeout(() => this.emit({ type: "ringing", callId, channelId, timestamp: now() }), 400);
    setTimeout(() => this.emit({ type: "answered", callId, channelId, timestamp: now() }), 1400);
    return session;
  }

  async hangup(callId: string): Promise<void> {
    const active = this.calls.get(callId);
    if (!active) return;
    const durationMs = Date.now() - active.startedAt;
    this.calls.delete(callId);
    this.emit({
      type: "ended",
      callId,
      channelId: active.channelId,
      timestamp: now(),
      durationMs,
      reason: "hangup",
    });
  }

  async mute(_callId: string, _muted: boolean): Promise<void> {
    return;
  }

  async sendAudio(_callId: string, _pcm: Float32Array): Promise<void> {
    return;
  }

  async sendText(_channelId: string, _phoneNumber: string, _text: string): Promise<{ id?: string }> {
    return { id: `mock_${Date.now()}` };
  }

  onCallEvent(handler: CallEventHandler): () => void {
    this.events.on("event", handler);
    return () => this.events.off("event", handler);
  }

  private emit(event: Parameters<CallEventHandler>[0]) {
    this.events.emit("event", event);
  }
}

function now() {
  return new Date().toISOString();
}
