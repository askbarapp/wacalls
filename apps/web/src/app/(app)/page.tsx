"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type Dash = {
  todayCalls: number;
  answered: number;
  noAnswer: number;
  failed: number;
  totalDurationMs: number;
  agentsOnline: number;
  channels: Array<{ id: string; displayName: string; status: string; phoneNumber?: string }>;
  activeCalls: unknown[];
  campaigns: Array<{ id: string; name: string; status: string }>;
};

export default function DashboardPage() {
  const [data, setData] = useState<Dash | null>(null);
  useEffect(() => {
    api<{ success: true; data: Dash }>("/api/v1/dashboard").then((r) => setData(r.data));
  }, []);
  if (!data) return <p className="text-slate-400">Loading…</p>;
  const cards = [
    ["Today's Calls", data.todayCalls],
    ["Answered", data.answered],
    ["No Answer", data.noAnswer],
    ["Failed", data.failed],
  ];
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([l, v]) => (
          <div key={String(l)} className="rounded-xl border border-white/10 bg-ink-900 p-5">
            <div className="text-sm text-slate-400">{l}</div>
            <div className="mt-2 text-3xl font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-white/10 bg-ink-900 p-5">
          <h2 className="mb-4 font-medium">WhatsApp Channels</h2>
          <ul className="space-y-3">
            {data.channels.map((ch) => (
              <li key={ch.id} className="flex items-center justify-between text-sm">
                <span>
                  {statusDot(ch.status)} {ch.displayName}{" "}
                  <span className="text-slate-500">{ch.phoneNumber}</span>
                </span>
                <Link className="text-brand-400" href="/dialer">
                  Open Dialer
                </Link>
              </li>
            ))}
            {data.channels.length === 0 ? (
              <li className="text-slate-500">No channels yet. Connect WhatsApp first.</li>
            ) : null}
          </ul>
        </section>
        <section className="rounded-xl border border-white/10 bg-ink-900 p-5">
          <h2 className="mb-4 font-medium">Campaigns</h2>
          <ul className="space-y-2 text-sm">
            {data.campaigns.map((c) => (
              <li key={c.id} className="flex justify-between">
                <span>{c.name}</span>
                <span className="text-slate-400">{c.status}</span>
              </li>
            ))}
            {data.campaigns.length === 0 ? <li className="text-slate-500">No active campaigns.</li> : null}
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            Agents online: {data.agentsOnline} · Active calls: {data.activeCalls.length}
          </p>
        </section>
      </div>
    </div>
  );
}

function statusDot(status: string) {
  const color = status === "CONNECTED" ? "bg-brand-500" : status === "CONNECTING" ? "bg-amber-400" : "bg-slate-500";
  return <span className={`mr-2 inline-block h-2 w-2 rounded-full ${color}`} />;
}
