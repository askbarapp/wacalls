"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Reply } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { TRIGGER_ICON, TRIGGERS, type TriggerId } from "@/components/auto-reply-form";

type Rule = {
  id: string;
  name: string;
  trigger: TriggerId;
  campaign: { id: string; name: string } | null;
  body: string;
  delaySeconds: number;
  cooldownMinutes: number;
  enabled: boolean;
  sendCount: number;
};

const EMPTY = { ANSWERED: 0, NO_ANSWER: 0, REJECTED: 0, NOT_CONNECTED: 0 };

export default function AutoReplyPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TriggerId>("ANSWERED");
  const [rules, setRules] = useState<Rule[]>([]);
  const [counts, setCounts] = useState(EMPTY);
  const [error, setError] = useState("");

  async function load() {
    const r = await api<{
      success: true;
      data: { rules: Rule[]; counts: typeof EMPTY };
    }>("/api/v1/auto-reply-rules");
    setRules(r.data.rules);
    setCounts(r.data.counts ?? EMPTY);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  const [busy, setBusy] = useState(false);

  async function setupRecommended() {
    setError("");
    setBusy(true);
    try {
      await api("/api/v1/auto-reply-rules/recommended", { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set up follow-ups");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: Rule) {
    setError("");
    try {
      await api(`/api/v1/auto-reply-rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update rule");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this auto reply rule?")) return;
    try {
      await api(`/api/v1/auto-reply-rules/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete rule");
    }
  }

  const visible = rules.filter((rule) => rule.trigger === tab);

  return (
    <div>
      <PageHeader
        title="Call follow-up"
        subtitle="After a WhatsApp call is received, rejected, or unanswered, send a personalized template — Yes / No follow-up (buttons when supported, otherwise reply by text)."
        actions={
          <Link
            href={`/auto-reply/new?trigger=${tab}`}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-brand-400"
          >
            <Plus className="h-4 w-4" /> New rule
          </Link>
        }
      />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {TRIGGERS.map((item) => {
          const Icon = TRIGGER_ICON[item.id];
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-2xl border px-4 py-3 text-left ${
                active ? "border-brand-500 bg-brand-500/10" : "border-white/10 bg-ink-900/50 hover:border-white/20"
              }`}
            >
              <Icon className={`h-4 w-4 ${active ? "text-brand-400" : "text-slate-400"}`} />
              <div className="mt-2 text-sm font-medium text-white">{item.label}</div>
              <div className="text-xs text-slate-500">
                {counts[item.id]} {counts[item.id] === 1 ? "rule" : "rules"}
              </div>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-ink-900/50 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/15 text-brand-400">
            <Reply className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-medium text-white">No follow-up for this event yet</h2>
          <p className="mt-2 max-w-md text-sm text-slate-400">
            After the call ends, WhatsApp can send a designed template automatically — for example Interested / Not
            interested after a received call, or a call-back note when the call is rejected or unanswered.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => void setupRecommended()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-950"
            >
              {busy ? "Setting up…" : "Set up recommended follow-ups"}
            </button>
            <button
              type="button"
              onClick={() => router.push(`/auto-reply/new?trigger=${tab}`)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200"
            >
              <Plus className="h-4 w-4" /> Custom rule
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((rule) => (
            <div key={rule.id} className="rounded-2xl border border-white/10 bg-ink-900/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <Link href={`/auto-reply/${rule.id}`} className="min-w-0 flex-1">
                  <div className="font-medium text-white">{rule.name}</div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-400">{rule.body}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {rule.campaign?.name ?? "All outbound calls"} · delay {rule.delaySeconds}s · cooldown{" "}
                    {rule.cooldownMinutes}m · {rule.sendCount} sent
                  </p>
                </Link>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void toggle(rule)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      rule.enabled ? "bg-brand-500/15 text-brand-300" : "bg-white/10 text-slate-400"
                    }`}
                  >
                    {rule.enabled ? "On" : "Off"}
                  </button>
                  <button type="button" onClick={() => void remove(rule.id)} className="text-xs text-rose-300">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
