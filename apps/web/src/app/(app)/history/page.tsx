"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { CallTranscriptButton } from "@/components/call-transcript";
import { CallRecordingActions } from "@/components/call-recording-actions";
import {
  CALL_RESULT_FILTERS,
  CALL_SOURCE_FILTERS,
  callResultLabel,
  formatCallDuration,
  type CallListMeta,
  type CallRow,
} from "@/lib/call-log";

type Channel = {
  id: string;
  displayName: string;
  phoneNumber?: string | null;
};

const PAGE_SIZE = 25;

const emptyMeta: CallListMeta = { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 };

export default function CallLogPage() {
  const [rows, setRows] = useState<CallRow[]>([]);
  const [meta, setMeta] = useState<CallListMeta>(emptyMeta);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [result, setResult] = useState("");
  const [source, setSource] = useState("");
  const [channelId, setChannelId] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ success: true; data: Channel[] }>("/api/v1/channels")
      .then((r) => setChannels(r.data ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [result, source, channelId, q, from, to]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(PAGE_SIZE));
    if (result) params.set("result", result);
    if (source) params.set("source", source);
    if (channelId) params.set("channelId", channelId);
    if (q) params.set("q", q);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    let stop = false;
    setLoading(true);
    api<{ success: true; data: CallRow[]; meta?: CallListMeta }>(`/api/v1/calls?${params}`)
      .then((r) => {
        if (stop) return;
        setRows(r.data ?? []);
        setMeta(r.meta ?? { ...emptyMeta, total: r.data?.length ?? 0, page });
        setError("");
      })
      .catch((err) => {
        if (stop) return;
        setError(err instanceof Error ? err.message : "Could not load call log");
      })
      .finally(() => {
        if (!stop) setLoading(false);
      });
    return () => {
      stop = true;
    };
  }, [page, result, source, channelId, q, from, to]);

  const range = useMemo(() => {
    if (meta.total === 0) return "0 of 0";
    const start = (meta.page - 1) * meta.limit + 1;
    const end = Math.min(meta.page * meta.limit, meta.total);
    return `${start}–${end} of ${meta.total}`;
  }, [meta]);

  function changeFilter<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setPage(1);
  }

  return (
    <div>
      <PageHeader
        title="Call log"
        subtitle="Every call from this workspace — dialer, campaigns, website visits, and SDK. Filter by result, source, line, or date."
      />

      <div className="mb-4 grid gap-3 rounded-2xl border border-white/10 bg-ink-900/70 p-4 md:grid-cols-2 xl:grid-cols-6">
        <label className="block text-left text-[11px] uppercase tracking-[0.16em] text-slate-500">
          Result
          <select className="mt-1" value={result} onChange={(e) => changeFilter(setResult, e.target.value)}>
            {CALL_RESULT_FILTERS.map((f) => (
              <option key={f.id || "all"} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-left text-[11px] uppercase tracking-[0.16em] text-slate-500">
          Source
          <select className="mt-1" value={source} onChange={(e) => changeFilter(setSource, e.target.value)}>
            {CALL_SOURCE_FILTERS.map((f) => (
              <option key={f.id || "all"} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-left text-[11px] uppercase tracking-[0.16em] text-slate-500">
          Line
          <select className="mt-1" value={channelId} onChange={(e) => changeFilter(setChannelId, e.target.value)}>
            <option value="">All lines</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
                {c.phoneNumber ? ` · ${c.phoneNumber}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-left text-[11px] uppercase tracking-[0.16em] text-slate-500">
          Search
          <input
            className="mt-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or number"
          />
        </label>
        <label className="block text-left text-[11px] uppercase tracking-[0.16em] text-slate-500">
          From
          <input className="mt-1" type="date" value={from} onChange={(e) => changeFilter(setFrom, e.target.value)} />
        </label>
        <label className="block text-left text-[11px] uppercase tracking-[0.16em] text-slate-500">
          To
          <input className="mt-1" type="date" value={to} onChange={(e) => changeFilter(setTo, e.target.value)} />
        </label>
      </div>

      {error ? <p className="mb-4 text-sm text-rose-400">{error}</p> : null}

      <div className="overflow-auto rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th>Contact</th>
              <th>Phone</th>
              <th>From</th>
              <th>Campaign</th>
              <th>Agent</th>
              <th>Line</th>
              <th>Status</th>
              <th>Result</th>
              <th>Duration</th>
              <th>Recording</th>
              <th>Transcript</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-white/5">
                <td className="whitespace-nowrap px-4 py-3">{new Date(c.createdAt).toLocaleString()}</td>
                <td>{c.contactName || "—"}</td>
                <td className="whitespace-nowrap">{c.phone}</td>
                <td className="capitalize text-slate-400">{c.source || "dialer"}</td>
                <td>{c.campaign?.name || "—"}</td>
                <td>{c.agent?.name || "—"}</td>
                <td>{c.channel?.displayName || "—"}</td>
                <td>
                  <StatusBadge status={c.status} />
                </td>
                <td>
                  <span className="text-slate-200">{callResultLabel(c)}</span>
                  {c.failureReason ? (
                    <p className="mt-0.5 max-w-xs truncate text-[11px] text-slate-500">{c.failureReason}</p>
                  ) : null}
                </td>
                <td>{formatCallDuration(c.durationMs)}</td>
                <td>
                  {c.recordingPath ? <CallRecordingActions callId={c.id} compact /> : "—"}
                </td>
                <td>
                  <CallTranscriptButton
                    callId={c.id}
                    hasTranscript={c.hasTranscript}
                    className="inline-flex items-center gap-1 text-sm text-violet-300 hover:underline"
                  />
                  {!c.hasTranscript ? <span className="text-slate-600">—</span> : null}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-slate-500" colSpan={12}>
                  No calls match these filters.
                </td>
              </tr>
            ) : null}
            {loading && rows.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-slate-500" colSpan={12}>
                  Loading call log…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
        <span>{range}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-slate-200"
            disabled={meta.page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
          <span className="min-w-[5.5rem] text-center tabular-nums">
            {meta.page} / {meta.totalPages}
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-slate-200"
            disabled={meta.page >= meta.totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
