"use client";

import { useEffect, useState } from "react";
import { Building2, CreditCard, Shield, Users } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { useBranding } from "@/components/branding-provider";
import type { PlatformOverview } from "@/lib/platform-admin";

export default function PlatformOverviewPage() {
  const { branding } = useBranding();
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ success: true; data: PlatformOverview }>("/api/v1/platform/overview")
      .then((r) => setData(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load overview"));
  }, []);

  return (
    <div>
      <PageHeader
        title="Super admin"
        subtitle={`Accounts, plans, and billing for this ${branding.brandName} instance.`}
      />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Users" value={data?.users ?? "—"} hint="Every signed-up account" icon={Users} tone="rose" />
        <StatCard
          label="Accounts"
          value={data?.organizations ?? "—"}
          hint={`${data?.byStatus.ACTIVE ?? 0} active · ${data?.byStatus.TRIAL ?? 0} trial`}
          icon={Building2}
          tone="amber"
        />
        <StatCard label="Plans" value={data?.plans ?? "—"} hint="Assignable subscription plans" icon={CreditCard} tone="violet" />
        <StatCard
          label="Suspended"
          value={data?.byStatus.SUSPENDED ?? "—"}
          hint="Accounts blocked from signing in"
          icon={Shield}
          tone="cyan"
        />
      </div>
      <section className="rounded-2xl border border-white/10 bg-ink-900/80">
        <div className="border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-medium text-white">Users by plan</h2>
          <p className="text-xs text-slate-500">Which plan each account is on, and how many users sit on it.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Accounts</th>
                <th className="px-4 py-3">Users</th>
              </tr>
            </thead>
            <tbody>
              {(data?.byPlan ?? []).map((row) => (
                <tr key={row.name} className="border-t border-white/10">
                  <td className="px-4 py-3 font-medium text-white">{row.name}</td>
                  <td className="px-4 py-3 text-slate-300">{row.organizations}</td>
                  <td className="px-4 py-3 text-slate-300">{row.users}</td>
                </tr>
              ))}
              {!data?.byPlan.length ? (
                <tr>
                  <td className="px-4 py-8 text-slate-500" colSpan={3}>
                    No accounts yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
