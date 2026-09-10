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

export function callMediaWsUrl(token: string, callId: string) {
  const envWs = process.env.NEXT_PUBLIC_WS_URL;
  const root =
    envWs && envWs.length > 0
      ? envWs.replace(/\/ws\/?$/, "")
      : typeof window !== "undefined"
        ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
        : "";
  return `${root}/ws/calls/${callId}/media?token=${encodeURIComponent(token)}`;
}

export type Me = {
  id: string;
  email: string;
  name: string;
  phone?: string;
  hasAvatar?: boolean;
  role: string;
  organizationId: string;
  superAdmin: boolean;
  organization?: {
    id: string;
    name: string;
    status: string;
    plan?: { name: string; slug: string } | null;
  } | null;
};

export function apiOrigin() {
  if (typeof window !== "undefined" && !process.env.NEXT_PUBLIC_API_URL) {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "";
}

export function brandingAssetUrl(kind: "logo" | "favicon", updatedAt?: string | null) {
  const t = updatedAt ? `?t=${encodeURIComponent(updatedAt)}` : "";
  return `${apiOrigin()}/api/v1/public/branding/${kind}${t}`;
}

const GENERIC_HTTP_ERRORS = new Set([
  "Conflict",
  "Bad Request",
  "Unauthorized",
  "Forbidden",
  "Not Found",
  "Internal Server Error",
]);

function apiErrorMessage(json: unknown, status: number): string {
  const body = json as { error?: string | { message?: string }; message?: string };
  const nested = typeof body.error === "object" ? body.error?.message : undefined;
  const top = typeof body.message === "string" ? body.message : undefined;
  const generic = typeof body.error === "string" ? body.error : undefined;
  if (nested) return nested;
  if (top && (!generic || GENERIC_HTTP_ERRORS.has(generic) || top.length > generic.length)) {
    return top;
  }
  if (generic && !GENERIC_HTTP_ERRORS.has(generic)) return generic;
  if (top) return top;
  return `Request failed (${status})`;
}

let refreshInFlight: Promise<string | null> | null = null;

function storeToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("wacalls_token", token);
  else localStorage.removeItem("wacalls_token");
}

export function getAccessToken() {
  return typeof window !== "undefined" ? localStorage.getItem("wacalls_token") : null;
}

/** Cookie session can place calls while localStorage is empty or stale. */
export async function ensureAccessToken(): Promise<string | null> {
  const next = await refreshAccessToken();
  if (next) return next;
  return getAccessToken();
}

async function refreshAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API}/api/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const json = (await res.json().catch(() => ({}))) as { data?: { accessToken?: string } };
      const token = json.data?.accessToken;
      if (!res.ok || !token) return null;
      storeToken(token);
      return token;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

type ApiInit = RequestInit & { __authRetry?: boolean };

export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  const token = getAccessToken();
  const method = (init?.method ?? "GET").toUpperCase();
  const hasBody = init?.body != null && init.body !== "";
  const body = hasBody
    ? init?.body
    : ["POST", "PUT", "PATCH"].includes(method)
      ? "{}"
      : undefined;
  const res = await fetch(`${API}${path}`, {
    ...init,
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    body,
    credentials: "include",
  });
  const json = await res.json().catch(() => ({}));
  const skipRefresh =
    path.startsWith("/api/v1/auth/login") ||
    path.startsWith("/api/v1/auth/refresh") ||
    path.startsWith("/api/v1/auth/register") ||
    Boolean(init?.__authRetry);
  if (res.status === 401 && !skipRefresh) {
    const next = await refreshAccessToken();
    if (next) {
      return api<T>(path, {
        ...init,
        __authRetry: true,
        headers: { ...init?.headers, authorization: `Bearer ${next}` },
      });
    }
    storeToken(null);
  }
  if (!res.ok) {
    throw new Error(apiErrorMessage(json, res.status));
  }
  return json as T;
}

export async function apiUpload<T>(path: string, form: FormData, retry = false): Promise<T> {
  return apiUploadWithProgress<T>(path, form, undefined, retry);
}

export async function apiUploadWithProgress<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
  retry = false,
): Promise<T> {
  const token = getAccessToken();
  const json = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}${path}`);
    xhr.withCredentials = true;
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      let body: unknown = {};
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        body = {};
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(form);
  });
  if (json.status === 401 && !retry) {
    const next = await refreshAccessToken();
    if (next) return apiUploadWithProgress<T>(path, form, onProgress, true);
    storeToken(null);
  }
  if (json.status < 200 || json.status >= 300) {
    throw new Error(apiErrorMessage(json.body, json.status));
  }
  onProgress?.(100);
  return json.body as T;
}
