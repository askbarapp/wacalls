import { getAuthToken } from "@/stores/auth";

const TOKEN_KEY = "wacalls.token";

let onUnauthorized: (() => void) | null = null;

export const setOnUnauthorized = (fn: () => void) => {
  onUnauthorized = fn;
};

const baseHeaders = (): HeadersInit => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
};

const handle401 = () => {
  localStorage.removeItem(TOKEN_KEY);
  if (onUnauthorized) onUnauthorized();
};

export const apiGet = async <T>(path: string): Promise<T> => {
  const r = await fetch(path, { headers: baseHeaders() });
  if (r.status === 401) {
    handle401();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json() as Promise<T>;
};

export const apiPost = async <T>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(path, { method: "POST", headers: baseHeaders(), body: JSON.stringify(body) });
  if (r.status === 401) {
    handle401();
    throw new Error("unauthorized");
  }
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${path} ${r.status} ${text}`);
  }
  return r.json() as Promise<T>;
};

export const apiDelete = async (path: string): Promise<void> => {
  const r = await fetch(path, { method: "DELETE", headers: baseHeaders() });
  if (r.status === 401) {
    handle401();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`${path} ${r.status}`);
};
