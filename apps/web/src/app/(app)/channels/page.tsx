"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, QrCode, Smartphone, Unplug } from "lucide-react";
import { api, wsUrl } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";

type Channel = {
  id: string;
  displayName: string;
  phoneNumber?: string | null;
  status: string;
  lastError?: string | null;
};

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [name, setName] = useState("Office line");
  const [qr, setQr] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const r = await api<{ success: true; data: Channel[] }>("/api/v1/channels");
    setChannels(r.data);
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const fetchQr = useCallback(
    async (id: string) => {
      try {
        const r = await api<{
          success: true;
          data: { qr: string | null; status: string; lastError?: string | null };
        }>(`/api/v1/channels/${id}/qr`);
        if (r.data.qr) {
          setQr(r.data.qr);
          setBusy(false);
          setError("");
          setHint("Scan with WhatsApp → Linked devices → Link a device");
        }
        if (r.data.lastError) setError(r.data.lastError);
        if (r.data.status === "CONNECTED") {
          setQr(null);
          setBusy(false);
          setHint("WhatsApp linked. Open the dialer to place a call.");
          stopPoll();
          await load();
        }
        if (r.data.status === "ERROR") {
          setBusy(false);
          stopPoll();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load QR");
        setBusy(false);
      }
    },
    [stopPoll],
  );

  useEffect(() => {
    const token = localStorage.getItem("wacalls_token");
    if (!token) return;
    const ws = new WebSocket(wsUrl(token));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as {
        type?: string;
        channelId?: string;
        qrDataUrl?: string;
        status?: string;
        reason?: string;
      };
      if (!msg.channelId || (active && msg.channelId !== active)) return;
      if (msg.type === "qr" && msg.qrDataUrl) {
        setQr(msg.qrDataUrl);
        setBusy(false);
        setError("");
        setHint("Scan with WhatsApp → Linked devices → Link a device");
      }
      if (msg.type === "channel_status") {
        if (msg.status === "CONNECTED") {
          setQr(null);
          setBusy(false);
          setHint("WhatsApp linked.");
          stopPoll();
          void load();
        }
        if (msg.status === "ERROR") {
          setBusy(false);
          setError(msg.reason ?? "WhatsApp engine failed to start pairing");
          stopPoll();
        }
      }
    };
    return () => ws.close();
  }, [active, stopPoll]);

  async function create() {
    setError("");
    try {
      await api("/api/v1/channels", { method: "POST", body: JSON.stringify({ displayName: name }) });
      setName("Office line");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create channel");
    }
  }

  async function connect(id: string) {
    stopPoll();
    setActive(id);
    setQr(null);
    setError("");
    setHint("Starting WhatsApp pairing…");
    setBusy(true);
    try {
      await api(`/api/v1/channels/${id}/connect`, {
        method: "POST",
        body: JSON.stringify({ forceQr: true }),
      });
      await fetchQr(id);
      pollRef.current = setInterval(() => void fetchQr(id), 800);
      window.setTimeout(() => {
        setBusy((isBusy) => {
          if (isBusy) {
            setHint("Still waiting for QR. If this stays empty, the WhatsApp container may be missing Baileys — check logs.");
          }
          return isBusy;
        });
      }, 20_000);
    } catch (err) {
      setBusy(false);
      setHint("");
      setError(err instanceof Error ? err.message : "Connect failed");
    }
  }

  async function disconnect(id: string) {
    stopPoll();
    setQr(null);
    setBusy(false);
    try {
      await api(`/api/v1/channels/${id}/disconnect`, { method: "POST" });
      if (active === id) {
        setActive(null);
        setHint("");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="WhatsApp Channels"
        subtitle="Create a line, then scan the QR from WhatsApp → Linked devices. Voice calling needs a linked session."
      />
      <div className="mb-6 flex flex-col gap-2 sm:flex-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name"
          className="sm:max-w-xs"
        />
        <button onClick={create} className="rounded-lg bg-brand-500 px-5 py-2 font-medium text-ink-950 hover:bg-brand-400">
          Create channel
        </button>
      </div>
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {channels.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-ink-900/40 p-10 text-center text-slate-400">
          No lines yet. Create a channel, then click QR / Reconnect.
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {channels.map((ch) => (
            <div key={ch.id} className="overflow-hidden rounded-2xl border border-white/10 bg-ink-900/80 shadow-xl shadow-black/20">
              <div className="flex items-start justify-between gap-3 p-5">
                <div>
                  <div className="text-lg font-medium text-white">{ch.displayName}</div>
                  <div className="mt-1 text-sm text-slate-400">{ch.phoneNumber ?? "Not linked"}</div>
                </div>
                <StatusBadge status={ch.status} />
              </div>
              <div className="flex flex-wrap gap-2 px-5 pb-4">
                <Link
                  href="/dialer"
                  className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
                >
                  Open Dialer
                </Link>
                <button
                  onClick={() => connect(ch.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500/20 px-3 py-2 text-sm font-medium text-brand-400 hover:bg-brand-500/30"
                >
                  <QrCode className="h-4 w-4" />
                  QR / Reconnect
                </button>
                <button
                  onClick={() => disconnect(ch.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
                >
                  <Unplug className="h-4 w-4" />
                  Disconnect
                </button>
              </div>
              {active === ch.id ? (
                <div className="border-t border-white/10 bg-black/20 p-5">
                  {qr ? (
                    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                      <div className="rounded-xl bg-white p-3 shadow-lg">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={qr} alt="WhatsApp QR" className="h-56 w-56" />
                      </div>
                      <div className="text-sm text-slate-300">
                        <div className="mb-2 flex items-center gap-2 font-medium text-white">
                          <Smartphone className="h-4 w-4 text-brand-400" />
                          Scan to link
                        </div>
                        <ol className="list-decimal space-y-1 pl-4 text-slate-400">
                          <li>Open WhatsApp on your phone</li>
                          <li>Settings → Linked devices</li>
                          <li>Tap Link a device</li>
                          <li>Scan this QR code</li>
                        </ol>
                        {hint ? <p className="mt-3 text-brand-400">{hint}</p> : null}
                      </div>
                    </div>
                  ) : busy ? (
                    <div className="flex items-center gap-3 text-sm text-slate-300">
                      <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
                      Generating QR code… keep this page open.
                    </div>
                  ) : hint ? (
                    <p className="text-sm text-brand-400">{hint}</p>
                  ) : null}
                  {ch.lastError && active === ch.id ? (
                    <p className="mt-3 text-xs text-rose-300">{ch.lastError}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
