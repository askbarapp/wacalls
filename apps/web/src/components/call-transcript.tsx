"use client";

import { useEffect, useState } from "react";
import { Copy, FileText, X } from "lucide-react";
import { api } from "@/lib/api";

export type CallTranscriptTurn = {
  role: "user" | "assistant";
  text: string;
  at: string;
};

type TranscriptPayload = {
  callId: string;
  phone: string;
  contactName?: string | null;
  createdAt: string;
  source: "ai" | "tts";
  language?: string | null;
  turns: CallTranscriptTurn[];
};

function formatTurns(turns: CallTranscriptTurn[]) {
  return turns
    .map((turn) => `${turn.role === "assistant" ? "Agent" : "Customer"}: ${turn.text}`)
    .join("\n\n");
}

export function CallTranscriptButton({
  callId,
  hasTranscript,
  className,
}: {
  callId: string;
  hasTranscript?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!hasTranscript) return null;
  return (
    <>
      <button
        type="button"
        className={
          className ??
          "inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-violet-500/20 px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-500/30"
        }
        onClick={() => setOpen(true)}
      >
        <FileText className="h-4 w-4" />
        Transcript
      </button>
      {open ? <CallTranscriptDialog callId={callId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function CallTranscriptDialog({ callId, onClose }: { callId: string; onClose: () => void }) {
  const [data, setData] = useState<TranscriptPayload | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stop = false;
    api<{ success: true; data: TranscriptPayload }>(`/api/v1/calls/${callId}/transcript`)
      .then((res) => {
        if (!stop) setData(res.data);
      })
      .catch((err) => {
        if (!stop) setError(err instanceof Error ? err.message : "Transcript is not available yet");
      });
    return () => {
      stop = true;
    };
  }, [callId]);

  async function copy() {
    if (!data?.turns.length) return;
    await navigator.clipboard.writeText(formatTurns(data.turns));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-sm font-medium text-white">Call transcript</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {data?.contactName || data?.phone || "This call"}
              {data?.source === "tts" ? " · spoken script" : data?.source === "ai" ? " · AI agent" : ""}
            </p>
          </div>
          <button type="button" className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          {!error && !data ? <p className="text-sm text-slate-400">Loading transcript…</p> : null}
          {data?.turns.map((turn, i) => (
            <div key={`${turn.at}-${i}`} className={`mb-3 ${turn.role === "assistant" ? "" : "pl-6"}`}>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                {turn.role === "assistant" ? "Agent" : "Customer"}
              </p>
              <p className="mt-1 rounded-xl bg-white/[0.04] px-3 py-2 text-sm leading-relaxed text-slate-100">
                {turn.text}
              </p>
            </div>
          ))}
        </div>
        {data?.turns.length ? (
          <div className="border-t border-white/10 px-5 py-3">
            <button
              type="button"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm text-slate-200 hover:bg-white/15"
              onClick={() => void copy()}
            >
              <Copy className="h-4 w-4" />
              {copied ? "Copied" : "Copy transcript"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
