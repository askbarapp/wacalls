"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api<{ success: true; data: any }>("/api/v1/analytics").then((r) => setData(r.data));
  }, []);
  if (!data) return <p>Loading…</p>;
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Analytics</h1>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card label="Total calls" value={data.totalCalls} />
        <Card label="Answered" value={data.answeredCalls} />
        <Card label="Answer rate" value={`${Math.round((data.answerRate ?? 0) * 100)}%`} />
      </div>
      <h2 className="mb-3 font-medium">Calls per day</h2>
      <div className="mb-8 flex items-end gap-2">
        {Object.entries(data.callsPerDay ?? {}).map(([day, v]: any) => (
          <div key={day} className="flex flex-col items-center gap-1">
            <div className="w-8 rounded-t bg-brand-500" style={{ height: Math.max(8, v.total * 8) }} />
            <span className="text-[10px] text-slate-500">{day.slice(5)}</span>
          </div>
        ))}
      </div>
      <h2 className="mb-3 font-medium">Outcomes</h2>
      <ul className="text-sm text-slate-300">
        {Object.entries(data.outcomes ?? {}).map(([k, v]) => (
          <li key={k}>
            {k}: {String(v)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-900 p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
    </div>
  );
}
