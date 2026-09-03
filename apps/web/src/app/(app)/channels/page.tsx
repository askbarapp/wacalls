"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Hash, Loader2, QrCode, Smartphone, Trash2, Unplug } from "lucide-react";
import { api, wsUrl } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { ConnectionBadge } from "@/components/status-badge";

type Channel = {
  id: string;
  displayName: string;
  phoneNumber?: string | null;
  status: string;
  lastError?: string | null;
  provider?: string;
};

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [name, setName] = useState("Office line");
  const [provider, setProvider] = useState<"WEB" | "CLOUD">("WEB");
  const [cloudPhoneNumberId, setCloudPhoneNumberId] = useState("");
  const [cloudAccessToken, setCloudAccessToken] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState<"qr" | "code">("qr");
  const [pairPhone, setPairPhone] = useState("");
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
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
          data: { qr: string | null; code?: string | null; pairingCode?: string | null; status: string; lastError?: string | null };
        }>(`/api/v1/channels/${id}/qr`);
        if (r.data.pairingCode) {
          setPairCode(r.data.pairingCode);
          setLinkMode("code");
          setBusy(false);
          setHint("Enter this code on your phone: Linked devices → Link with phone number.");
        }
        if (r.data.code || r.data.qr) {
          setQrCode(r.data.code ?? null);
          setQr(r.data.qr);
          setBusy(false);
          setError("");
          setHint("Scan with WhatsApp → Linked devices → Link a device");
        }
        if (r.data.lastError) setError(r.data.lastError);
        if (r.data.status === "CONNECTED") {
          setQr(null);
          setQrCode(null);
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
        qrCode?: string;
        code?: string;
        status?: string;
        reason?: string;
      };
      if (!msg.channelId || (active && msg.channelId !== active)) return;
      if (msg.type === "pair_code" && msg.code) {
        setPairCode(msg.code);
        setLinkMode("code");
        setBusy(false);
        setError("");
        setHint("Enter this code on your phone: Linked devices → Link with phone number.");
      }
      if (msg.type === "qr" && (msg.qrCode || msg.qrDataUrl)) {
        setQrCode(msg.qrCode ?? null);
        setQr(msg.qrDataUrl ?? null);
        setBusy(false);
        setError("");
        setHint("Scan with WhatsApp → Linked devices → Link a device");
      }
      if (msg.type === "channel_status") {
        if (msg.status === "CONNECTED") {
          setQr(null);
          setQrCode(null);
          setPairCode(null);
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
      await api("/api/v1/channels", {
        method: "POST",
        body: JSON.stringify({
          displayName: name,
          provider,
          cloudPhoneNumberId: provider === "CLOUD" ? cloudPhoneNumberId : undefined,
          cloudAccessToken: provider === "CLOUD" ? cloudAccessToken : undefined,
        }),
      });
      setName("Office line");
      setCloudPhoneNumberId("");
      setCloudAccessToken("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create channel");
    }
  }

  async function connect(id: string, forceQr = false) {
    stopPoll();
    setActive(id);
    setLinkMode("qr");
    setQr(null);
    setQrCode(null);
    setPairCode(null);
    setError("");
    setHint(forceQr ? "Starting WhatsApp QR pairing…" : "Reconnecting saved WhatsApp session…");
    setBusy(true);
    try {
      await api(`/api/v1/channels/${id}/connect`, {
        method: "POST",
        body: JSON.stringify({ forceQr }),
      });
      await fetchQr(id);
      pollRef.current = setInterval(() => void fetchQr(id), 800);
      window.setTimeout(() => {
        setBusy((isBusy) => {
          if (isBusy) {
            setHint("Still waiting for QR. Keep this page open, then tap New QR if it stays empty.");
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

  function openPairPanel(id: string, phoneHint?: string | null) {
    stopPoll();
    setActive(id);
    setLinkMode("code");
    setQr(null);
    setQrCode(null);
    setPairCode(null);
    setPairPhone((phoneHint ?? "").replace(/\D/g, ""));
    setBusy(false);
    setError("");
    setHint("Enter the WhatsApp number with country code, then get a pairing code.");
  }

  async function requestPair(id: string) {
    stopPoll();
    setError("");
    setPairCode(null);
    setBusy(true);
    setHint("Requesting pairing code…");
    try {
      const res = await api<{ success: true; data: { code?: string } }>(`/api/v1/channels/${id}/pair`, {
        method: "POST",
        body: JSON.stringify({ phone: pairPhone }),
      });
      if (res.data.code) setPairCode(res.data.code);
      setHint("Enter this code on your phone: Linked devices → Link with phone number.");
      setBusy(false);
      pollRef.current = setInterval(() => void fetchQr(id), 1500);
    } catch (err) {
      setBusy(false);
      setHint("");
      setError(err instanceof Error ? err.message : "Could not get pairing code");
    }
  }

  async function disconnect(id: string) {
    stopPoll();
    setQr(null);
    setQrCode(null);
    setPairCode(null);
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

  async function remove(id: string) {
    if (!window.confirm("Delete this WhatsApp line? Its calls and messages will also be removed.")) {
      return;
    }
    setError("");
    setDeleting(id);
    try {
      await api(`/api/v1/channels/${id}`, { method: "DELETE" });
      if (active === id) {
        stopPoll();
        setActive(null);
        setQr(null);
        setHint("");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete channel");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="WhatsApp Channels"
        subtitle="Connect as many WhatsApp numbers as your plan allows. Campaigns can rotate across them for calling and bulk messaging."
      />
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name"
          className="sm:max-w-xs"
        />
        <select value={provider} onChange={(e) => setProvider(e.target.value as "WEB" | "CLOUD")} className="sm:max-w-xs">
          <option value="WEB">WhatsApp Web (QR or pairing code + calling)</option>
          <option value="CLOUD">Meta Cloud API (text only)</option>
        </select>
        {provider === "CLOUD" ? (
          <>
            <input
              value={cloudPhoneNumberId}
              onChange={(e) => setCloudPhoneNumberId(e.target.value)}
              placeholder="Phone number ID"
              className="sm:max-w-xs"
            />
            <input
              value={cloudAccessToken}
              onChange={(e) => setCloudAccessToken(e.target.value)}
              placeholder="Access token"
              type="password"
              className="sm:max-w-xs"
            />
          </>
        ) : null}
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
          No lines yet. Create a channel, then click Reconnect.
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {channels.map((ch) => (
            <div key={ch.id} className="overflow-hidden rounded-2xl border border-white/10 bg-ink-900/80 shadow-xl shadow-black/20">
              <div className="flex items-start justify-between gap-3 p-5">
                <div>
                  <div className="text-lg font-medium text-white">{ch.displayName}</div>
                  <div className="mt-1 text-sm text-slate-400">
                    {ch.provider === "CLOUD" ? "Cloud API" : "WhatsApp Web"} · {ch.phoneNumber ?? "Not linked"}
                  </div>
                </div>
                <ConnectionBadge status={ch.status} />
              </div>
              <div className="flex flex-wrap gap-2 px-5 pb-4">
                {ch.provider === "CLOUD" ? (
                  <span className="rounded-lg bg-white/10 px-3 py-2 text-sm text-slate-400">Text messaging only</span>
                ) : (
                  <>
                    <Link
                      href="/dialer"
                      className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
                    >
                      Open Dialer
                    </Link>
                    <button
                      onClick={() => connect(ch.id, false)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500/20 px-3 py-2 text-sm font-medium text-brand-400 hover:bg-brand-500/30"
                    >
                      <QrCode className="h-4 w-4" />
                      Reconnect
                    </button>
                    <button
                      onClick={() => connect(ch.id, true)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
                    >
                      New QR
                    </button>
                    <button
                      onClick={() => openPairPanel(ch.id, ch.phoneNumber)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/20 px-3 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/30"
                    >
                      <Hash className="h-4 w-4" />
                      Pairing code
                    </button>
                    <button
                      onClick={() => disconnect(ch.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
                    >
                      <Unplug className="h-4 w-4" />
                      Disconnect
                    </button>
                  </>
                )}
                <Link href="/messages" className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15">
                  Messages
                </Link>
                <button
                  onClick={() => remove(ch.id)}
                  disabled={deleting === ch.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting === ch.id ? "Deleting…" : "Delete"}
                </button>
              </div>
              {active === ch.id ? (
                <div className="border-t border-white/10 bg-black/20 p-5">
                  <div className="mb-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setLinkMode("qr");
                        if (!qr && !qrCode) void connect(ch.id, true);
                      }}
                      className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium ${
                        linkMode === "qr" ? "bg-brand-500 text-ink-950" : "bg-white/10 text-slate-200"
                      }`}
                    >
                      <QrCode className="h-4 w-4" />
                      Scan QR
                    </button>
                    <button
                      type="button"
                      onClick={() => openPairPanel(ch.id, ch.phoneNumber)}
                      className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium ${
                        linkMode === "code" ? "bg-violet-500 text-white" : "bg-white/10 text-slate-200"
                      }`}
                    >
                      <Hash className="h-4 w-4" />
                      Pairing code
                    </button>
                  </div>
                  {linkMode === "code" ? (
                    <div className="space-y-4">
                      <label className="block text-sm">
                        Phone number
                        <input
                          className="mt-1.5"
                          value={pairPhone}
                          onChange={(e) => setPairPhone(e.target.value)}
                          placeholder="e.g. 919812345678"
                        />
                        <span className="mt-1 block text-xs font-normal text-slate-400">
                          Include country code, no + or spaces.
                        </span>
                      </label>
                      <button
                        type="button"
                        disabled={busy || pairPhone.replace(/\D/g, "").length < 8}
                        onClick={() => void requestPair(ch.id)}
                        className="min-h-11 rounded-xl bg-brand-500 px-4 text-sm font-medium text-ink-950"
                      >
                        {busy ? "Getting code…" : "Get pairing code"}
                      </button>
                      {pairCode ? (
                        <div className="rounded-2xl border border-violet-400/30 bg-violet-500/10 p-5 text-center">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-200">
                            Enter on your phone
                          </div>
                          <div className="mt-3 font-mono text-4xl font-semibold tracking-[0.2em] text-white">
                            {pairCode}
                          </div>
                          <button
                            type="button"
                            className="mt-4 inline-flex items-center gap-1.5 text-sm text-violet-200 hover:text-white"
                            onClick={() => void navigator.clipboard.writeText(pairCode.replace("-", ""))}
                          >
                            <Copy className="h-4 w-4" /> Copy
                          </button>
                          <ol className="mt-4 list-decimal space-y-1 pl-5 text-left text-sm text-slate-300">
                            <li>Open WhatsApp → Settings → Linked devices</li>
                            <li>Tap Link a device</li>
                            <li>Choose Link with phone number instead</li>
                            <li>Type this 8-character code</li>
                          </ol>
                        </div>
                      ) : null}
                      {hint && !pairCode ? <p className="text-sm text-violet-200">{hint}</p> : null}
                    </div>
                  ) : qrCode || qr ? (
                    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                      <div className="rounded-2xl bg-white p-4 shadow-lg">
                        {qrCode ? (
                          <QRCodeSVG
                            value={qrCode}
                            size={256}
                            level="L"
                            marginSize={4}
                            bgColor="#ffffff"
                            fgColor="#000000"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={qr ?? ""}
                            alt="WhatsApp QR"
                            className="h-64 w-64 bg-white"
                            style={{ imageRendering: "pixelated" }}
                          />
                        )}
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
                      Connecting… keep this page open.
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
