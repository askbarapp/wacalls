"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { ConnectionBadge } from "@/components/status-badge";

type Channel = { id: string; displayName: string; phoneNumber?: string | null; status: string };
type Visit = {
  id: string;
  name: string;
  publicKey: string;
  targetPhone: string;
  buttonLabel: string;
  greeting: string;
  enabled: boolean;
  chatEnabled?: boolean;
  callEnabled?: boolean;
  aiEnabled?: boolean;
  channel?: Channel;
  departments?: Array<{ id: string; name: string }>;
  _count?: { leads: number; conversations: number; sessions: number };
};

export default function VisitsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "Website support",
    channel_id: "",
    target_phone: "",
    button_label: "Chat with us",
    greeting: "Hi! Pick a department and chat with us on WhatsApp.",
    purposes: "Sales, Support, Partnership, Other",
  });

  useEffect(() => {
    api<{ success: true; data: Channel[] }>("/api/v1/channels")
      .then((r) => {
        setChannels(r.data);
        const linked = r.data.find((c) => c.status === "CONNECTED") ?? r.data[0];
        if (linked) {
          setForm((f) => ({
            ...f,
            channel_id: linked.id,
            target_phone: f.target_phone || linked.phoneNumber || "",
          }));
        }
      })
      .catch(() => undefined);
    void load();
  }, []);

  async function load() {
    const r = await api<{ success: true; data: Visit[] }>("/api/v1/visits");
    setVisits(r.data);
  }

  return (
    <div>
      <PageHeader
        title="Website Visit"
        subtitle="Embed a WhatsApp support chat on any website. See which page a visitor is on, route them to a department, chat or call, and optionally let AI handle it."
      />
      {error ? (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <section className="mb-8 rounded-2xl border border-white/10 bg-ink-900/70 p-5">
        <div className="mb-3 font-medium text-white">Create a website</div>
        <div className="grid gap-3 md:grid-cols-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Site name" />
          <select value={form.channel_id} onChange={(e) => setForm({ ...form, channel_id: e.target.value })}>
            <option value="">Default WhatsApp instance</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName} {c.phoneNumber ?? ""} · {c.status}
              </option>
            ))}
          </select>
          <input
            value={form.target_phone}
            onChange={(e) => setForm({ ...form, target_phone: e.target.value })}
            placeholder="Fallback number (e.g. +9188…)"
          />
          <input
            value={form.button_label}
            onChange={(e) => setForm({ ...form, button_label: e.target.value })}
            placeholder="Widget button"
          />
          <input
            className="md:col-span-2"
            value={form.greeting}
            onChange={(e) => setForm({ ...form, greeting: e.target.value })}
            placeholder="Greeting"
          />
          <input
            className="md:col-span-2"
            value={form.purposes}
            onChange={(e) => setForm({ ...form, purposes: e.target.value })}
            placeholder="Departments, comma separated"
          />
        </div>
        <button
          className="mt-4 rounded-lg bg-brand-500 px-4 py-2 font-medium text-ink-950"
          onClick={async () => {
            setError("");
            try {
              await api("/api/v1/visits", {
                method: "POST",
                body: JSON.stringify({
                  name: form.name,
                  channel_id: form.channel_id,
                  target_phone: form.target_phone,
                  button_label: form.button_label,
                  greeting: form.greeting,
                  purposes: form.purposes.split(",").map((s) => s.trim()).filter(Boolean),
                }),
              });
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not create website visit");
            }
          }}
        >
          Create website visit
        </button>
      </section>

      <ul className="grid gap-4 md:grid-cols-2">
        {visits.map((v) => (
          <li key={v.id}>
            <Link
              href={`/visits/${v.id}`}
              className="block rounded-2xl border border-white/10 bg-ink-900/70 p-5 transition hover:border-brand-400/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-white">{v.name}</div>
                  <div className="mt-1 text-sm text-slate-400">
                    {v._count?.conversations ?? 0} chats · {v._count?.leads ?? 0} calls · {v.departments?.length ?? 0} departments
                  </div>
                </div>
                <ConnectionBadge status={v.channel?.status ?? "DISCONNECTED"} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                {v.chatEnabled !== false ? <span className="rounded-full bg-white/5 px-2 py-0.5">Chat</span> : null}
                {v.callEnabled !== false ? <span className="rounded-full bg-white/5 px-2 py-0.5">Call</span> : null}
                {v.aiEnabled ? <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-violet-300">AI on</span> : null}
                {!v.enabled ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-200">Paused</span> : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
