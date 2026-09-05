"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { ListPagination } from "@/components/list-pagination";
import { formatPlanPrice, type PlatformOrg, type PlatformPlan } from "@/lib/platform-admin";
import { emptyMeta, type ListMeta, type PageSize } from "@/lib/csv";

export default function PlatformBillingPage() {
  const [orgs, setOrgs] = useState<PlatformOrg[]>([]);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [meta, setMeta] = useState<ListMeta>(emptyMeta(25));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(pageNum = page, limit = pageSize) {
    setLoading(true);
    try {
      const [o, p] = await Promise.all([
        api<{ success: true; data: PlatformOrg[]; meta?: ListMeta }>(
          `/api/v1/platform/organizations?page=${pageNum}&limit=${limit}`,
        ),
        api<{ success: true; data: PlatformPlan[] }>("/api/v1/platform/plans"),
      ]);
      setOrgs(o.data);
      setMeta(o.meta ?? { ...emptyMeta(limit), total: o.data?.length ?? 0, page: pageNum });
      setPlans(p.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Could not load billing"));
  }, [page, pageSize]);

  async function patch(id: string, body: Record<string, unknown>) {
    setError("");
    try {
      await api(`/api/v1/platform/organizations/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update account");
    }
  }

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="Assign a plan to each account, set billing email, and activate or suspend workspaces."
      />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      <div className="space-y-2">
        {orgs.map((o) => (
          <div key={o.id} className="rounded-xl border border-white/10 bg-ink-900/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{o.name}</span>
                  <StatusBadge status={o.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {o.slug} · {o._count?.users ?? 0} users · {o.plan?.name ?? "no plan"}
                  {o.plan?.priceMonthly != null ? ` · ${formatPlanPrice(o.plan.priceMonthly)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <select
                  value={o.planId ?? ""}
                  onChange={(e) => void patch(o.id, { planId: e.target.value || null })}
                >
                  <option value="">No plan</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {formatPlanPrice(p.priceMonthly)}
                    </option>
                  ))}
                </select>
                <select value={o.status} onChange={(e) => void patch(o.id, { status: e.target.value })}>
                  <option value="TRIAL">TRIAL</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                </select>
              </div>
            </div>
            <label className="mt-3 block text-xs text-slate-400">
              Billing email
              <input
                className="mt-1 min-h-10"
                defaultValue={o.billingEmail ?? ""}
                placeholder="billing@company.com"
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next === (o.billingEmail ?? "")) return;
                  void patch(o.id, { billingEmail: next || null });
                }}
              />
            </label>
          </div>
        ))}
        {!loading && orgs.length === 0 ? <p className="text-sm text-slate-500">No customer accounts yet.</p> : null}
      </div>
      <ListPagination
        meta={meta}
        loading={loading}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </div>
  );
}
