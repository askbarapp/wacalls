"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { formatCallDuration, type CallRow } from "@/lib/call-log";
import { CallTranscriptButton } from "@/components/call-transcript";
import { CallRecordingActions, UploadedRecordingActions } from "@/components/call-recording-actions";

type Recording = {
  id: string;
  name: string;
  mimeType?: string | null;
  byteSize?: number | null;
  createdAt: string;
};

export default function RecordingsPage() {
  const [rows, setRows] = useState<Recording[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const [campaign, live] = await Promise.all([
      api<{ success: true; data: Recording[] }>("/api/v1/recordings"),
      api<{ success: true; data: CallRow[] }>("/api/v1/calls?hasRecording=true&limit=50"),
    ]);
    setRows(campaign.data);
    setCalls(live.data ?? []);
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
    setMsg("Recording uploaded. Attach it to a Recorded voice campaign.");
    await load();
  }

  return (
    <div>
      <PageHeader
        title="Recordings"
        subtitle="Live call recordings are saved automatically after a connected WhatsApp call. AI and voice-agent calls also keep a transcript of what was said. Campaign audio is played on Recorded voice bulk campaigns."
      />
      {error ? <p className="mb-4 text-sm text-rose-400">{error}</p> : null}
      {msg ? <p className="mb-4 text-sm text-brand-400">{msg}</p> : null}

      <h2 className="mb-3 text-sm font-medium text-white">Call recordings</h2>
      <ul className="mb-10 space-y-2">
        {calls.map((c) => (
          <li key={c.id} className="rounded-xl border border-white/10 bg-ink-900 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-white">{c.contactName || c.phone}</p>
                <p className="text-[11px] text-slate-500">
                  {new Date(c.createdAt).toLocaleString()} · {formatCallDuration(c.durationMs)}
                </p>
              </div>
              <CallTranscriptButton callId={c.id} hasTranscript={c.hasTranscript} />
            </div>
            <div className="mt-3">
              <CallRecordingActions callId={c.id} />
            </div>
          </li>
        ))}
        {calls.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">
            No live call recordings yet. Connected calls are saved automatically.{" "}
            <Link className="text-brand-400" href="/history">
              Open call log
            </Link>
          </li>
        ) : null}
      </ul>

      <h2 className="mb-3 text-sm font-medium text-white">Campaign audio</h2>
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
          <li key={r.id} className="rounded-xl border border-white/10 bg-ink-900 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-white">{r.name}</span>
              <span className="text-slate-500">{new Date(r.createdAt).toLocaleString()}</span>
            </div>
            <div className="mt-3">
              <UploadedRecordingActions recordingId={r.id} filename={r.name} mimeType={r.mimeType} />
            </div>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">
            No campaign audio yet.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
