"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";

type Recording = {
  id: string;
  name: string;
  mimeType?: string | null;
  byteSize?: number | null;
  createdAt: string;
};

export default function RecordingsPage() {
  const [rows, setRows] = useState<Recording[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await api<{ success: true; data: Recording[] }>("/api/v1/recordings");
    setRows(r.data);
  }
  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  async function upload(file: File) {
    setError("");
    setMsg("");
    const token = localStorage.getItem("wacalls_token");
    const base = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${base}/api/v1/recordings`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: fd,
      credentials: "include",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error?.message ?? "Upload failed");
      return;
    }
    setMsg("Recording uploaded. Attach it to a RECORDED campaign after WhatsApp is linked.");
    await load();
  }

  return (
    <div>
      <PageHeader
        title="Recordings"
        subtitle="WAV/MP3 files for recorded campaigns. Playback only works if the calling engine reports recordedPlayback."
      />
      {error ? <p className="mb-4 text-sm text-rose-400">{error}</p> : null}
      {msg ? <p className="mb-4 text-sm text-brand-400">{msg}</p> : null}
      <label className="mb-6 inline-flex cursor-pointer rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-brand-400">
        Upload WAV / MP3
        <input
          type="file"
          accept=".wav,.mp3,audio/wav,audio/mpeg"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </label>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="flex justify-between rounded-xl border border-white/10 bg-ink-900 px-4 py-3 text-sm">
            <span>{r.name}</span>
            <span className="text-slate-500">{new Date(r.createdAt).toLocaleString()}</span>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">
            No recordings yet.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
