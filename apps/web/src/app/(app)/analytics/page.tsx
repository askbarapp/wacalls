"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, Percent, PhoneCall, Timer, UserCheck } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Stagger } from "@/components/page-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { exportRowsCsv } from "@/lib/csv";

type Analytics = {
  totalCalls: number;
  answeredCalls: number;
  answerRate: number;
  averageDurationMs: number;
  totalTalkTimeMs: number;
  callsPerDay: Record<string, { total: number; answered: number }>;
  agentCalls: Record<string, number>;
  outcomes: Record<string, number>;
};

const PIE = ["#34d399", "#38bdf8", "#a78bfa", "#fbbf24", "#fb7185", "#22d3ee"];
const tip = {
  background: "#0c1a2b",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  color: "#fff",
};

function mins(ms: number) {
  return `${Math.round((ms || 0) / 60000)}m`;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  useEffect(() => {
    api<{ success: true; data: Analytics }>("/api/v1/analytics").then((r) => setData(r.data));
  }, []);

  const days = useMemo(
    () =>
      Object.entries(data?.callsPerDay ?? {}).map(([day, v]) => ({
        day: day.slice(5),
        total: v.total,
        answered: v.answered,
      })),
    [data],
  );
  const outcomes = useMemo(
    () => Object.entries(data?.outcomes ?? {}).map(([name, value]) => ({ name, value })),
    [data],
  );
  const agents = useMemo(
    () => Object.entries(data?.agentCalls ?? {}).map(([name, calls]) => ({ name, calls })),
    [data],
  );

  if (!data) {
    return <div className="surface h-48 animate-pulse bg-white/5" />;
  }

  const summary = data;

  function exportCsv() {
    const dayRows = days.map((d) => ({
      day: d.day,
      total: d.total,
      answered: d.answered,
    }));
    const outcomeRows = outcomes.map((o) => ({ name: o.name, value: o.value }));
    const agentRows = agents.map((a) => ({ name: a.name, calls: a.calls }));
    exportRowsCsv(
      `analytics-summary-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { key: "metric", label: "Metric" },
        { key: "value", label: "Value" },
      ],
      [
        { metric: "Total calls", value: summary.totalCalls },
        { metric: "Answered", value: summary.answeredCalls },
        { metric: "Answer rate %", value: Math.round((summary.answerRate ?? 0) * 100) },
        { metric: "Avg talk (min)", value: Math.round((summary.averageDurationMs || 0) / 60000) },
        { metric: "Total talk (min)", value: Math.round((summary.totalTalkTimeMs || 0) / 60000) },
        ...dayRows.map((d) => ({ metric: `Day ${d.day} total`, value: d.total })),
        ...dayRows.map((d) => ({ metric: `Day ${d.day} answered`, value: d.answered })),
        ...outcomeRows.map((o) => ({ metric: `Outcome ${o.name}`, value: o.value })),
        ...agentRows.map((a) => ({ metric: `Agent ${a.name}`, value: a.calls })),
      ],
    );
  }

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Last 14 days of calls, answer rate, talk time, and agent load."
        tone="from-violet-400 to-cyan-400"
        actions={
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        }
      />
      <Stagger className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total calls" value={data.totalCalls} icon={PhoneCall} tone="cyan" />
        <StatCard label="Answered" value={data.answeredCalls} icon={UserCheck} tone="emerald" />
        <StatCard label="Answer rate" value={`${Math.round((data.answerRate ?? 0) * 100)}%`} icon={Percent} tone="violet" />
        <StatCard label="Avg talk" value={mins(data.averageDurationMs)} icon={Timer} tone="amber" hint={`${mins(data.totalTalkTimeMs)} total`} />
      </Stagger>
      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Calls per day</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {days.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={days}>
                  <defs>
                    <linearGradient id="totalFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="day" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} />
                  <Tooltip contentStyle={tip} />
                  <Area type="monotone" dataKey="total" stroke="#22d3ee" fill="url(#totalFill)" strokeWidth={2} />
                  <Area type="monotone" dataKey="answered" stroke="#34d399" fill="transparent" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-slate-400">No call data yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Outcomes</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {outcomes.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={outcomes} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {outcomes.map((entry, i) => (
                      <Cell key={entry.name} fill={PIE[i % PIE.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tip} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-slate-400">No outcomes yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Calls by agent</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          {agents.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agents} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
                <XAxis type="number" stroke="#94a3b8" fontSize={12} allowDecimals={false} />
                <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={12} width={90} />
                <Tooltip contentStyle={tip} />
                <Bar dataKey="calls" fill="#a78bfa" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-slate-400">No agent activity yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
