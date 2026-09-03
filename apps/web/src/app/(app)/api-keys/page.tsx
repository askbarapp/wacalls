"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes?: string[];
  lastUsedAt?: string | null;
  revokedAt?: string | null;
};

export default function KeysPage() {
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [created, setCreated] = useState<string | null>(null);
  const [name, setName] = useState("Production");
  const [kind, setKind] = useState<"secret" | "publishable">("secret");
  const [error, setError] = useState("");

  async function load() {
    const r = await api<{ success: true; data: KeyRow[] }>("/api/v1/api-keys");
    setRows(r.data);
  }
  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <PageHeader
        title="API keys"
        subtitle="Secret keys (wc_live_) for servers. Publishable keys (wc_pub_) for the browser SDK on your website."
      />
      {error ? (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name" className="sm:max-w-xs" />
        <select value={kind} onChange={(e) => setKind(e.target.value as "secret" | "publishable")} className="sm:max-w-xs">
          <option value="secret">Secret (wc_live_)</option>
          <option value="publishable">Publishable (wc_pub_)</option>
        </select>
        <button
          className="rounded-lg bg-brand-500 px-4 py-2 font-medium text-ink-950"
          onClick={async () => {
            setError("");
            try {
              const r = await api<{ success: true; data: { key: string } }>("/api/v1/api-keys", {
                method: "POST",
                body: JSON.stringify({ name, kind }),
              });
              setCreated(r.data.key);
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not create key");
            }
          }}
        >
          Create key
        </button>
      </div>
      {created ? (
        <p className="mb-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">
          Copy now; it will not be shown again: <code className="break-all">{created}</code>
        </p>
      ) : null}
      <ul className="space-y-2 text-sm">
        {rows.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-ink-900 px-4 py-3">
            <span>
              {k.name} · {k.prefix}… · {(k.scopes ?? []).join(", ") || "default scopes"}
              {k.revokedAt ? " · revoked" : ""}
            </span>
            {!k.revokedAt ? (
              <button
                className="text-rose-300"
                onClick={async () => {
                  await api(`/api/v1/api-keys/${k.id}`, { method: "DELETE" });
                  await load();
                }}
              >
                Revoke
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
