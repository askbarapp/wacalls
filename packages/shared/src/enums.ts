/** Max length for user-uploaded campaign / dialer audio (WAV / MP3). */
export const MAX_UPLOAD_AUDIO_DURATION_MS = 3 * 60 * 1000;

export const ROLES = ["SUPER_ADMIN", "ORG_ADMIN", "MANAGER", "AGENT"] as const;
export type Role = (typeof ROLES)[number];

export const CHANNEL_STATUSES = [
  "CONNECTING",
  "CONNECTED",
  "DISCONNECTED",
  "ERROR",
  "RECONNECTING",
] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export const CALL_STATUSES = [
  "QUEUED",
  "CONNECTING",
  "RINGING",
  "ANSWERED",
  "ENDED",
  "FAILED",
  "BUSY",
  "NO_ANSWER",
  "REJECTED",
  "CANCELLED",
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_OUTCOMES = [
  "ANSWERED",
  "NO_ANSWER",
  "BUSY",
  "REJECTED",
  "FAILED",
  "CALLBACK",
  "INTERESTED",
  "NOT_INTERESTED",
  "WRONG_NUMBER",
  "DO_NOT_CALL",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CAMPAIGN_TYPES = ["MANUAL", "SEQUENTIAL", "RECORDED", "TTS", "AI_VOICE", "MESSAGE"] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const AGENT_PRESENCE = ["READY", "BUSY", "OFFLINE"] as const;
export type AgentPresence = (typeof AGENT_PRESENCE)[number];

export const MESSAGE_TEMPLATE_KINDS = ["TEXT", "SIMPLE", "MEDIA", "BUTTON", "LIST"] as const;
export type MessageTemplateKind = (typeof MESSAGE_TEMPLATE_KINDS)[number];

export const AUTO_REPLY_TRIGGERS = ["ANSWERED", "NO_ANSWER", "REJECTED", "NOT_CONNECTED"] as const;
export type AutoReplyTrigger = (typeof AUTO_REPLY_TRIGGERS)[number];

export function autoReplyTriggerForCall(status: string): AutoReplyTrigger | null {
  if (status === "ENDED") return "ANSWERED";
  if (status === "NO_ANSWER") return "NO_ANSWER";
  if (status === "REJECTED") return "REJECTED";
  if (status === "FAILED" || status === "BUSY" || status === "CANCELLED") return "NOT_CONNECTED";
  return null;
}

export const WEBHOOK_EVENTS = [
  "call.started",
  "call.ringing",
  "call.answered",
  "call.ended",
  "call.failed",
  "campaign.started",
  "campaign.completed",
  "contact.completed",
  "message.sent",
  "message.failed",
  "visit.submitted",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const PERMISSIONS = {
  SUPER_ADMIN: ["*"],
  ORG_ADMIN: [
    "users.manage",
    "channels.manage",
    "contacts.manage",
    "campaigns.manage",
    "recordings.manage",
    "reports.view",
    "api_keys.manage",
    "webhooks.manage",
    "settings.manage",
    "dialer.use",
    "calls.view",
    "ai.manage",
    "users.view",
    "messages.send",
    "visits.manage",
  ],
  MANAGER: [
    "campaigns.manage",
    "contacts.manage",
    "reports.view",
    "dialer.use",
    "calls.view",
    "users.view",
    "messages.send",
    "visits.manage",
    "ai.manage",
    "recordings.manage",
  ],
  AGENT: ["dialer.use", "contacts.assigned", "calls.own"],
} as const;

export function roleHas(role: Role, permission: string): boolean {
  const list = PERMISSIONS[role] as readonly string[];
  return list.includes("*") || list.includes(permission);
}
