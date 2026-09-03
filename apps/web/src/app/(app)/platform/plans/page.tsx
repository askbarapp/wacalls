"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { formatPlanPrice, type PlatformPlan } from "@/lib/platform-admin";

type PlanForm = {
  name: string;
  slug: string;
  description: string;
  maxChannels: number;
  maxAgents: number;
  maxKnowledgeBases: number;
  maxAiAgents: number;
  maxMessagesPerDay: number;
  maxCallsPerDay: number;
  allowCloudApi: boolean;
  allowSdk: boolean;
  priceMonthly: number;
  isPublic: boolean;
  isDefault: boolean;
};

const emptyForm: PlanForm = {
  name: "",
  slug: "",
  description: "",
  maxChannels: 1,
  maxAgents: 3,
  maxKnowledgeBases: 1,
  maxAiAgents: 1,
  maxMessagesPerDay: 200,
  maxCallsPerDay: 50,
  allowCloudApi: false,
  allowSdk: true,
  priceMonthly: 0,
  isPublic: true,
  isDefault: false,
};

function fromPlan(p: PlatformPlan): PlanForm {
  return {
    name: p.name,
    slug: p.slug,
    description: p.description ?? "",
    maxChannels: p.maxChannels,
    maxAgents: p.maxAgents,
    maxKnowledgeBases: p.maxKnowledgeBases ?? 1,
    maxAiAgents: p.maxAiAgents ?? 1,
    maxMessagesPerDay: p.maxMessagesPerDay,
    maxCallsPerDay: p.maxCallsPerDay,
    allowCloudApi: p.allowCloudApi,
    allowSdk: p.allowSdk,
    priceMonthly: p.priceMonthly,
    isPublic: p.isPublic,
    isDefault: p.isDefault,
  };
}

export default function PlatformPlansPage() {
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const r = await api<{ success: true; data: PlatformPlan[] }>("/api/v1/platform/plans");
    setPlans(r.data);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Could not load plans"));
  }, []);

  function startEdit(p: PlatformPlan) {
    setError("");
    setEditingId(p.id);
    setForm(fromPlan(p));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function savePlan() {
    setError("");
    setBusy(true);
    try {
      if (editingId) {
        await api(`/api/v1/platform/plans/${editingId}`, { method: "PATCH", body: JSON.stringify(form) });
      } else {
        await api("/api/v1/platform/plans", { method: "POST", body: JSON.stringify(form) });
      }
      setForm(emptyForm);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save plan");
    } finally {
      setBusy(false);
    }
  }

  async function deletePlan(p: PlatformPlan) {
    if (!window.confirm(`Delete plan “${p.name}”? Workspaces on this plan will have no plan until you assign another.`)) {
      return;
    }
    setError("");
    setBusy(true);
    try {
      await api(`/api/v1/platform/plans/${p.id}`, { method: "DELETE" });
      if (editingId === p.id) cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete plan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Plans" subtitle="Create, edit, and delete the plans assigned to customer accounts." />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <section className="mb-8 rounded-2xl border border-white/10 bg-ink-900/80 p-4">
        <h2 className="mb-3 text-sm font-medium text-white">{editingId ? "Edit plan" : "New plan"}</h2>
        <div className="grid gap-2 md:grid-cols-4">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input
            placeholder="slug"
            value={form.slug}
            disabled={Boolean(editingId)}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
          />
          <input
            placeholder="Price paise / month"
            type="number"
            value={form.priceMonthly}
            onChange={(e) => setForm({ ...form, priceMonthly: Number(e.target.value) })}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void savePlan()}
              className="min-h-11 flex-1 rounded-lg bg-brand-500 font-medium text-ink-950 disabled:opacity-50"
            >
              {busy ? "Saving…" : editingId ? "Save changes" : "Add plan"}
            </button>
            {editingId ? (
              <button type="button" onClick={cancelEdit} className="min-h-11 rounded-lg bg-white/10 px-3 text-sm text-white">
                Cancel
              </button>
            ) : null}
          </div>
          <input
            placeholder="Channels"
            type="number"
            min={1}
            value={form.maxChannels}
            onChange={(e) => setForm({ ...form, maxChannels: Number(e.target.value) })}
          />
          <input
            placeholder="Team seats"
            type="number"
            min={1}
            value={form.maxAgents}
            onChange={(e) => setForm({ ...form, maxAgents: Number(e.target.value) })}
          />
          <input
            placeholder="AI agents"
            type="number"
            min={1}
            value={form.maxAiAgents}
            onChange={(e) => setForm({ ...form, maxAiAgents: Number(e.target.value) })}
          />
          <input
            placeholder="Calls / day"
            type="number"
            min={1}
            value={form.maxCallsPerDay}
            onChange={(e) => setForm({ ...form, maxCallsPerDay: Number(e.target.value) })}
          />
        </div>
        <label className="mt-3 block text-sm text-slate-300">
          Description
          <input
            className="mt-1"
            placeholder="Shown on billing"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-300">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.allowCloudApi}
              onChange={(e) => setForm({ ...form, allowCloudApi: e.target.checked })}
            />
            Cloud API
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.allowSdk} onChange={(e) => setForm({ ...form, allowSdk: e.target.checked })} />
            Calling SDK
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
            Public
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
            Default
          </label>
        </div>
      </section>

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-slate-400">
            <tr>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Limits</th>
              <th className="px-4 py-3">Flags</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="border-t border-white/10">
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.slug}</div>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {p.maxChannels} ch · {p.maxAgents} seats · {p.maxAiAgents ?? 1} AI · {p.maxCallsPerDay} calls/d
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {p.allowCloudApi ? "Cloud API · " : ""}
                  {p.allowSdk ? "SDK · " : ""}
                  {p.isDefault ? "default" : p.isPublic ? "public" : "hidden"}
                </td>
                <td className="px-4 py-3">{formatPlanPrice(p.priceMonthly)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-xs text-brand-300 hover:bg-brand-500/30"
                      onClick={() => startEdit(p)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy || plans.length < 2}
                      className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/25 disabled:opacity-40"
                      onClick={() => void deletePlan(p)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
