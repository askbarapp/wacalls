"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Delete, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { api, wsUrl } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";

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

const IN_CALL = ["CONNECTING", "RINGING", "ANSWERED", "QUEUED"];

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

  useEffect(() => {
    api<{ success: true; data: Channel[] }>("/api/v1/channels").then((r) => {
      setChannels(r.data);
      const linked = r.data.find((c) => c.status === "CONNECTED") ?? r.data[0];
      if (linked) setChannelId(linked.id);
    });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("wacalls_token");
    if (!token) return;
    const ws = new WebSocket(wsUrl(token));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.callId && callId && msg.callId !== callId && msg.type !== "hello") return;
      if (msg.type === "ringing") setStatus("RINGING");
      if (msg.type === "answered") {
        setStatus("ANSWERED");
        setStarted(Date.now());
      }
      if (["ended", "failed", "busy", "no_answer", "rejected"].includes(msg.type)) {
        setStatus(String(msg.type).toUpperCase());
        setCallId(null);
        setStarted(null);
        setMuted(false);
      }
    };
    return () => ws.close();
  }, [callId]);

  const channel = channels.find((c) => c.id === channelId);
  const connected = channel?.status === "CONNECTED";
  const inCall = IN_CALL.includes(status);
  const elapsed = useMemo(() => {
    if (!started) return "00:00";
    const s = Math.floor((Date.now() - started) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, [started, tick]);

  function press(digit: string) {
    if (inCall) return;
    if (digit === "0" && number === "") {
      setNumber("+");
      return;
    }
    setNumber((n) => (n + digit).replace(/[^\d+#*]/g, "").slice(0, 15));
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
    try {
      const res = await api<{ success: true; call_id: string; queue_position: number }>("/api/v1/calls", {
        method: "POST",
        body: JSON.stringify({ channel_id: channelId, phone }),
      });
      setCallId(res.call_id);
      setQueuePos(res.queue_position);
      setStatus(res.queue_position > 1 ? "QUEUED" : "CONNECTING");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Call failed");
      setStatus("FAILED");
    }
  }

  async function hangup() {
    if (!callId) return;
    await api(`/api/v1/calls/${callId}/hangup`, { method: "POST" });
  }

  async function toggleMute() {
    if (!callId) return;
    const next = !muted;
    try {
      await api(`/api/v1/calls/${callId}/mute`, {
        method: "POST",
        body: JSON.stringify({ muted: next }),
      });
      setMuted(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mute is not available on this engine");
    }
  }

  return (
    <div>
      <PageHeader
        title="Dialer"
        subtitle="Pick a linked WhatsApp line, enter the number on the pad, then call. One live call per number."
      />
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="mx-auto w-full max-w-sm">
          <div className="rounded-[2rem] border border-white/10 bg-gradient-to-b from-ink-800 to-ink-950 p-6 shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.25em] text-slate-500">
              <span>WaCalls</span>
              <StatusBadge status={inCall ? status : connected ? "CONNECTED" : channel?.status ?? "OFFLINE"} />
            </div>
            <label className="mt-5 block text-left text-xs text-slate-500">Line</label>
            <select
              className="mt-1"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              disabled={inCall}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName} {c.phoneNumber ? `· ${c.phoneNumber}` : ""} · {c.status}
                </option>
              ))}
            </select>
            {!connected ? (
              <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-200">
                This line is not linked.{" "}
                <Link href="/channels" className="font-medium text-brand-400 underline">
                  Scan QR
                </Link>
              </p>
            ) : null}
            <div className="mt-6 min-h-[4.5rem] text-center">
              <div className="text-xs text-slate-500">+{cc}</div>
              <div className="mt-1 break-all text-3xl font-light tracking-[0.12em] text-white">
                {number || "Enter number"}
              </div>
              <div className="mt-3 text-4xl font-light tabular-nums text-slate-200">{elapsed}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.2em] text-brand-400">{status}</div>
              {queuePos && queuePos > 1 ? (
                <p className="mt-2 text-sm text-amber-300">Queue position #{queuePos}</p>
              ) : null}
            </div>
            <div className="mt-6 grid grid-cols-3 gap-2">
              {KEYS.map(([digit, letters]) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => press(digit)}
                  disabled={inCall}
                  className="flex h-16 flex-col items-center justify-center rounded-2xl bg-white/5 text-white transition hover:bg-white/10 active:scale-95 disabled:opacity-40"
                >
                  <span className="text-2xl font-medium leading-none">{digit}</span>
                  {letters ? <span className="mt-1 text-[9px] tracking-[0.2em] text-slate-500">{letters}</span> : null}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-center gap-4">
              <input
                className="w-16 text-center"
                value={cc}
                onChange={(e) => setCc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                disabled={inCall}
                aria-label="Country code"
              />
              <button
                type="button"
                onClick={() => setNumber((n) => n.slice(0, -1))}
                disabled={inCall || !number}
                className="rounded-full bg-white/10 p-3 hover:bg-white/15"
                aria-label="Backspace"
              >
                <Delete className="h-5 w-5" />
              </button>
            </div>
            {error ? <p className="mt-4 text-sm text-rose-400">{error}</p> : null}
            <div className="mt-6 flex justify-center gap-4">
              {!inCall ? (
                <button
                  onClick={call}
                  disabled={!connected}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-500 text-ink-950 shadow-lg shadow-brand-500/30 hover:bg-brand-400"
                  aria-label="Call"
                >
                  <Phone className="h-7 w-7" />
                </button>
              ) : (
                <>
                  <button
                    onClick={toggleMute}
                    className={`rounded-full p-4 ${muted ? "bg-amber-500 text-ink-950" : "bg-white/10"}`}
                    aria-label={muted ? "Unmute" : "Mute"}
                  >
                    {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </button>
                  <button
                    onClick={hangup}
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg shadow-rose-500/30"
                    aria-label="Hang up"
                  >
                    <PhoneOff className="h-7 w-7" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        <aside className="space-y-4 text-sm">
          <div className="rounded-2xl border border-white/10 bg-ink-900/70 p-5">
            <div className="font-medium text-white">How calling works</div>
            <ol className="mt-3 list-decimal space-y-2 pl-4 text-slate-400">
              <li>Link WhatsApp with the QR on the WhatsApp page</li>
              <li>Select that line above</li>
              <li>Dial the country code + number</li>
              <li>Only one live call per WhatsApp number</li>
            </ol>
          </div>
          <div className="rounded-2xl border border-white/10 bg-ink-900/70 p-5 text-slate-400">
            Outbound voice uses the experimental WhatsApp Web calling stack. If the WASM adapter is not loaded, the
            call ends as FAILED with UNSUPPORTED_CAPABILITY — that is honest, not a fake ring.
          </div>
        </aside>
      </div>
    </div>
  );
}
