import type { CallStatus, ChannelStatus } from "@wacalls/shared";

export type EngineName = "selfhosted" | "mock" | "wavoip";

export type EngineCapabilities = {
  qrConnect: boolean;
  outboundVoice: boolean;
  inboundVoice: boolean;
  callEvents: boolean;
  audioInject: boolean;
  audioCapture: boolean;
  recordedPlayback: boolean;
  realtimeAi: boolean;
  experimental: boolean;
  sendText: boolean;
};

export type CallSession = {
  callId: string;
  engineCallId: string;
  channelId: string;
  phoneNumber: string;
  status: CallStatus;
};

export type InitiateCallOptions = {
  audioFilePath?: string;
  silence?: boolean;
  /** Prisma / API call id so events and live audio stay on the same record. */
  clientCallId?: string;
  hangupAfterPlayback?: boolean;
  aiConfigId?: string;
};

export type ConnectOptions = {
  /** Start WhatsApp Web pairing so a QR can be shown (used by QR / Reconnect). */
  forceQr?: boolean;
};

export type CallEventType =
  | "connecting"
  | "ringing"
  | "answered"
  | "ended"
  | "failed"
  | "busy"
  | "no_answer"
  | "rejected"
  | "audio"
  | "recording"
  | "playback_done"
  | "qr"
  | "channel_status";

export type CallEvent = {
  type: CallEventType;
  callId?: string;
  channelId: string;
  timestamp: string;
  reason?: string;
  durationMs?: number;
  qrDataUrl?: string;
  status?: ChannelStatus;
  phoneNumber?: string;
  displayName?: string;
  pcm?: Float32Array;
  recordingPath?: string;
};

export type CallEventHandler = (event: CallEvent) => void;

export interface CallingEngine {
  readonly name: EngineName;
  readonly capabilities: EngineCapabilities;

  connect(channelId: string, options?: ConnectOptions): Promise<void>;
  disconnect(channelId: string): Promise<void>;
  getStatus(channelId: string): Promise<ChannelStatus>;
  getQr(channelId: string): Promise<string | null>;

  initiateCall(
    channelId: string,
    phoneNumber: string,
    options?: InitiateCallOptions,
  ): Promise<CallSession>;

  hangup(callId: string): Promise<void>;
  mute(callId: string, muted: boolean): Promise<void>;
  sendAudio(callId: string, pcm: Float32Array): Promise<void>;
  sendText(channelId: string, phoneNumber: string, text: string): Promise<{ id?: string }>;
  getProfilePicture?(channelId: string, phoneNumber: string): Promise<string | null>;

  onCallEvent(handler: CallEventHandler): () => void;

  /** Probe optional modules such as baileys-caller so capabilities.outboundVoice is accurate. */
  warmup?(): Promise<void>;
}

export class UnsupportedCapabilityError extends Error {
  readonly code = "UNSUPPORTED_CAPABILITY";
  constructor(capability: string, engine: string) {
    super(
      `${capability} is not available on engine "${engine}". See docs/CALLING_ENGINE.md. This is not a successful call.`,
    );
    this.name = "UnsupportedCapabilityError";
  }
}

export class EngineMisconfiguredError extends Error {
  readonly code = "ENGINE_MISCONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "EngineMisconfiguredError";
  }
}

export const MOCK_CAPABILITIES: EngineCapabilities = {
  qrConnect: true,
  outboundVoice: true,
  inboundVoice: false,
  callEvents: true,
  audioInject: true,
  audioCapture: false,
  recordedPlayback: true,
  realtimeAi: false,
  experimental: true,
  sendText: true,
};

export const SELFHOSTED_BASE_CAPABILITIES: EngineCapabilities = {
  qrConnect: true,
  outboundVoice: false,
  inboundVoice: false,
  callEvents: false,
  audioInject: false,
  audioCapture: false,
  recordedPlayback: false,
  realtimeAi: false,
  experimental: true,
  sendText: true,
};

export const SELFHOSTED_VOIP_CAPABILITIES: EngineCapabilities = {
  qrConnect: true,
  outboundVoice: true,
  inboundVoice: true,
  callEvents: true,
  audioInject: true,
  audioCapture: true,
  recordedPlayback: true,
  realtimeAi: true,
  experimental: true,
  sendText: true,
};

export const WAVOIP_CAPABILITIES: EngineCapabilities = {
  qrConnect: false,
  outboundVoice: false,
  inboundVoice: false,
  callEvents: false,
  audioInject: false,
  audioCapture: false,
  recordedPlayback: false,
  realtimeAi: false,
  experimental: true,
  sendText: false,
};
