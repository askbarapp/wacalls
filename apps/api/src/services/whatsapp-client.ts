import { env } from "../env.js";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const hasBody = init?.body != null && init.body !== "";
  const body = hasBody
    ? init?.body
    : ["POST", "PUT", "PATCH"].includes(method)
      ? "{}"
      : undefined;
  const res = await fetch(`${env.WHATSAPP_URL}${path}`, {
    ...init,
    method,
    headers: {
      "x-internal-token": env.INTERNAL_TOKEN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    body,
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
      body: JSON.stringify({ forceQr: opts?.forceQr === true }),
    }),
  pair: (channelId: string, phone: string) =>
    request<{ ok: boolean; code: string }>(`/internal/channels/${channelId}/pair`, {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
  disconnect: (channelId: string) =>
    request(`/internal/channels/${channelId}/disconnect`, { method: "POST" }),
  qr: (channelId: string) =>
    request<{
      qr: string | null;
      code?: string | null;
      pairingCode?: string | null;
      status: string;
      lastError?: string | null;
      engine?: string;
    }>(`/internal/channels/${channelId}/qr`),
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
  sendText: (
    channelId: string,
    phone: string,
    text: string,
    extra?: {
      imagePath?: string;
      typingMs?: number;
      kind?: string;
      header?: string;
      footer?: string;
      buttons?: Array<{ id?: string; type?: string; text: string; url?: string; phone?: string }>;
      listButton?: string;
      sections?: Array<{ title?: string; rows?: Array<{ id?: string; title: string; description?: string }> }>;
    },
  ) =>
    request<{ success: boolean; id?: string }>("/internal/messages", {
      method: "POST",
      body: JSON.stringify({
        channelId,
        phone,
        text,
        kind: extra?.kind,
        header: extra?.header,
        footer: extra?.footer,
        imagePath: extra?.imagePath,
        buttons: extra?.buttons,
        listButton: extra?.listButton,
        sections: extra?.sections,
        typingMs: extra?.typingMs ?? 0,
      }),
    }),
  placeCall: (input: {
    callId: string;
    channelId: string;
    organizationId: string;
    phone: string;
    audioFilePath?: string;
    aiConfigId?: string;
    hangupAfterPlayback?: boolean;
    contactName?: string | null;
  }) =>
    request<{ success: boolean; session?: { callId: string; engineCallId: string } }>("/internal/calls", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  avatar: (channelId: string, phone: string) =>
    request<{ avatar: string | null; name?: string | null }>(
      `/internal/channels/${channelId}/avatar?phone=${encodeURIComponent(phone)}`,
    ),
  onWhatsApp: (channelId: string, phones: string[]) =>
    request<{ results: Array<{ phone: string; exists: boolean }> }>(`/internal/channels/${channelId}/on-whatsapp`, {
      method: "POST",
      body: JSON.stringify({ phones }),
    }),
  sendPcm: async (callId: string, pcm: Buffer) => {
    const res = await fetch(`${env.WHATSAPP_URL}/internal/calls/${callId}/pcm`, {
      method: "POST",
      headers: {
        "x-internal-token": env.INTERNAL_TOKEN,
        "content-type": "application/octet-stream",
      },
      body: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength),
    });
    if (!res.ok) {
      throw new Error(`WhatsApp media ${res.status}`);
    }
  },
};
