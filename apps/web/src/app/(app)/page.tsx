"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { MessageSquare, PhoneCall, UserCheck, PhoneMissed, PhoneOff, Radio } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { ConnectionBadge, StatusBadge } from "@/components/status-badge";
import { StatCard } from "@/components/stat-card";
import { Stagger } from "@/components/page-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Dash = {
  todayCalls: number;
  todayMessages?: number;
  answered: number;
  noAnswer: number;
  failed: number;
  totalDurationMs: number;
  agentsOnline: number;
  channels: Array<{ id: string; displayName: string; status: string; phoneNumber?: string }>;
  activeCalls: unknown[];
  campaigns: Array<{ id: string; name: string; status: string }>;
};

const COLORS = ["#34d399", "#fbbf24", "#fb7185", "#38bdf8"];

export default function DashboardPage() {
  const [data, setData] = useState<Dash | null>(null);
  useEffect(() => {
    api<{ success: true; data: Dash }>("/api/v1/dashboard").then((r) => setData(r.data));
  }, []);

  const pie = useMemo(() => {
    if (!data) return [];
    return [
      { name: "Answered", value: data.answered },
      { name: "No answer", value: data.noAnswer },
      { name: "Failed", value: data.failed },
    ].filter((d) => d.value > 0);
  }, [data]);

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="surface h-28 animate-pulse bg-white/5" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Today's calling, messages, WhatsApp lines, and campaign health — color-coded so you can scan it in a second."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="cyan">
              <Link href="/dialer">Open dialer</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/channels">WhatsApp lines</Link>
            </Button>
          </div>
        }
      />
      <Stagger className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Calls today" value={data.todayCalls} icon={PhoneCall} tone="cyan" hint="All outbound + inbound" />
        <StatCard label="Messages today" value={data.todayMessages ?? 0} icon={MessageSquare} tone="violet" />
        <StatCard label="Answered" value={data.answered} icon={UserCheck} tone="emerald" />
        <StatCard label="No answer" value={data.noAnswer} icon={PhoneMissed} tone="amber" />
        <StatCard label="Failed" value={data.failed} icon={PhoneOff} tone="rose" />
        <StatCard
          label="Live now"
          value={data.activeCalls.length}
          icon={Radio}
          tone="sky"
          hint={`${data.agentsOnline} agents online`}
        />
      </Stagger>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader>
            <CardTitle>Today's outcomes</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {pie.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={4}>
                    {pie.map((entry, i) => (
                      <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "#0c1a2b",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 12,
                      color: "#fff",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-slate-400">No calls yet today.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>WhatsApp lines</CardTitle>
            <Link href="/channels" className="text-sm text-cyan-300 hover:text-cyan-200">
              Manage
            </Link>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {data.channels.map((ch) => (
                <li key={ch.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-white">{ch.displayName}</span>
                    <span className="text-xs text-slate-400">{ch.phoneNumber || "Not linked"}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <ConnectionBadge status={ch.status} />
                    <Link className="text-sm text-brand-400" href={ch.status === "CONNECTED" ? "/dialer" : "/channels"}>
                      {ch.status === "CONNECTED" ? "Dial" : "Fix"}
                    </Link>
                  </div>
                </li>
              ))}
              {data.channels.length === 0 ? (
                <li className="rounded-xl border border-dashed border-white/15 px-4 py-6 text-center text-sm text-slate-400">
                  No lines yet.{" "}
                  <Link className="text-cyan-300 underline" href="/channels">
                    Connect WhatsApp
                  </Link>
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Campaigns</CardTitle>
            <Link href="/campaigns" className="text-sm text-violet-300 hover:text-violet-200">
              All
            </Link>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {data.campaigns.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5">
                  <Link href={`/campaigns/${c.id}`} className="truncate font-medium text-white hover:text-violet-200">
                    {c.name}
                  </Link>
                  <StatusBadge status={c.status} />
                </li>
              ))}
              {data.campaigns.length === 0 ? (
                <li className="rounded-xl border border-dashed border-white/15 px-4 py-6 text-center text-slate-400">
                  No running campaigns.{" "}
                  <Link className="text-violet-300 underline" href="/campaigns/new">
                    Create one
                  </Link>
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
