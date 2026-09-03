"use client";

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { ConnectionBadge, StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
      <PageHeader
        title="Live call monitor"
        subtitle="Watch the current call and wait queue on one WhatsApp line."
        tone="from-cyan-400 to-sky-400"
      />
      <select className="mb-6 max-w-sm" value={id} onChange={(e) => setId(e.target.value)}>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.displayName}
          </option>
        ))}
      </select>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="ring-1 ring-cyan-400/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-cyan-300" />
              WhatsApp line
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ConnectionBadge status={ch?.status ?? "DISCONNECTED"} />
            <div className="mt-6 text-sm font-medium text-slate-300">Current call</div>
            {call ? (
              <div className="mt-2 space-y-2 text-sm text-white">
                <div>Customer: {call.contactName ?? call.phone}</div>
                <div>Agent: {call.agent?.name ?? "—"}</div>
                <div className="flex items-center gap-2">
                  Status: <StatusBadge status={call.status} />
                </div>
              </div>
            ) : (
              <p className="mt-2 text-slate-400">No active call on this line.</p>
            )}
          </CardContent>
        </Card>
        <Card className="ring-1 ring-violet-400/20">
          <CardHeader>
            <CardTitle>Wait queue</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {(live?.queue ?? []).map((q: any) => (
                <li key={q.callId} className="rounded-xl bg-white/[0.04] px-3 py-2">
                  #{q.position} {q.callId.slice(0, 8)}
                </li>
              ))}
              {(live?.queue ?? []).length === 0 ? <li className="text-slate-400">Queue is empty.</li> : null}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
