"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function AgentsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ email: "", name: "", role: "AGENT", password: "" });
  async function load() {
    const r = await api<{ success: true; data: any[] }>("/api/v1/users");
    setRows(r.data);
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Agents</h1>
      <div className="mb-6 grid gap-2 md:grid-cols-5">
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option>AGENT</option>
          <option>MANAGER</option>
          <option>ORG_ADMIN</option>
        </select>
        <input
          placeholder="Temp password"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <button
          className="rounded-lg bg-brand-500 text-ink-950"
          onClick={() => api("/api/v1/users/invite", { method: "POST", body: JSON.stringify(form) }).then(load)}
        >
          Invite
        </button>
      </div>
      <ul className="space-y-2">
        {rows.map((m) => (
          <li key={m.id} className="flex justify-between rounded-lg border border-white/10 bg-ink-900 px-4 py-3">
            <span>
              {m.user.name} · {m.user.email}
            </span>
            <span className="text-slate-400">
              {m.role} · {m.presence}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
