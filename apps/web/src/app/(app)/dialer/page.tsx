"use client";

import { useEffect, useMemo, useState } from "react";
import { MicOff, PhoneOff } from "lucide-react";
import { api, wsUrl } from "@/lib/api";

type Channel = {
  id: string;
  displayName: string;
  phoneNumber?: string | null;
  status: string;
};

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

  useEffect(() => {
    api<{ success: true; data: Channel[] }>("/api/v1/channels").then((r) => {
      setChannels(r.data);
      if (r.data[0]) setChannelId(r.data[0].id);
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
      }
    };
    return () => ws.close();
  }, [callId]);

  const channel = channels.find((c) => c.id === channelId);
  const elapsed = useMemo(() => {
    if (!started) return "00:00";
    const s = Math.floor((Date.now() - started) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, [started, tick]);

  async function call() {
    setError("");
    const phone = `${cc}${number}`.replace(/\D/g, "");
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

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-3xl border border-white/10 bg-ink-900 p-8 text-center shadow-2xl">
        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">WA CALLS</div>
        <div className="mt-4 text-sm text-slate-300">
          WhatsApp: {channel?.status === "CONNECTED" ? "🟢" : "⚪"} {channel?.phoneNumber ?? channel?.displayName}
        </div>
        <label className="mt-8 block text-left text-sm text-slate-400">Phone Number</label>
        <div className="mt-2 flex gap-2">
          <input className="w-20" value={cc} onChange={(e) => setCc(e.target.value)} />
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="9876543210" />
        </div>
        <div className="mt-8 text-4xl font-light tabular-nums">{elapsed}</div>
        <div className="mt-2 text-sm uppercase tracking-widest text-brand-400">{status}</div>
        {queuePos && queuePos > 1 ? (
          <p className="mt-2 text-sm text-amber-300">Waiting in queue. Position #{queuePos}</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}
        <div className="mt-8 flex justify-center gap-3">
          {status === "READY" || ["ENDED", "FAILED", "BUSY", "NO_ANSWER", "REJECTED"].includes(status) ? (
            <button
              onClick={call}
              className="rounded-full bg-brand-500 px-10 py-3 font-semibold text-ink-950 hover:bg-brand-400"
            >
              CALL
            </button>
          ) : (
            <>
              <button className="rounded-full bg-white/10 p-4">
                <MicOff className="h-5 w-5" />
              </button>
              <button onClick={hangup} className="rounded-full bg-rose-500 p-4 text-white">
                <PhoneOff className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
