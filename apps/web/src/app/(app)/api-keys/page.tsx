"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes?: string[];
  lastUsedAt?: string | null;
  revokedAt?: string | null;
};

function keyKind(prefix: string) {
  return prefix.startsWith("wc_pub_") ? "Website" : "Server";
}

export default function KeysPage() {
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [created, setCreated] = useState<string | null>(null);
  const [name, setName] = useState("Production");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const r = await api<{ success: true; data: KeyRow[] }>("/api/v1/api-keys");
    setRows(r.data);
  }
  useEffect(() => {
    void load();
  }, []);

  async function createKey(kind: "secret" | "publishable") {
    setError("");
    setBusy(true);
    try {
      const r = await api<{ success: true; data: { key: string } }>("/api/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || "Production", kind }),
      });
      setCreated(r.data.key);
      setCopied(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="API keys"
        subtitle="One key covers WhatsApp voice calls and WhatsApp SMS. You do not need separate keys for voice and SMS."
      />
      {error ? (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <section className="mb-6 rounded-2xl border border-white/10 bg-ink-900/80 p-5 text-sm leading-relaxed text-slate-300">
        <p className="font-medium text-white">How to use it</p>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-slate-400">
          <li>
            Create <strong className="text-slate-200">one Production key</strong>. That same key can start a call (
            <code>POST /api/v1/calls</code>) and send a text (<code>POST /api/v1/messages</code>).
          </li>
          <li>
            Copy the full value once (example: <code>wc_live_K7mP2xQ9nR4tW8vB</code>). WaCalls never shows it again.
          </li>
          <li>
            Put <strong className="text-slate-200">that one string</strong> in your server as{" "}
            <code>X-API-Key</code> — not in website HTML. Do not paste two keys, and do not split voice vs SMS.
          </li>
          <li>
            Website forms should use a <strong className="text-slate-200">website key</strong> (<code>wc_pub_</code>) from
            the link below, or send from your backend with the Production key.
          </li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          Older longer keys still work. Revoke a leaked key, then Delete it from this list. Sample code is on{" "}
          <Link href="/developers" className="text-brand-400 hover:underline">
            Developers
          </Link>
          .
        </p>
      </section>

      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name, e.g. Production"
          className="sm:max-w-xs"
        />
        <button
          className="rounded-lg bg-brand-500 px-4 py-2 font-medium text-ink-950 disabled:opacity-60"
          disabled={busy}
          onClick={() => void createKey("secret")}
        >
          Create key
        </button>
        <button
          className="text-sm text-slate-400 underline-offset-2 hover:text-white hover:underline disabled:opacity-60"
          disabled={busy}
          onClick={() => void createKey("publishable")}
        >
          Create website key
        </button>
      </div>
      {created ? (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          <p className="mb-2">Copy now; it will not be shown again.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-black/30 px-2 py-1 text-amber-50">{created}</code>
            <button
              className="rounded-md border border-amber-400/40 px-2 py-1 text-xs text-amber-100"
              onClick={async () => {
                await navigator.clipboard.writeText(created);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
      <ul className="space-y-2 text-sm">
        {rows.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-ink-900 px-4 py-3">
            <span className="text-slate-300">
              {k.name} · {keyKind(k.prefix)} · <code>{k.prefix}…</code>
              <span className="text-slate-500"> · voice + SMS</span>
              {k.revokedAt ? <span className="text-rose-300"> · revoked</span> : null}
            </span>
            {!k.revokedAt ? (
              <button
                className="text-rose-300"
                onClick={async () => {
                  await api(`/api/v1/api-keys/${k.id}`, { method: "DELETE" });
                  await load();
                }}
              >
                Revoke
              </button>
            ) : (
              <button
                className="text-rose-300"
                onClick={async () => {
                  if (!window.confirm("Delete this revoked key from the list?")) return;
                  await api(`/api/v1/api-keys/${k.id}?permanent=true`, { method: "DELETE" });
                  await load();
                }}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
