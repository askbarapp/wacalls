"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { formatPlanPrice, type PlatformUser } from "@/lib/platform-admin";

export default function PlatformUsersPage() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  async function load() {
    const r = await api<{ success: true; data: PlatformUser[] }>("/api/v1/platform/users");
    setUsers(r.data);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Could not load users"));
  }, []);

  const filtered = users.filter((u) => {
    const hay = `${u.name} ${u.email} ${u.memberships.map((m) => m.organization.name).join(" ")}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <div>
      <PageHeader title="Users" subtitle="Every user account on this instance. Assign plans from Billing." />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      <input
        className="mb-4 min-h-11 max-w-md"
        placeholder="Search name, email, or workspace"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <p className="mb-3 text-xs text-slate-500">{filtered.length} of {users.length} users</p>
      <div className="space-y-2">
        {filtered.map((u) => {
          const org = u.memberships[0]?.organization;
          return (
            <div
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-900/80 p-4"
            >
              <div>
                <div className="font-medium text-white">
                  {u.name} <span className="text-slate-500">{u.email}</span>
                  {u.isSuperAdmin ? (
                    <span className="ml-2 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-200">
                      Super admin
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {org ? (
                    <>
                      <span>{org.name}</span>
                      {org.status ? <StatusBadge status={org.status} /> : null}
                      <span>{org.plan?.name ?? "No plan"}</span>
                      {org.plan ? <span>{formatPlanPrice(org.plan.priceMonthly)}</span> : null}
                    </>
                  ) : (
                    <span>No workspace</span>
                  )}
                  {u.memberships.map((m) => (
                    <span key={`${m.organization.slug}-${m.role}`}>{m.role.replaceAll("_", " ")}</span>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={u.isActive}
                  onChange={async (e) => {
                    setError("");
                    try {
                      await api(`/api/v1/platform/users/${u.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ isActive: e.target.checked }),
                      });
                      await load();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not update user");
                    }
                  }}
                />
                Active
              </label>
            </div>
          );
        })}
        {filtered.length === 0 ? <p className="text-sm text-slate-500">No users match.</p> : null}
      </div>
    </div>
  );
}
