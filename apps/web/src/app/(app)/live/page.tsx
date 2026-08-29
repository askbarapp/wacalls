"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";

export default function LivePage() {
  const [channels, setChannels] = useState<any[]>([]);
  const [live, setLive] = useState<any>(null);
  const [id, setId] = useState("");

  useEffect(() => {
    api<{ success: true; data: any[] }>("/api/v1/channels").then((r) => {
      setChannels(r.data);
      if (r.data[0]) setId(r.data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    const t = setInterval(() => {
      api<{ success: true; data: any }>(`/api/v1/channels/${id}/live`).then((r) => setLive(r.data));
    }, 1500);
    return () => clearInterval(t);
  }, [id]);

  const ch = live?.channel;
  const call = live?.currentCall;
  return (
    <div>
      <PageHeader title="Live call monitor" subtitle="Current call and wait queue on one WhatsApp line." />
      <select className="mb-6 max-w-sm" value={id} onChange={(e) => setId(e.target.value)}>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.displayName}
          </option>
        ))}
      </select>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-white/10 bg-ink-900 p-6">
          <div className="text-sm text-slate-400">WhatsApp Channel</div>
          <div className="mt-2">
            <StatusBadge status={ch?.status ?? "DISCONNECTED"} />
          </div>
          <div className="mt-6 text-sm text-slate-400">Current Call</div>
          {call ? (
            <div className="mt-2 space-y-1">
              <div>Customer: {call.contactName ?? call.phone}</div>
              <div>Agent: {call.agent?.name ?? "—"}</div>
              <div className="flex items-center gap-2">
                Status: <StatusBadge status={call.status} />
              </div>
            </div>
          ) : (
            <p className="mt-2 text-slate-500">No active call</p>
          )}
        </section>
        <section className="rounded-xl border border-white/10 bg-ink-900 p-6">
          <div className="mb-3 font-medium">Queue</div>
          <ol className="space-y-2 text-sm">
            {(live?.queue ?? []).map((q: any) => (
              <li key={q.callId}>
                #{q.position} {q.callId.slice(0, 8)}
              </li>
            ))}
            {(live?.queue ?? []).length === 0 ? <li className="text-slate-500">Empty</li> : null}
          </ol>
        </section>
      </div>
    </div>
  );
}
