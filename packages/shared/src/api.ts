import type { CallOutcome, CallStatus, ChannelStatus } from "./enums.js";

export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function fail(code: string, message: string, details?: unknown): ApiFailure {
  return { success: false, error: { code, message, details } };
}

export type LiveCallView = {
  callId: string;
  channelId: string;
  organizationId: string;
  status: CallStatus;
  phone: string;
  contactName?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  startedAt?: string | null;
  durationMs: number;
};

export type ChannelLiveView = {
  channelId: string;
  status: ChannelStatus;
  phoneNumber?: string | null;
  displayName?: string | null;
  currentCall: LiveCallView | null;
  queue: Array<{ position: number; callId: string; label: string }>;
};

export type CallResultPayload = {
  outcome: CallOutcome;
  notes?: string;
};
