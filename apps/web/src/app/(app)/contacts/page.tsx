"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function ContactsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", email: "", company: "" });
  const [preview, setPreview] = useState<any>(null);

  async function load() {
    const r = await api<{ success: true; data: any[] }>(`/api/v1/contacts?q=${encodeURIComponent(q)}`);
    setRows(r.data);
  }
  useEffect(() => {
    void load();
  }, []);

  async function add() {
    await api("/api/v1/contacts", { method: "POST", body: JSON.stringify(form) });
    setForm({ name: "", phone: "", email: "", company: "" });
    await load();
  }

  async function importCsv(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const token = localStorage.getItem("wacalls_token");
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/contacts/import/preview`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: fd,
      credentials: "include",
    });
    setPreview(await res.json());
  }

  async function confirmImport() {
    await api("/api/v1/contacts/import/confirm", {
      method: "POST",
      body: JSON.stringify({
        importId: preview.data.importId,
        rows: preview.data.rows,
      }),
    });
    setPreview(null);
    await load();
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Contacts</h1>
      <div className="mb-4 flex gap-2">
        <input placeholder="New list name" id="listName" />
        <button
          className="rounded-lg bg-white/10 px-4"
          onClick={async () => {
            const el = document.getElementById("listName") as HTMLInputElement;
            if (!el.value) return;
            await api("/api/v1/contact-lists", { method: "POST", body: JSON.stringify({ name: el.value }) });
            el.value = "";
          }}
        >
          Create list
        </button>
      </div>
        <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={load} className="rounded-lg bg-white/10 px-4">
          Search
        </button>
        <a href={`${process.env.NEXT_PUBLIC_API_URL}/api/v1/contacts/export`} className="rounded-lg bg-white/10 px-4 py-2 text-sm">
          Export CSV
        </a>
        <label className="rounded-lg bg-brand-500/20 px-4 py-2 text-sm text-brand-400">
          Import CSV
          <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
        </label>
      </div>
      {preview?.data ? (
        <div className="mb-6 rounded-xl border border-white/10 bg-ink-900 p-4 text-sm">
          <p>
            Total: {preview.data.total} · Valid: {preview.data.valid} · Invalid: {preview.data.invalid} ·
            Duplicates: {preview.data.duplicates}
          </p>
          <button onClick={confirmImport} className="mt-3 rounded-lg bg-brand-500 px-4 py-1.5 text-ink-950">
            Confirm import
          </button>
        </div>
      ) : null}
      <div className="mb-6 grid gap-2 md:grid-cols-5">
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
        <button onClick={add} className="rounded-lg bg-brand-500 text-ink-950">
          Add
        </button>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-slate-400">
          <tr>
            <th className="py-2">Name</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Company</th>
            <th>DNC</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-t border-white/5">
              <td className="py-2">{c.name}</td>
              <td>{c.phone}</td>
              <td>{c.email}</td>
              <td>{c.company}</td>
              <td>{c.doNotCall ? "Yes" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
