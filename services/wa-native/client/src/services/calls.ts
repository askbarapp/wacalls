import { apiPost, apiDelete } from "@/lib/api";
import { getClientId } from "@/lib/client-id";
import { getAuthToken } from "@/stores/auth";

export const startCall = (sid: string, phone: string, record: boolean) =>
  apiPost<{ call: { callId: string } }>(`/api/sessions/${sid}/calls`, {
    phone,
    duration_ms: 300_000,
    record,
  });

export const acceptCall = (sid: string, callId: string) =>
  apiPost<{ call: { callId: string } }>(`/api/sessions/${sid}/calls/${callId}/accept`, {});

export const rejectCall = async (sid: string, callId: string): Promise<void> => {
  const r = await fetch(`/api/sessions/${sid}/calls/${callId}/reject`, {
    method: "POST",
    headers: {
      "X-Client-Id": getClientId(),
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: "{}",
  });
  if (!r.ok) throw new Error(`reject ${r.status}`);
};

export const endCall = (sid: string, callId: string) =>
  apiDelete(`/api/sessions/${sid}/calls/${callId}`);
