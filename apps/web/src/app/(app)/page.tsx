"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";

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
      <PageHeader title="Dashboard" subtitle="Live snapshot of WhatsApp lines, campaigns, and today's call outcomes." />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([l, v]) => (
          <div key={String(l)} className="rounded-2xl border border-white/10 bg-ink-900/80 p-5 shadow-lg shadow-black/10">
            <div className="text-sm text-slate-400">{l}</div>
            <div className="mt-2 text-3xl font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
          <h2 className="mb-4 font-medium">WhatsApp Channels</h2>
          <ul className="space-y-3">
            {data.channels.map((ch) => (
              <li key={ch.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <StatusBadge status={ch.status} />
                  <span>
                    {ch.displayName} <span className="text-slate-500">{ch.phoneNumber}</span>
                  </span>
                </span>
                <Link className="text-brand-400" href={ch.status === "CONNECTED" ? "/dialer" : "/channels"}>
                  {ch.status === "CONNECTED" ? "Open Dialer" : "Link QR"}
                </Link>
              </li>
            ))}
            {data.channels.length === 0 ? (
              <li className="text-slate-500">
                No channels yet.{" "}
                <Link className="text-brand-400" href="/channels">
                  Connect WhatsApp
                </Link>
              </li>
            ) : null}
          </ul>
        </section>
        <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
          <h2 className="mb-4 font-medium">Campaigns</h2>
          <ul className="space-y-2 text-sm">
            {data.campaigns.map((c) => (
              <li key={c.id} className="flex justify-between">
                <span>{c.name}</span>
                <StatusBadge status={c.status} />
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
