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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm text-slate-300">
      <span className="mb-1 block font-medium text-slate-200">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  );
}

export default function PlatformPlansPage() {
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const priceRupees = form.priceMonthly / 100;

  async function load() {
    const r = await api<{ success: true; data: PlatformPlan[] }>("/api/v1/platform/plans");
    setPlans(r.data);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Could not load plans"));
  }, []);

  function startEdit(p: PlatformPlan) {
    setError("");
    setMsg("");
    setEditingId(p.id);
    setForm(fromPlan(p));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setMsg("");
  }

  async function savePlan() {
    setError("");
    setMsg("");
    if (!form.name.trim() || !form.slug.trim()) {
      setError("Plan name and slug are required.");
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await api(`/api/v1/platform/plans/${editingId}`, { method: "PATCH", body: JSON.stringify(form) });
        setMsg(`Plan “${form.name}” updated.`);
      } else {
        await api("/api/v1/platform/plans", { method: "POST", body: JSON.stringify(form) });
        setMsg(`Plan “${form.name}” created.`);
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
    if (
      !window.confirm(
        `Delete plan “${p.name}”?\n\nWorkspaces on this plan will have no plan until you assign another from Billing.`,
      )
    ) {
      return;
    }
    setError("");
    setMsg("");
    setBusy(true);
    try {
      await api(`/api/v1/platform/plans/${p.id}`, { method: "DELETE" });
      if (editingId === p.id) cancelEdit();
      setMsg(`Plan “${p.name}” deleted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete plan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Plans"
        subtitle="Create plans with clear limits and price. Edit or delete any plan from the list below."
      />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {msg ? <p className="mb-4 text-sm text-brand-400">{msg}</p> : null}

      <section className="mb-8 rounded-2xl border border-white/10 bg-ink-900/80 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-white">{editingId ? "Edit plan" : "Create new plan"}</h2>
          {editingId ? (
            <button type="button" onClick={cancelEdit} className="text-xs text-slate-400 hover:text-white">
              Cancel edit
            </button>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Plan name" hint="Shown to customers, e.g. Ultimate">
            <input
              className="mt-1 min-h-11"
              value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                setForm((f) => ({
                  ...f,
                  name,
                  slug: editingId
                    ? f.slug
                    : name
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, ""),
                }));
              }}
              placeholder="Ultimate"
            />
          </Field>

          <Field label="Slug" hint="URL / internal id, e.g. ultimate (locked while editing)">
            <input
              className="mt-1 min-h-11"
              value={form.slug}
              disabled={Boolean(editingId)}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              placeholder="ultimate"
            />
          </Field>

          <Field
            label="Monthly price (₹)"
            hint={
              form.priceMonthly === 0
                ? "0 = Free plan"
                : `Stored as ${form.priceMonthly} paise · shown as ${formatPlanPrice(form.priceMonthly)}`
            }
          >
            <input
              className="mt-1 min-h-11"
              type="number"
              min={0}
              step={1}
              value={Number.isFinite(priceRupees) ? priceRupees : 0}
              onChange={(e) =>
                setForm({ ...form, priceMonthly: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) })
              }
              placeholder="0"
            />
          </Field>

          <Field label="WhatsApp channels" hint="How many WhatsApp lines this plan can connect">
            <input
              className="mt-1 min-h-11"
              type="number"
              min={1}
              value={form.maxChannels}
              onChange={(e) => setForm({ ...form, maxChannels: Number(e.target.value) })}
            />
          </Field>

          <Field label="Team seats" hint="Max users / agents in the workspace">
            <input
              className="mt-1 min-h-11"
              type="number"
              min={1}
              value={form.maxAgents}
              onChange={(e) => setForm({ ...form, maxAgents: Number(e.target.value) })}
            />
          </Field>

          <Field label="AI agents" hint="Max AI calling agents">
            <input
              className="mt-1 min-h-11"
              type="number"
              min={1}
              value={form.maxAiAgents}
              onChange={(e) => setForm({ ...form, maxAiAgents: Number(e.target.value) })}
            />
          </Field>

          <Field label="Knowledge bases" hint="Max knowledge bases for AI">
            <input
              className="mt-1 min-h-11"
              type="number"
              min={1}
              value={form.maxKnowledgeBases}
              onChange={(e) => setForm({ ...form, maxKnowledgeBases: Number(e.target.value) })}
            />
          </Field>

          <Field label="Calls per day" hint="Daily outbound call limit">
            <input
              className="mt-1 min-h-11"
              type="number"
              min={1}
              value={form.maxCallsPerDay}
              onChange={(e) => setForm({ ...form, maxCallsPerDay: Number(e.target.value) })}
            />
          </Field>

          <Field label="Messages per day" hint="Daily WhatsApp message limit">
            <input
              className="mt-1 min-h-11"
              type="number"
              min={1}
              value={form.maxMessagesPerDay}
              onChange={(e) => setForm({ ...form, maxMessagesPerDay: Number(e.target.value) })}
            />
          </Field>
        </div>

        <Field label="Description" hint="Short summary shown on billing / plan cards">
          <textarea
            className="mt-1 min-h-20 w-full"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Best for agencies that need more channels and AI agents"
          />
        </Field>

        <div className="mt-4 flex flex-wrap gap-5 text-sm text-slate-300">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.allowCloudApi}
              onChange={(e) => setForm({ ...form, allowCloudApi: e.target.checked })}
            />
            Allow Cloud API messaging
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.allowSdk} onChange={(e) => setForm({ ...form, allowSdk: e.target.checked })} />
            Allow calling SDK
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
            Public (visible for signup)
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
            Default plan for new workspaces
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void savePlan()}
            className="min-h-11 rounded-lg bg-brand-500 px-5 text-sm font-medium text-ink-950 disabled:opacity-50"
          >
            {busy ? "Saving…" : editingId ? "Save changes" : "Create plan"}
          </button>
          {editingId ? (
            <button type="button" onClick={cancelEdit} className="min-h-11 rounded-lg bg-white/10 px-4 text-sm text-white">
              Cancel
            </button>
          ) : null}
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
              <tr key={p.id} className={`border-t border-white/10 ${editingId === p.id ? "bg-brand-500/5" : ""}`}>
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.slug}</div>
                  {p.description ? <div className="mt-1 max-w-xs text-xs text-slate-500 line-clamp-2">{p.description}</div> : null}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  <div>{p.maxChannels} channels</div>
                  <div>{p.maxAgents} seats</div>
                  <div>{p.maxAiAgents ?? 1} AI · {p.maxKnowledgeBases ?? 1} KB</div>
                  <div>
                    {p.maxCallsPerDay} calls/d · {p.maxMessagesPerDay} msgs/d
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {p.allowCloudApi ? "Cloud API · " : ""}
                  {p.allowSdk ? "SDK · " : ""}
                  {p.isDefault ? "default" : p.isPublic ? "public" : "hidden"}
                </td>
                <td className="px-4 py-3 font-medium text-white">{formatPlanPrice(p.priceMonthly)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-500/30 disabled:opacity-50"
                      onClick={() => startEdit(p)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy || plans.length < 2}
                      className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/25 disabled:opacity-40"
                      onClick={() => void deletePlan(p)}
                      title={plans.length < 2 ? "Keep at least one plan" : "Delete plan"}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {plans.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No plans yet. Create one above.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
