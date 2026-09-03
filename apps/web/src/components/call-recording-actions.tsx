"use client";

import { useEffect, useRef, useState } from "react";
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
  compact?: boolean;
  playLabel?: string;
  downloadLabel?: string;
};

function RecordingPlayer({
  loadUrl,
  onDownload,
  compact = false,
  playLabel = "Play recording",
  downloadLabel = "Download",
}: RecordingPlayerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

  return (
    <div className={compact ? "min-w-[11rem]" : "w-full"}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={loading}
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
          className={
            compact
              ? "text-slate-300 hover:underline"
              : "min-h-10 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/15"
          }
          onClick={() => void download()}
        >
          {downloadLabel}
        </button>
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
}: {
  recordingId: string;
  filename?: string;
  mimeType?: string | null;
  compact?: boolean;
}) {
  return (
    <RecordingPlayer
      compact={compact}
      loadUrl={() => playUploadedRecording(recordingId, mimeType)}
      onDownload={() => downloadUploadedRecording(recordingId, filename, mimeType)}
    />
  );
}
