"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  claimPlayback,
  downloadCallRecording,
  downloadUploadedRecording,
  playCallRecording,
  playUploadedRecording,
  releasePlayback,
} from "@/lib/call-recording";

type RecordingPlayerProps = {
  loadUrl: () => Promise<string>;
  onDownload: () => Promise<void>;
  onDelete?: () => Promise<void>;
  compact?: boolean;
  playLabel?: string;
  downloadLabel?: string;
  deleteLabel?: string;
};

function RecordingPlayer({
  loadUrl,
  onDownload,
  onDelete,
  compact = false,
  playLabel = "Play recording",
  downloadLabel = "Download",
  deleteLabel = "Delete",
}: RecordingPlayerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const stopRef = useRef<() => void>(() => undefined);

  stopRef.current = () => {
    audioRef.current?.pause();
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setUrl(null);
    setLoading(false);
  };

  useEffect(() => {
    const stop = () => stopRef.current();
    return () => {
      stop();
      releasePlayback(stop);
    };
  }, []);

  useEffect(() => {
    if (!url || !audioRef.current) return;
    void audioRef.current.play().catch(() => undefined);
  }, [url]);

  async function play() {
    setError("");
    setLoading(true);
    const stop = () => stopRef.current();
    claimPlayback(stop);
    try {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const next = await loadUrl();
      urlRef.current = next;
      setUrl(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not play recording");
      stop();
    } finally {
      setLoading(false);
    }
  }

  async function download() {
    setError("");
    try {
      await onDownload();
    } catch {
      setError("Download failed");
    }
  }

  async function remove() {
    if (!onDelete) return;
    setError("");
    setDeleting(true);
    try {
      stopRef.current();
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={compact ? "min-w-[11rem]" : "w-full"}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={loading || deleting}
          className={
            compact
              ? "text-brand-400 hover:underline disabled:opacity-50"
              : "min-h-10 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-brand-400 disabled:opacity-50"
          }
          onClick={() => void play()}
        >
          {loading ? "Loading…" : url ? "Playing" : playLabel}
        </button>
        <button
          type="button"
          disabled={deleting}
          className={
            compact
              ? "text-slate-300 hover:underline disabled:opacity-50"
              : "min-h-10 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/15 disabled:opacity-50"
          }
          onClick={() => void download()}
        >
          {downloadLabel}
        </button>
        {onDelete ? (
          <button
            type="button"
            disabled={deleting}
            className={
              compact
                ? "text-rose-300 hover:underline disabled:opacity-50"
                : "min-h-10 rounded-lg bg-rose-500/15 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-500/25 disabled:opacity-50"
            }
            onClick={() => void remove()}
          >
            {deleting ? "Deleting…" : deleteLabel}
          </button>
        ) : null}
      </div>
      {url ? (
        <audio
          ref={audioRef}
          className="mt-2 w-full min-w-[12rem] accent-brand-500"
          src={url}
          controls
          autoPlay
          preload="auto"
        />
      ) : null}
      {error ? <p className="mt-1 text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}

export function CallRecordingActions({
  callId,
  compact,
}: {
  callId: string;
  compact?: boolean;
}) {
  return (
    <RecordingPlayer
      compact={compact}
      loadUrl={() => playCallRecording(callId)}
      onDownload={() => downloadCallRecording(callId)}
    />
  );
}

export function UploadedRecordingActions({
  recordingId,
  filename,
  mimeType,
  compact,
  onDeleted,
}: {
  recordingId: string;
  filename?: string;
  mimeType?: string | null;
  compact?: boolean;
  onDeleted?: () => void | Promise<void>;
}) {
  async function remove() {
    if (!confirm(`Delete “${filename || "this audio"}”? This cannot be undone.`)) return;
    await api(`/api/v1/recordings/${recordingId}`, { method: "DELETE" });
    await onDeleted?.();
  }

  return (
    <RecordingPlayer
      compact={compact}
      loadUrl={() => playUploadedRecording(recordingId, mimeType)}
      onDownload={() => downloadUploadedRecording(recordingId, filename, mimeType)}
      onDelete={onDeleted ? remove : undefined}
      playLabel="Play audio"
    />
  );
}
