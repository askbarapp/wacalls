"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Delete,
  Grid3X3,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  User,
  Volume2,
  VolumeX,
} from "lucide-react";
import { api, ensureAccessToken } from "@/lib/api";
import { callResultLabel, formatCallDuration, type CallRow } from "@/lib/call-log";
import { assertUploadAudioDuration } from "@/lib/audio-upload";
import { startCallAudio, type CallAudioHandle } from "@/lib/call-audio";
import { playDialTone } from "@/lib/dtmf";
import { ConnectionBadge } from "@/components/status-badge";
import {
  DialerModePanel,
  type CallMode,
  type DialerAgent,
  type DialerLang,
  type DialerRecording,
} from "@/components/dialer-mode-panel";

type Channel = {
  id: string;
  displayName: string;
  phoneNumber?: string | null;
  status: string;
};

const KEYS: Array<[string, string]> = [
  ["1", ""],
  ["2", "ABC"],
  ["3", "DEF"],
  ["4", "GHI"],
  ["5", "JKL"],
  ["6", "MNO"],
  ["7", "PQRS"],
  ["8", "TUV"],
  ["9", "WXYZ"],
  ["*", ""],
  ["0", "+"],
  ["#", ""],
];

const LANGUAGES: DialerLang[] = [
  { code: "hi-IN", label: "Hindi" },
  { code: "en-IN", label: "English (India)" },
  { code: "bn-IN", label: "Bengali" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" },
  { code: "mr-IN", label: "Marathi" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "kn-IN", label: "Kannada" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "pa-IN", label: "Punjabi" },
];
const SPEAKERS = ["shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan"];

const IN_CALL = ["CONNECTING", "RINGING", "ANSWERED", "QUEUED"];

function humanizeCallError(message: string) {
  if (/Connection Closed|conflict|replaced/i.test(message)) {
    return "WhatsApp dropped the session while starting the call. Wait until the line shows Connected, then try again.";
  }
  if (/resolve LID|resolve this WhatsApp identity/i.test(message)) {
    return "WhatsApp could not identify this number for calling. Send them a message from this line first, then call again.";
  }
  if (/already in progress|End that call first/i.test(message)) {
    return "A call is already in progress on this line. End it first, then dial again.";
  }
  if (/Not signed in/i.test(message)) {
    return "Session expired. Refresh the page, sign in again, then dial.";
  }
  return message;
}

function formatPhone(cc: string, number: string) {
  const digits = number.replace(/\D/g, "");
  if (!digits) return `+${cc}`;
  if (digits.length <= 5) return `+${cc} ${digits}`;
  return `+${cc} ${digits.slice(0, digits.length - 5)} ${digits.slice(-5)}`.replace(/\s+/g, " ");
}

function statusLabel(status: string) {
  if (status === "CONNECTING") return "Connecting…";
  if (status === "RINGING") return "Ringing…";
  if (status === "ANSWERED") return "Connected";
  if (status === "QUEUED") return "Waiting…";
  return status;
}

export default function DialerPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [cc, setCc] = useState("91");
  const [number, setNumber] = useState("");
  const [status, setStatus] = useState("READY");
  const [callId, setCallId] = useState<string | null>(null);
  const [started, setStarted] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  const [queuePos, setQueuePos] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [showPad, setShowPad] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [waName, setWaName] = useState<string | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [history, setHistory] = useState<CallRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [mode, setMode] = useState<CallMode>("live");
  const [agents, setAgents] = useState<DialerAgent[]>([]);
  const [recordings, setRecordings] = useState<DialerRecording[]>([]);
  const [sarvam, setSarvam] = useState(false);
  const [aiConfigId, setAiConfigId] = useState("");
  const [recordingId, setRecordingId] = useState("");
  const [ttsBody, setTtsBody] = useState("");
  const [ttsLanguage, setTtsLanguage] = useState("hi-IN");
  const [ttsSpeaker, setTtsSpeaker] = useState("shubh");
  const [recipientName, setRecipientName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<CallAudioHandle | null>(null);

  function resetLocalCall() {
    setCallId(null);
    setStarted(null);
    setMuted(false);
    setSpeakerOn(true);
    setShowPad(false);
    setQueuePos(null);
    setMicReady(false);
    audioRef.current?.stop();
    audioRef.current = null;
  }

  function loadHistory() {
    api<{ success: true; data: CallRow[]; meta?: { total: number } }>("/api/v1/calls?limit=5")
      .then((r) => {
        setHistory((r.data ?? []).slice(0, 5));
        setHistoryTotal(r.meta?.total ?? r.data?.length ?? 0);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    api<{ success: true; data: Channel[] }>("/api/v1/channels").then((r) => {
      setChannels(r.data);
      const linked = r.data.find((c) => c.status === "CONNECTED") ?? r.data[0];
      if (linked) setChannelId(linked.id);
    });
    loadHistory();
    void Promise.all([
      api<{ success: true; data: { configs: DialerAgent[]; sarvamConfigured: boolean } }>("/api/v1/ai-configs"),
      api<{ success: true; data: DialerRecording[] }>("/api/v1/recordings"),
      api<{ success: true; data: { configured: boolean; envFallback?: boolean } }>("/api/v1/ai/sarvam"),
    ])
      .then(([ai, rec, key]) => {
        setAgents(ai.data.configs ?? []);
        setAiConfigId((id) => id || ai.data.configs?.[0]?.id || "");
        setRecordings(rec.data ?? []);
        setRecordingId((id) => id || rec.data?.[0]?.id || "");
        setSarvam(Boolean(key.data.configured || key.data.envFallback || ai.data.sarvamConfigured));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!callId) return;
    let stop = false;
    const poll = async () => {
      try {
        const r = await api<{
          success: true;
          data: { status: string; failureReason?: string | null; queuePosition?: number | null };
        }>(`/api/v1/calls/${callId}`);
        if (stop) return;
        setStatus(r.data.status === "QUEUED" && !r.data.queuePosition ? "CONNECTING" : r.data.status);
        if (r.data.queuePosition) setQueuePos(r.data.queuePosition);
        else if (r.data.status !== "QUEUED") setQueuePos(null);
        if (r.data.status === "ANSWERED") setStarted((s) => s ?? Date.now());
        if (["ENDED", "FAILED", "BUSY", "NO_ANSWER", "REJECTED", "CANCELLED"].includes(r.data.status)) {
          if (r.data.failureReason) setError(humanizeCallError(r.data.failureReason));
          resetLocalCall();
          setStatus("READY");
          loadHistory();
        }
      } catch {
        /* keep last status */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 1000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [callId]);

  const channel = channels.find((c) => c.id === channelId);
  const connected = channel?.status === "CONNECTED";
  const inCall = IN_CALL.includes(status);
  const elapsed = useMemo(() => {
    if (!started) return "00:00";
    const s = Math.floor((Date.now() - started) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, [started, tick]);

  useEffect(() => {
    if (!channelId || !connected) return;
    const national = number.replace(/\D/g, "");
    const phone = `${cc}${national}`;
    if (national.length < 10) {
      setAvatar(null);
      setWaName(null);
      setAvatarLoading(false);
      return;
    }
    let stop = false;
    setAvatarLoading(true);
    const timer = window.setTimeout(() => {
      api<{ success: true; data: { avatar: string | null; name?: string | null } }>(
        `/api/v1/channels/${channelId}/avatar?phone=${encodeURIComponent(phone)}`,
      )
        .then((r) => {
          if (stop) return;
          setAvatar(r.data.avatar);
          setWaName(r.data.name?.trim() || null);
        })
        .catch(() => {
          if (stop) return;
          setAvatar(null);
          setWaName(null);
        })
        .finally(() => {
          if (!stop) setAvatarLoading(false);
        });
    }, 400);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [channelId, cc, connected, number]);

  function press(digit: string) {
    if (inCall && !showPad) return;
    playDialTone(digit);
    if (digit === "0" && number === "") {
      setNumber("+");
      return;
    }
    setNumber((n) => (n + digit).replace(/[^\d+#*]/g, "").slice(0, 15));
  }

  async function uploadRecording(file: File) {
    setError("");
    setUploading(true);
    try {
      await assertUploadAudioDuration(file);
      const token = (await ensureAccessToken()) ?? "";
      const base = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${base}/api/v1/recordings`, {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: fd,
        credentials: "include",
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: DialerRecording;
        error?: { message?: string };
        message?: string;
      };
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? json.message ?? "Upload failed");
      setRecordings((rows) => [json.data as DialerRecording, ...rows]);
      setRecordingId(json.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function deleteRecording(id: string) {
    if (!id) return;
    const name = recordings.find((r) => r.id === id)?.name || "this audio";
    if (!confirm(`Delete “${name}”? This cannot be undone.`)) return;
    setError("");
    try {
      await api(`/api/v1/recordings/${id}`, { method: "DELETE" });
      setRecordings((rows) => {
        const next = rows.filter((r) => r.id !== id);
        setRecordingId((current) => (current === id ? next[0]?.id || "" : current));
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function call() {
    setError("");
    if (!connected) {
      setError("Connect WhatsApp first from the WhatsApp page.");
      return;
    }
    const phone = `${cc}${number}`.replace(/\D/g, "");
    if (phone.length < 8) {
      setError("Enter a valid number on the keypad.");
      return;
    }
    setStatus("CONNECTING");
    setQueuePos(null);
    setBusy(true);
    let micStream: MediaStream | undefined;
    try {
      if (mode === "live") {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
          });
          setMicReady(true);
        } catch {
          setMicReady(false);
          setError("Allow microphone access so your voice can go out on this call.");
        }
      }
      const res = await api<{ success: true; call_id: string; status?: string; queue_position: number }>(
        "/api/v1/calls",
        {
          method: "POST",
          body: JSON.stringify({
            channel_id: channelId,
            phone,
            contact_name: recipientName.trim() || waName || undefined,
            mode,
            ai_config_id: mode === "ai" ? aiConfigId || undefined : undefined,
            recording_id: mode === "recording" ? recordingId || undefined : undefined,
            tts_body: mode === "tts" ? ttsBody : undefined,
            tts_language: mode === "tts" ? ttsLanguage : undefined,
            tts_speaker: mode === "tts" ? ttsSpeaker : undefined,
          }),
        },
      );
      setCallId(res.call_id);
      setQueuePos(res.queue_position);
      setStatus(res.status && res.status !== "QUEUED" ? res.status : res.queue_position > 1 ? "QUEUED" : "CONNECTING");
      if (micStream) {
        try {
          audioRef.current?.stop();
          audioRef.current = await startCallAudio(res.call_id, micStream);
        } catch (audioErr) {
          setError(
            humanizeCallError(
              audioErr instanceof Error ? audioErr.message : "Could not start microphone audio for this call.",
            ),
          );
        }
      }
    } catch (err) {
      micStream?.getTracks().forEach((t) => t.stop());
      resetLocalCall();
      setError(humanizeCallError(err instanceof Error ? err.message : "Call failed"));
      setStatus("READY");
    } finally {
      setBusy(false);
    }
  }

  async function hangup() {
    const id = callId;
    resetLocalCall();
    setStatus("READY");
    if (!id) return;
    await api(`/api/v1/calls/${id}/hangup`, { method: "POST" }).catch((err) => {
      setError(err instanceof Error ? err.message : "Hangup failed");
    });
    loadHistory();
  }

  async function toggleMute() {
    if (!callId) return;
    const next = !muted;
    setMuted(next);
    audioRef.current?.setMuted(next);
    await api(`/api/v1/calls/${callId}/mute`, {
      method: "POST",
      body: JSON.stringify({ muted: next }),
    }).catch(() => undefined);
  }

  function toggleSpeaker() {
    const next = !speakerOn;
    setSpeakerOn(next);
    audioRef.current?.setSpeaker(next);
  }

  const display = formatPhone(cc, number);
  const shownName = recipientName.trim() || waName;
  const modeHint =
    mode === "ai"
      ? "AI agent on this call"
      : mode === "tts"
        ? "Playing your message"
        : mode === "recording"
          ? "Playing recording"
          : micReady
            ? "Mic live · voice from this browser"
            : "Waiting for microphone";

  return (
    <div className="mx-auto flex max-w-6xl flex-col">
      <div className="mb-4 text-center lg:text-left">
        <h1 className="text-xl font-semibold text-white">Dialer</h1>
        <p className="mt-1 text-xs text-slate-500">
          Pick a number, then choose AI agent, text-to-speech, uploaded audio, or talk yourself.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="mx-auto w-full max-w-[380px] lg:mx-0">
      <div className="relative w-full overflow-hidden rounded-[2.6rem] border border-white/10 bg-black shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-7 pt-3 text-[11px] text-white/70">
          <span className="tabular-nums">
            {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span className="mx-auto h-1.5 w-24 rounded-full bg-white/20" />
          <ConnectionBadge status={connected ? "CONNECTED" : channel?.status ?? "DISCONNECTED"} />
        </div>

        <div className="min-h-[720px] bg-gradient-to-b from-[#1c1c1e] via-[#111114] to-black px-5 pb-8 pt-14">
          {!inCall ? (
            <>
              <label className="block text-left text-[11px] uppercase tracking-[0.2em] text-slate-500">Call from</label>
              <select
                className="mt-1 border-white/5 bg-white/5"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName} {c.phoneNumber ? `· ${c.phoneNumber}` : ""} · {c.status}
                  </option>
                ))}
              </select>
              {!connected ? (
                <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-200">
                  This line is not linked.{" "}
                  <Link href="/channels" className="font-medium text-emerald-400 underline">
                    Scan QR
                  </Link>
                </p>
              ) : null}

              <div className="mt-8 flex min-h-[5.5rem] flex-col items-center text-center">
                {number.replace(/\D/g, "").length >= 10 ? (
                  <>
                    {avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatar}
                        alt=""
                        className="mb-3 h-20 w-20 rounded-full object-cover ring-2 ring-white/15"
                      />
                    ) : (
                      <div
                        className={`mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-white/10 ring-2 ring-white/10 ${
                          avatarLoading ? "animate-pulse" : ""
                        }`}
                      >
                        <User className="h-8 w-8 text-white/40" />
                      </div>
                    )}
                    {shownName ? <p className="mb-1 text-sm font-medium text-white">{shownName}</p> : null}
                  </>
                ) : null}
                <div className="break-all text-[2rem] font-light tracking-[0.04em] text-white">{display || " "}</div>
                <input
                  className="mx-auto mt-3 w-20 border-0 bg-transparent text-center text-xs text-slate-500"
                  value={cc}
                  onChange={(e) => setCc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  aria-label="Country code"
                />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 px-2">
                {KEYS.map(([digit, letters]) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => press(digit)}
                    className="flex h-[4.4rem] flex-col items-center justify-center rounded-full bg-white/10 text-white transition active:bg-white/20"
                  >
                    <span className="text-[1.7rem] font-medium leading-none">{digit}</span>
                    {letters ? (
                      <span className="mt-1 text-[9px] tracking-[0.28em] text-slate-400">{letters}</span>
                    ) : null}
                  </button>
                ))}
              </div>

              <input
                className="mt-5 border-white/5 bg-white/5"
                placeholder="Recipient name (optional)"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
              />

              <div className="mt-6 flex items-center justify-center gap-10">
                <span className="h-14 w-14" />
                <button
                  onClick={call}
                  disabled={!connected || busy}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30"
                  aria-label="Call"
                >
                  <Phone className="h-7 w-7" />
                </button>
                <button
                  type="button"
                  onClick={() => setNumber((n) => n.slice(0, -1))}
                  disabled={!number}
                  className="flex h-14 w-14 items-center justify-center rounded-full text-white/80"
                  aria-label="Backspace"
                >
                  <Delete className="h-6 w-6" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col items-center pt-6 text-center">
                <div className="relative">
                  <div
                    className={`absolute -inset-2 rounded-full ${
                      status === "ANSWERED" ? "animate-pulse bg-emerald-400/20" : "bg-white/5"
                    }`}
                  />
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatar}
                      alt=""
                      className="relative h-32 w-32 rounded-full object-cover ring-4 ring-white/10"
                    />
                  ) : (
                    <div className="relative flex h-32 w-32 items-center justify-center rounded-full bg-white/10 ring-4 ring-white/10">
                      <User className="h-14 w-14 text-white/50" />
                    </div>
                  )}
                </div>
                <div className="mt-6 text-xl font-medium tracking-wide text-white">{shownName || display}</div>
                {shownName ? <div className="mt-1 text-sm text-slate-400">{display}</div> : null}
                <div className="mt-2 text-sm text-emerald-300">{statusLabel(status)}</div>
                <div className="mt-1 text-3xl font-light tabular-nums text-white/90">
                  {status === "ANSWERED" ? elapsed : "00:00"}
                </div>
                {queuePos && queuePos > 1 ? (
                  <p className="mt-2 text-xs text-amber-300">Queue #{queuePos}</p>
                ) : null}
                <p className="mt-3 text-[11px] text-slate-500">{modeHint}</p>
              </div>

              {showPad ? (
                <div className="mt-6 grid grid-cols-3 gap-3 px-4">
                  {KEYS.map(([digit, letters]) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => press(digit)}
                      className="flex h-14 flex-col items-center justify-center rounded-full bg-white/10 text-white"
                    >
                      <span className="text-xl font-medium">{digit}</span>
                      {letters ? <span className="text-[8px] tracking-[0.2em] text-slate-400">{letters}</span> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-14 grid grid-cols-3 gap-8 px-6 text-center text-xs text-slate-400">
                  {mode === "live" ? (
                    <button type="button" onClick={toggleMute} className="flex flex-col items-center gap-2">
                      <span
                        className={`flex h-14 w-14 items-center justify-center rounded-full ${
                          muted ? "bg-white text-black" : "bg-white/10 text-white"
                        }`}
                      >
                        {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
                      </span>
                      Mute
                    </button>
                  ) : (
                    <span className="h-14 w-14" />
                  )}
                  <button type="button" onClick={() => setShowPad(true)} className="flex flex-col items-center gap-2">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white">
                      <Grid3X3 className="h-6 w-6" />
                    </span>
                    Keypad
                  </button>
                  <button type="button" onClick={toggleSpeaker} className="flex flex-col items-center gap-2">
                    <span
                      className={`flex h-14 w-14 items-center justify-center rounded-full ${
                        speakerOn ? "bg-white text-black" : "bg-white/10 text-white"
                      }`}
                    >
                      {speakerOn ? <Volume2 className="h-6 w-6" /> : <VolumeX className="h-6 w-6" />}
                    </span>
                    Speaker
                  </button>
                </div>
              )}

              <div className="mt-10 flex items-center justify-center gap-10">
                {showPad ? (
                  <button
                    type="button"
                    onClick={() => setShowPad(false)}
                    className="text-sm text-slate-400"
                  >
                    Hide
                  </button>
                ) : (
                  <span className="w-10" />
                )}
                <button
                  onClick={hangup}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg shadow-rose-500/40"
                  aria-label="Hang up"
                >
                  <PhoneOff className="h-7 w-7" />
                </button>
                <span className="w-10" />
              </div>
            </>
          )}

          {error ? <p className="mt-5 text-center text-sm text-rose-400">{error}</p> : null}
        </div>
      </div>
      </div>

      <DialerModePanel
        mode={mode}
        onMode={setMode}
        agents={agents}
        recordings={recordings}
        languages={LANGUAGES}
        speakers={SPEAKERS}
        sarvam={sarvam}
        aiConfigId={aiConfigId}
        onAiConfigId={setAiConfigId}
        recordingId={recordingId}
        onRecordingId={setRecordingId}
        ttsBody={ttsBody}
        onTtsBody={setTtsBody}
        ttsLanguage={ttsLanguage}
        onTtsLanguage={setTtsLanguage}
        ttsSpeaker={ttsSpeaker}
        onTtsSpeaker={setTtsSpeaker}
        onUpload={(file) => void uploadRecording(file)}
        onDeleteRecording={(id) => void deleteRecording(id)}
        uploading={uploading}
        disabled={!connected}
        inCall={inCall}
        busy={busy}
        onCall={() => void call()}
      />
      </div>

      <div className="mt-8 w-full">
        <h2 className="mb-3 text-sm font-medium text-white">Recent calls</h2>
        <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-ink-900/70">
          {history.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate text-white">{row.contactName || row.phone}</p>
                <p className="text-[11px] text-slate-500">
                  {new Date(row.createdAt).toLocaleString()} · {row.source || "dialer"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-slate-300">{callResultLabel(row)}</p>
                <p className="text-[11px] text-slate-500">{formatCallDuration(row.durationMs)}</p>
              </div>
            </li>
          ))}
          {history.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-slate-500">No calls yet. Dial a number to start the log.</li>
          ) : null}
        </ul>
        <Link
            href="/history"
            className="mt-3 flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-brand-400 hover:bg-white/10"
          >
            Read more{historyTotal > 5 ? ` · ${historyTotal} calls` : ""}
          </Link>
      </div>
    </div>
  );
}
