"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { formatCallDuration, type CallRow } from "@/lib/call-log";
import { CallTranscriptButton } from "@/components/call-transcript";
import { CallRecordingActions, UploadedRecordingActions } from "@/components/call-recording-actions";
import { ListPagination } from "@/components/list-pagination";
import { assertUploadAudioDuration } from "@/lib/audio-upload";
import { emptyMeta, type ListMeta, type PageSize } from "@/lib/csv";

type Recording = {
  id: string;
  name: string;
  mimeType?: string | null;
  byteSize?: number | null;
  durationMs?: number | null;
  createdAt: string;
};

export default function RecordingsPage() {
  const [rows, setRows] = useState<Recording[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [recMeta, setRecMeta] = useState<ListMeta>(emptyMeta(25));
  const [callMeta, setCallMeta] = useState<ListMeta>(emptyMeta(25));
  const [recPage, setRecPage] = useState(1);
  const [callPage, setCallPage] = useState(1);
  const [recPageSize, setRecPageSize] = useState<PageSize>(25);
  const [callPageSize, setCallPageSize] = useState<PageSize>(25);
  const [loadingCalls, setLoadingCalls] = useState(true);
  const [loadingRecs, setLoadingRecs] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);

  async function loadCalls(page = callPage, limit = callPageSize) {
    setLoadingCalls(true);
    try {
      const live = await api<{ success: true; data: CallRow[]; meta?: ListMeta }>(
        `/api/v1/calls?hasRecording=true&page=${page}&limit=${limit}`,
      );
      setCalls(live.data ?? []);
      setCallMeta(live.meta ?? { ...emptyMeta(limit), total: live.data?.length ?? 0, page });
    } finally {
      setLoadingCalls(false);
    }
  }

  async function loadRecordings(page = recPage, limit = recPageSize) {
    setLoadingRecs(true);
    try {
      const campaign = await api<{ success: true; data: Recording[]; meta?: ListMeta }>(
        `/api/v1/recordings?page=${page}&limit=${limit}`,
      );
      setRows(campaign.data);
      setRecMeta(campaign.meta ?? { ...emptyMeta(limit), total: campaign.data?.length ?? 0, page });
    } finally {
      setLoadingRecs(false);
    }
  }

  useEffect(() => {
    void loadCalls().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [callPage, callPageSize]);

  useEffect(() => {
    void loadRecordings().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [recPage, recPageSize]);

  async function upload(file: File) {
    setError("");
    setMsg("");
    setUploading(true);
    try {
      await assertUploadAudioDuration(file);
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
      setRecPage(1);
      await loadRecordings(1, recPageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Recordings"
        subtitle="Live call recordings are saved automatically after a connected WhatsApp call. AI and voice-agent calls also keep a transcript of what was said. Campaign audio is played on Recorded voice bulk campaigns (max 3 minutes per upload)."
      />
      {error ? <p className="mb-4 text-sm text-rose-400">{error}</p> : null}
      {msg ? <p className="mb-4 text-sm text-brand-400">{msg}</p> : null}

      <h2 className="mb-3 text-sm font-medium text-white">Call recordings</h2>
      <ul className="mb-2 space-y-2">
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
      <ListPagination
        className="mb-10"
        meta={callMeta}
        loading={loadingCalls}
        pageSize={callPageSize}
        onPageChange={setCallPage}
        onPageSizeChange={(size) => {
          setCallPageSize(size);
          setCallPage(1);
        }}
      />

      <h2 className="mb-3 text-sm font-medium text-white">Campaign audio</h2>
      <label
        className={`mb-6 inline-flex cursor-pointer rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-brand-400 ${uploading ? "pointer-events-none opacity-50" : ""}`}
      >
        {uploading ? "Uploading…" : "Upload WAV / MP3 (max 3 min)"}
        <input
          type="file"
          accept=".wav,.mp3,audio/wav,audio/mpeg"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </label>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-white/10 bg-ink-900 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-white">{r.name}</span>
              <span className="text-slate-500">
                {r.durationMs ? `${formatCallDuration(r.durationMs)} · ` : ""}
                {new Date(r.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="mt-3">
              <UploadedRecordingActions
                recordingId={r.id}
                filename={r.name}
                mimeType={r.mimeType}
                onDeleted={() => void loadRecordings()}
              />
            </div>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">
            No campaign audio yet.
          </li>
        ) : null}
      </ul>
      <ListPagination
        meta={recMeta}
        loading={loadingRecs}
        pageSize={recPageSize}
        onPageChange={setRecPage}
        onPageSizeChange={(size) => {
          setRecPageSize(size);
          setRecPage(1);
        }}
      />
    </div>
  );
}
