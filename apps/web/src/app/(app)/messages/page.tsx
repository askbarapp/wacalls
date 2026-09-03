"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { connectionState, StatusBadge } from "@/components/status-badge";
import {
  MessageTemplateForm,
  TemplateKindBadge,
  isStructuredTemplate,
  templateComposePreview,
  templateSummary,
  type MsgTemplate,
} from "@/components/message-template-form";

type Channel = { id: string; displayName: string; status: string; provider?: string };
type MessageRow = {
  id: string;
  phone: string;
  body: string;
  status: string;
  provider: string;
  error?: string | null;
  createdAt: string;
  channel?: { displayName: string; provider: string };
};

const TABS = [
  { id: "send", label: "Send message" },
  { id: "templates", label: "Message templates" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">Loading messages…</div>}>
      <MessagesInner />
    </Suspense>
  );
}

function MessagesInner() {
  const router = useRouter();
  const search = useSearchParams();
  const tab = (TABS.some((t) => t.id === search.get("tab")) ? search.get("tab") : "send") as Tab;
  const [channels, setChannels] = useState<Channel[]>([]);
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [starters, setStarters] = useState<MsgTemplate[]>([]);
  const [customTemplates, setCustomTemplates] = useState<MsgTemplate[]>([]);
  const [channelId, setChannelId] = useState("");
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  function setTab(next: Tab) {
    router.replace(`/messages?tab=${next}`);
  }

  async function load() {
    const [ch, m, templates] = await Promise.all([
      api<{ success: true; data: Channel[] }>("/api/v1/channels"),
      api<{ success: true; data: MessageRow[] }>("/api/v1/messages"),
      api<{ success: true; data: { starter: MsgTemplate[]; custom: MsgTemplate[] } }>(
        "/api/v1/message-templates",
      ),
    ]);
    setChannels(ch.data);
    setRows(m.data);
    setStarters(templates.data.starter ?? []);
    setCustomTemplates(templates.data.custom ?? []);
    setChannelId((id) => id || ch.data[0]?.id || "");
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  const selected = channels.find((c) => c.id === channelId);
  const allTemplates = [...starters, ...customTemplates];

  const selectedTemplate = allTemplates.find((t) => t.id === templateId);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const found = allTemplates.find((t) => t.id === id);
    if (found) setText(templateComposePreview(found));
  }

  async function send() {
    setError("");
    setBusy(true);
    try {
      await api("/api/v1/messages", {
        method: "POST",
        body: JSON.stringify({
          channel_id: channelId,
          phone,
          text: text || undefined,
          template_id: templateId || undefined,
        }),
      });
      setText("");
      setTemplateId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(id: string) {
    if (!window.confirm("Delete this template?")) return;
    try {
      await api(`/api/v1/message-templates/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete template");
    }
  }

  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle="Send WhatsApp text, media, button, or list templates — then reuse them in campaigns."
      />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}
      {notice ? (
        <div className="mb-6 rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-sm text-brand-200">
          {notice}
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl bg-ink-900 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-11 rounded-lg text-sm font-medium ${
              tab === t.id ? "bg-brand-500 text-ink-950" : "text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "send" ? (
        <>
          {selected && selected.status !== "CONNECTED" ? (
            <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              This line is disconnected.{" "}
              <Link href="/channels" className="font-medium text-brand-400 underline">
                Open WhatsApp and Reconnect
              </Link>
              , then send again.
            </div>
          ) : null}
          <div className="mb-8 rounded-2xl border border-white/10 bg-ink-900/70 p-5">
            <div className="grid gap-3">
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName} · {c.provider ?? "WEB"} ·{" "}
                    {connectionState(c.status) === "CONNECTED" ? "Connected" : "Disconnected"}
                  </option>
                ))}
              </select>
              <input
                placeholder="Phone with country code"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <select value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">Message template (optional)</option>
                {allTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.kind || "TEXT"}
                    {starters.some((s) => s.id === t.id) ? " · starter" : ""}
                  </option>
                ))}
              </select>
              {selectedTemplate && isStructuredTemplate(selectedTemplate.kind) ? (
                <div className="rounded-xl border border-white/10 bg-ink-950/50 p-3 text-sm text-slate-300">
                  <div className="mb-1 flex items-center gap-2">
                    <TemplateKindBadge kind={selectedTemplate.kind} />
                    <span className="text-xs text-slate-500">{templateSummary(selectedTemplate)}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{selectedTemplate.body}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    This template sends as {selectedTemplate.kind === "MEDIA" ? "an image with caption" : selectedTemplate.kind === "BUTTON" ? "buttons" : "a list menu"}.
                  </p>
                </div>
              ) : (
                <textarea
                  className="min-h-28 w-full"
                  placeholder="Message text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              )}
              <button
                onClick={send}
                disabled={busy || !channelId || !phone || (!text && !templateId)}
                className="min-h-11 rounded-lg bg-brand-500 px-5 py-2 font-medium text-ink-950 hover:bg-brand-400 disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send message"}
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Bulk send uses a WhatsApp message campaign. Templates are edited in the{" "}
              <button type="button" className="text-brand-400 underline" onClick={() => setTab("templates")}>
                Message templates
              </button>{" "}
              tab.
            </p>
          </div>
          <div className="space-y-2">
            {rows.map((m) => (
              <div key={m.id} className="rounded-xl border border-white/10 bg-ink-900/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-white">{m.phone}</div>
                  <StatusBadge status={m.status} />
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{m.body}</p>
                <div className="mt-2 text-xs text-slate-500">
                  {m.channel?.displayName ?? "channel"} · {m.provider} · {new Date(m.createdAt).toLocaleString()}
                  {m.error ? ` · ${m.error}` : ""}
                </div>
              </div>
            ))}
            {rows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">
                No messages yet. Send one above, or start a message campaign from Campaigns.
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <MessageTemplateForm
            onSaved={async () => {
              setNotice("Template saved. Use it here or in a WhatsApp message campaign.");
              await load();
            }}
          />
          <h2 className="mb-2 text-sm font-medium text-white">Starter templates</h2>
          <ul className="mb-6 space-y-2">
            {starters.map((t) => (
              <li key={t.id} className="rounded-xl border border-white/10 bg-ink-900/80 p-4 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-white">{t.name}</div>
                      <TemplateKindBadge kind={t.kind} />
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{templateSummary(t)}</p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-brand-400"
                    onClick={() => {
                      applyTemplate(t.id);
                      setTab("send");
                    }}
                  >
                    Use
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <h2 className="mb-2 text-sm font-medium text-white">Your templates</h2>
          <ul className="space-y-2">
            {customTemplates.map((t) => (
              <li key={t.id} className="rounded-xl border border-white/10 bg-ink-900/80 p-4 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-white">{t.name}</div>
                      <TemplateKindBadge kind={t.kind} />
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{templateSummary(t)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <button
                      type="button"
                      className="text-xs text-brand-400"
                      onClick={() => {
                        applyTemplate(t.id);
                        setTab("send");
                      }}
                    >
                      Use
                    </button>
                    <button type="button" onClick={() => void deleteTemplate(t.id)} className="text-xs text-rose-300">
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
            {customTemplates.length === 0 ? (
              <li className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">
                No custom templates yet. Save one above for single messages and campaigns.
              </li>
            ) : null}
          </ul>
        </>
      )}
    </div>
  );
}
