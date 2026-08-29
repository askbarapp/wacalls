"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function WebhooksPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [url, setUrl] = useState("");
  useEffect(() => {
    api<{ success: true; data: any[] }>("/api/v1/webhooks").then((r) => setRows(r.data));
  }, []);
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Webhooks</h1>
      <div className="mb-6 flex gap-2">
        <input placeholder="https://example.com/hooks" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button
          className="rounded-lg bg-brand-500 px-4 text-ink-950"
          onClick={async () => {
            await api("/api/v1/webhooks", {
              method: "POST",
              body: JSON.stringify({
                url,
                events: [
                  "call.started",
                  "call.ringing",
                  "call.answered",
                  "call.ended",
                  "call.failed",
                  "campaign.started",
                  "campaign.completed",
                ],
              }),
            });
            const r = await api<{ success: true; data: any[] }>("/api/v1/webhooks");
            setRows(r.data);
          }}
        >
          Add
        </button>
      </div>
      <ul className="space-y-2 text-sm">
        {rows.map((h) => (
          <li key={h.id} className="rounded-lg border border-white/10 bg-ink-900 px-4 py-3">
            {h.url}
          </li>
        ))}
      </ul>
    </div>
  );
}
