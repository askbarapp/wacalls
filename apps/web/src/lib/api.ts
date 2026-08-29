const API =
  (typeof window !== "undefined" && !process.env.NEXT_PUBLIC_API_URL
    ? window.location.origin
    : process.env.NEXT_PUBLIC_API_URL) ?? "";

export function wsUrl(token: string) {
  const envWs = process.env.NEXT_PUBLIC_WS_URL;
  const base =
    envWs && envWs.length > 0
      ? envWs
      : typeof window !== "undefined"
        ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`
        : "";
  return `${base}?token=${encodeURIComponent(token)}`;
}

export type Me = {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  superAdmin: boolean;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("wacalls_token") : null;
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    credentials: "include",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}
