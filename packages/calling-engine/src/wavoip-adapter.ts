import {
  WAVOIP_CAPABILITIES,
  UnsupportedCapabilityError,
  type CallEventHandler,
  type CallingEngine,
  type CallSession,
  type EngineCapabilities,
  type EngineName,
  type InitiateCallOptions,
} from "./types.js";
import type { ChannelStatus } from "@wacalls/shared";

/**
 * Optional future adapter. Product code must not import Wavoip directly.
 * All methods throw until a real adapter is wired via env credentials.
 */
export class WavoipAdapter implements CallingEngine {
  readonly name: EngineName = "wavoip";
  readonly capabilities: EngineCapabilities = WAVOIP_CAPABILITIES;

  async connect(_channelId: string): Promise<void> {
    throw new UnsupportedCapabilityError("connect", this.name);
  }

  async disconnect(_channelId: string): Promise<void> {
    throw new UnsupportedCapabilityError("disconnect", this.name);
  }

  async getStatus(_channelId: string): Promise<ChannelStatus> {
    return "DISCONNECTED";
  }

  async getQr(_channelId: string): Promise<string | null> {
    return null;
  }

  async initiateCall(
    _channelId: string,
    _phoneNumber: string,
    _options?: InitiateCallOptions,
  ): Promise<CallSession> {
    throw new UnsupportedCapabilityError("initiateCall", this.name);
  }

  async hangup(_callId: string): Promise<void> {
    throw new UnsupportedCapabilityError("hangup", this.name);
  }

  async mute(_callId: string, _muted: boolean): Promise<void> {
    throw new UnsupportedCapabilityError("mute", this.name);
  }

  async sendAudio(_callId: string, _pcm: Float32Array): Promise<void> {
    throw new UnsupportedCapabilityError("sendAudio", this.name);
  }

  onCallEvent(_handler: CallEventHandler): () => void {
    return () => undefined;
  }
}
