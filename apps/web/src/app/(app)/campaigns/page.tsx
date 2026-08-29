"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";

type Campaign = {
  id: string;
  name: string;
  type: string;
  status: string;
  maxAttempts: number;
  retryDelayMin: number;
  channel?: { id: string; displayName: string; status: string };
  _count?: { campaignContacts: number; calls: number };
};

type Channel = { id: string; displayName: string; status: string; phoneNumber?: string | null };
type List = { id: string; name: string };

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    channelId: "",
    contactListId: "",
    type: "SEQUENTIAL",
    maxAttempts: 3,
    retryDelayMin: 30,
  });

  async function load() {
    const [c, ch, l] = await Promise.all([
      api<{ success: true; data: Campaign[] }>("/api/v1/campaigns"),
      api<{ success: true; data: Channel[] }>("/api/v1/channels"),
      api<{ success: true; data: List[] }>("/api/v1/contact-lists"),
    ]);
    setCampaigns(c.data);
    setChannels(ch.data);
    setLists(l.data);
    setForm((f) => ({
      ...f,
      channelId: f.channelId || ch.data.find((x) => x.status === "CONNECTED")?.id || ch.data[0]?.id || "",
      contactListId: f.contactListId || l.data[0]?.id || "",
    }));
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setError("");
    try {
      await api("/api/v1/campaigns", { method: "POST", body: JSON.stringify(form) });
      setForm((f) => ({ ...f, name: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create campaign");
    }
  }

  async function act(id: string, action: "start" | "pause" | "stop") {
    setError("");
    try {
      await api(`/api/v1/campaigns/${id}/${action}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    }
  }

  const selected = channels.find((c) => c.id === form.channelId);

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle="Sequential bulk dialing uses one WhatsApp line at a time. The line must be CONNECTED before start."
      />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}{" "}
          {error.toLowerCase().includes("connect") ? (
            <Link href="/channels" className="font-medium text-brand-400 underline">
              Open WhatsApp
            </Link>
          ) : null}
        </div>
      ) : null}
      <div className="mb-8 rounded-2xl border border-white/10 bg-ink-900/70 p-5">
        <div className="mb-4 text-sm font-medium text-white">New campaign</div>
        <div className="grid gap-3 md:grid-cols-3">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value })}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName} · {c.status}
              </option>
            ))}
          </select>
          <select value={form.contactListId} onChange={(e) => setForm({ ...form, contactListId: e.target.value })}>
            {lists.length === 0 ? <option value="">No lists — create one in Contacts</option> : null}
            {lists.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="SEQUENTIAL">SEQUENTIAL (one-by-one)</option>
            <option value="MANUAL">MANUAL</option>
            <option value="RECORDED">RECORDED</option>
            <option value="AI_VOICE">AI_VOICE</option>
          </select>
          <input
            type="number"
            min={1}
            max={10}
            value={form.maxAttempts}
            onChange={(e) => setForm({ ...form, maxAttempts: Number(e.target.value) })}
          />
          <input
            type="number"
            min={1}
            value={form.retryDelayMin}
            onChange={(e) => setForm({ ...form, retryDelayMin: Number(e.target.value) })}
          />
        </div>
        {selected && selected.status !== "CONNECTED" ? (
          <p className="mt-3 text-xs text-amber-200">
            Selected line is {selected.status}. Link it on the WhatsApp page before starting.
          </p>
        ) : null}
        <button onClick={create} className="mt-4 rounded-lg bg-brand-500 px-5 py-2 font-medium text-ink-950 hover:bg-brand-400">
          Create campaign
        </button>
      </div>
      <div className="space-y-3">
        {campaigns.map((c) => (
          <div
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-900/80 p-4"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">{c.name}</span>
                <StatusBadge status={c.status} />
              </div>
              <div className="mt-1 text-sm text-slate-400">
                {c.type} · {c.channel?.displayName ?? "channel"} · {c._count?.campaignContacts ?? 0} contacts ·{" "}
                {c._count?.calls ?? 0} calls · retry {c.maxAttempts}× / {c.retryDelayMin}m
              </div>
            </div>
            <div className="flex gap-2 text-sm">
              <button
                className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-brand-400"
                onClick={() => act(c.id, "start")}
              >
                Start
              </button>
              <button className="rounded-lg bg-white/10 px-3 py-1.5" onClick={() => act(c.id, "pause")}>
                Pause
              </button>
              <button className="rounded-lg bg-white/10 px-3 py-1.5" onClick={() => act(c.id, "stop")}>
                Stop
              </button>
            </div>
          </div>
        ))}
        {campaigns.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">
            No campaigns yet. Add contacts to a list, connect WhatsApp, then create a sequential campaign.
          </div>
        ) : null}
      </div>
    </div>
  );
}
