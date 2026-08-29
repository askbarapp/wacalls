"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";

export default function SettingsPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <div className="max-w-xl">
      <PageHeader title="Settings" subtitle="Account security. Engine, SMTP, and session storage stay on the server." />
      <section className="rounded-xl border border-white/10 bg-ink-900 p-5">
        <h2 className="mb-4 font-medium">Change password</h2>
        <input className="mb-2" type="password" placeholder="Current" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input className="mb-4" type="password" placeholder="New (min 10)" value={next} onChange={(e) => setNext(e.target.value)} />
        <button
          className="rounded-lg bg-brand-500 px-4 py-2 text-ink-950"
          onClick={async () => {
            await api("/api/v1/auth/change-password", {
              method: "POST",
              body: JSON.stringify({ current, next }),
            });
            setMsg("Password changed");
          }}
        >
          Update
        </button>
        {msg ? <p className="mt-3 text-sm text-brand-400">{msg}</p> : null}
      </section>
      <section className="mt-6 rounded-xl border border-white/10 bg-ink-900 p-5 text-sm text-slate-400">
        <p>General / WhatsApp / Calling / Queue / Recording / AI / Webhooks / API / Security / Email / System</p>
        <p className="mt-2">
          Engine and SMTP are configured via environment variables on the server. Session files are never exposed to
          this UI.
        </p>
      </section>
    </div>
  );
}
