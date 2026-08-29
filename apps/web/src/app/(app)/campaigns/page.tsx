"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [lists, setLists] = useState<any[]>([]);
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
      api<{ success: true; data: any[] }>("/api/v1/campaigns"),
      api<{ success: true; data: any[] }>("/api/v1/channels"),
      api<{ success: true; data: any[] }>("/api/v1/contact-lists"),
    ]);
    setCampaigns(c.data);
    setChannels(ch.data);
    setLists(l.data);
    setForm((f) => ({
      ...f,
      channelId: f.channelId || ch.data[0]?.id || "",
      contactListId: f.contactListId || l.data[0]?.id || "",
    }));
  }
  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Campaigns</h1>
      <div className="mb-8 grid gap-2 md:grid-cols-3">
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value })}>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
        <select value={form.contactListId} onChange={(e) => setForm({ ...form, contactListId: e.target.value })}>
          {lists.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option>SEQUENTIAL</option>
          <option>MANUAL</option>
          <option>RECORDED</option>
          <option>AI_VOICE</option>
        </select>
        <input
          type="number"
          value={form.maxAttempts}
          onChange={(e) => setForm({ ...form, maxAttempts: Number(e.target.value) })}
        />
        <button
          className="rounded-lg bg-brand-500 text-ink-950"
          onClick={() => api("/api/v1/campaigns", { method: "POST", body: JSON.stringify(form) }).then(load)}
        >
          Create
        </button>
      </div>
      <div className="space-y-3">
        {campaigns.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-ink-900 p-4">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-sm text-slate-400">
                {c.type} · {c.status} · {c._count?.campaignContacts ?? 0} contacts
              </div>
            </div>
            <div className="flex gap-2 text-sm">
              <button onClick={() => api(`/api/v1/campaigns/${c.id}/start`, { method: "POST" }).then(load)}>Start</button>
              <button onClick={() => api(`/api/v1/campaigns/${c.id}/pause`, { method: "POST" }).then(load)}>Pause</button>
              <button onClick={() => api(`/api/v1/campaigns/${c.id}/stop`, { method: "POST" }).then(load)}>Stop</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
