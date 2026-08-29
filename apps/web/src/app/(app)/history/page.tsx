"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";

export default function HistoryPage() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api<{ success: true; data: any[] }>("/api/v1/calls").then((r) => setRows(r.data));
  }, []);
  return (
    <div>
      <PageHeader title="Call history" subtitle="Recent dialer and campaign calls for this organization." />
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr>
              <th className="py-2">Date</th>
              <th>Contact</th>
              <th>Phone</th>
              <th>Agent</th>
              <th>Channel</th>
              <th>Campaign</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-white/5">
                <td className="py-2">{new Date(c.createdAt).toLocaleString()}</td>
                <td>{c.contactName}</td>
                <td>{c.phone}</td>
                <td>{c.agent?.name}</td>
                <td>{c.channel?.displayName}</td>
                <td>{c.campaign?.name}</td>
                <td>
                  <StatusBadge status={c.status} />
                </td>
                <td>{Math.round((c.durationMs ?? 0) / 1000)}s</td>
                <td>{c.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
