import { env } from "../env.js";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.WHATSAPP_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-token": env.INTERNAL_TOKEN,
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `WhatsApp service ${res.status}`);
  }
  return json;
}

export const whatsappClient = {
  health: () => request<{ status: string }>("/health"),
  connect: (channelId: string, opts?: { forceQr?: boolean }) =>
    request(`/internal/channels/${channelId}/connect`, {
      method: "POST",
      body: JSON.stringify({ forceQr: opts?.forceQr ?? true }),
    }),
  disconnect: (channelId: string) =>
    request(`/internal/channels/${channelId}/disconnect`, { method: "POST" }),
  qr: (channelId: string) =>
    request<{ qr: string | null; status: string; lastError?: string | null; engine?: string }>(
      `/internal/channels/${channelId}/qr`,
    ),
  status: (channelId: string) =>
    request<{ status: string }>(`/internal/channels/${channelId}/status`),
  hangup: (callId: string) =>
    request(`/internal/calls/${callId}/hangup`, { method: "POST" }),
  mute: (callId: string, muted: boolean) =>
    request(`/internal/calls/${callId}/mute`, {
      method: "POST",
      body: JSON.stringify({ muted }),
    }),
  capabilities: () => request<{ capabilities: Record<string, boolean>; name: string }>("/internal/capabilities"),
};
