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

export const CAMPAIGN_TYPES = ["MANUAL", "SEQUENTIAL", "RECORDED", "AI_VOICE"] as const;
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

export const WEBHOOK_EVENTS = [
  "call.started",
  "call.ringing",
  "call.answered",
  "call.ended",
  "call.failed",
  "campaign.started",
  "campaign.completed",
  "contact.completed",
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
  ],
  MANAGER: [
    "campaigns.manage",
    "contacts.manage",
    "reports.view",
    "dialer.use",
    "calls.view",
    "users.view",
  ],
  AGENT: ["dialer.use", "contacts.assigned", "calls.own"],
} as const;

export function roleHas(role: Role, permission: string): boolean {
  const list = PERMISSIONS[role] as readonly string[];
  return list.includes("*") || list.includes(permission);
}
