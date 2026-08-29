"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Channel = {
  id: string;
  displayName: string;
  phoneNumber?: string | null;
  status: string;
};

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [name, setName] = useState("Office line");
  const [qr, setQr] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  async function load() {
    const r = await api<{ success: true; data: Channel[] }>("/api/v1/channels");
    setChannels(r.data);
  }
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, []);

  async function create() {
    await api("/api/v1/channels", { method: "POST", body: JSON.stringify({ displayName: name }) });
    setName("Office line");
    await load();
  }

  async function connect(id: string) {
    setActive(id);
    setQr(null);
    await api(`/api/v1/channels/${id}/connect`, { method: "POST" });
    const poll = setInterval(async () => {
      const r = await api<{ success: true; data: { qr: string | null; status: string } }>(
        `/api/v1/channels/${id}/qr`,
      );
      if (r.data.qr) setQr(r.data.qr);
      if (r.data.status === "CONNECTED") {
        setQr(null);
        clearInterval(poll);
        await load();
      }
    }, 1500);
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">WhatsApp Channels</h1>
      <div className="mb-6 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
        <button onClick={create} className="rounded-lg bg-brand-500 px-4 text-ink-950">
          Create
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {channels.map((ch) => (
          <div key={ch.id} className="rounded-xl border border-white/10 bg-ink-900 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{ch.displayName}</div>
                <div className="text-sm text-slate-400">{ch.phoneNumber ?? "Not linked"}</div>
              </div>
              <div className="text-sm">
                {ch.status === "CONNECTED" ? "🟢 Connected" : ch.status}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <a href="/dialer" className="rounded-lg bg-white/10 px-3 py-1.5">
                Open Dialer
              </a>
              <button onClick={() => connect(ch.id)} className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-brand-400">
                QR / Reconnect
              </button>
              <button
                onClick={() => api(`/api/v1/channels/${ch.id}/disconnect`, { method: "POST" }).then(load)}
                className="rounded-lg bg-white/10 px-3 py-1.5"
              >
                Disconnect
              </button>
            </div>
            {active === ch.id && qr ? (
              <div className="mt-4 rounded-lg bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="Scan with WhatsApp Linked Devices" className="mx-auto h-56 w-56" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
