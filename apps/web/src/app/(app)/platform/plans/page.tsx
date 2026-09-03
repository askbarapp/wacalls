"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { formatPlanPrice, type PlatformPlan } from "@/lib/platform-admin";

const emptyForm = {
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

export default function PlatformPlansPage() {
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  async function load() {
    const r = await api<{ success: true; data: PlatformPlan[] }>("/api/v1/platform/plans");
    setPlans(r.data);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Could not load plans"));
  }, []);

  async function createPlan() {
    setError("");
    try {
      await api("/api/v1/platform/plans", { method: "POST", body: JSON.stringify(form) });
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save plan");
    }
  }

  return (
    <div>
      <PageHeader title="Plans" subtitle="Create and edit the plans assigned to customer accounts." />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <section className="mb-8 rounded-2xl border border-white/10 bg-ink-900/80 p-4">
        <h2 className="mb-3 text-sm font-medium text-white">New plan</h2>
        <div className="grid gap-2 md:grid-cols-4">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          <input
            placeholder="Price paise / month"
            type="number"
            value={form.priceMonthly}
            onChange={(e) => setForm({ ...form, priceMonthly: Number(e.target.value) })}
          />
          <button type="button" onClick={() => void createPlan()} className="rounded-lg bg-brand-500 font-medium text-ink-950">
            Add plan
          </button>
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
      </section>

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-slate-400">
            <tr>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Limits</th>
              <th className="px-4 py-3">Flags</th>
              <th className="px-4 py-3">Price</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
