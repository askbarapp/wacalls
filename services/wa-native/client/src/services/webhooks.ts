import { apiGet, apiPost, apiDelete } from "@/lib/api";

export interface WebhookConfig {
  id: string;
  session_id: string;
  url: string;
  events: string;
  secret: string;
  active: boolean;
}

export const listWebhooks = (sid: string) =>
  apiGet<WebhookConfig[]>(`/api/sessions/${sid}/webhooks`);

export const createWebhook = (sid: string, url: string, events: string) =>
  apiPost<WebhookConfig>(`/api/sessions/${sid}/webhooks`, { url, events });

export const deleteWebhook = (sid: string, wid: string) =>
  apiDelete(`/api/sessions/${sid}/webhooks/${wid}`);
