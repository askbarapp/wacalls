"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function KeysPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [created, setCreated] = useState<string | null>(null);
  useEffect(() => {
    api<{ success: true; data: any[] }>("/api/v1/api-keys").then((r) => setRows(r.data));
  }, []);
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">API keys</h1>
      <button
        className="mb-4 rounded-lg bg-brand-500 px-4 py-2 text-ink-950"
        onClick={async () => {
          const r = await api<{ success: true; data: { key: string } }>("/api/v1/api-keys", {
            method: "POST",
            body: JSON.stringify({ name: "Default" }),
          });
          setCreated(r.data.key);
        }}
      >
        Create key
      </button>
      {created ? (
        <p className="mb-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">
          Copy now; it will not be shown again: {created}
        </p>
      ) : null}
      <ul className="space-y-2 text-sm">
        {rows.map((k) => (
          <li key={k.id} className="flex justify-between rounded-lg border border-white/10 bg-ink-900 px-4 py-3">
            <span>
              {k.name} · {k.prefix}…
            </span>
            <button onClick={() => api(`/api/v1/api-keys/${k.id}`, { method: "DELETE" })}>Revoke</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
