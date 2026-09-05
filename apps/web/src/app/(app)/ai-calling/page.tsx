"use client";

import { useEffect, useState } from "react";
import { api, getAccessToken } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { AgentTestPanel } from "@/components/agent-test-panel";
import { CallTranscriptButton } from "@/components/call-transcript";
import { CallRecordingActions } from "@/components/call-recording-actions";

type Tab = "knowledge" | "agents" | "incoming" | "templates" | "key";

type Template = {
  id: string;
  name: string;
  body: string;
  language: string;
  speaker: string;
  pace: number;
};
type Knowledge = { id: string; name: string; description: string; _count?: { documents: number } };
type Document = { id: string; title: string; content: string };
type Slot = {
  id: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  durationMin: number;
};
type Agent = {
  id: string;
  name: string;
  language: string;
  voice?: string | null;
  model: string;
  systemPrompt: string;
  greeting?: string | null;
  objective?: string | null;
  questions?: string | null;
  appointmentMessage?: string | null;
  knowledgeBaseId?: string | null;
  knowledgeBase?: { id: string; name: string } | null;
  appointmentSlots?: Slot[];
  appointments?: Array<{ id: string; phone: string; contactName?: string | null; startsAt: string }>;
  _count?: { appointments: number };
};
type IncomingChannel = {
  id: string;
  displayName: string;
  phoneNumber?: string | null;
  status: string;
  config: {
    enabled: boolean;
    aiConfigId: string;
    sendMessage: boolean;
    messageBody: string;
    messageWhen: "answered" | "ringing";
  };
};
type InboundCall = {
  id: string;
  phone: string;
  contactName?: string | null;
  status: string;
  durationMs: number;
  createdAt: string;
  hasRecording: boolean;
  hasTranscript?: boolean;
};
type Lang = { code: string; label: string };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseHm(value: string, fallback: number) {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h)) return fallback;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

function formatHm(minute: number) {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "knowledge", label: "1. Knowledge base" },
  { id: "agents", label: "2. AI agents" },
  { id: "incoming", label: "3. Auto answer" },
  { id: "templates", label: "Voice scripts" },
  { id: "key", label: "Sarvam API" },
];

export default function AiCallingPage() {
  const [tab, setTab] = useState<Tab>("knowledge");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [quota, setQuota] = useState({ maxKnowledgeBases: 1, maxAiAgents: 1 });
  const [languages, setLanguages] = useState<Lang[]>([]);
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [sarvam, setSarvam] = useState({ configured: false, last4: "", envFallback: false });
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tpl, setTpl] = useState({ name: "", body: "", language: "hi-IN", speaker: "shubh", pace: 1 });
  const [bases, setBases] = useState<Knowledge[]>([]);
  const [kb, setKb] = useState({ name: "", description: "" });
  const [openKb, setOpenKb] = useState<string>("");
  const [docs, setDocs] = useState<Document[]>([]);
  const [doc, setDoc] = useState({ title: "", content: "" });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [testingId, setTestingId] = useState("");
  const [incomingChannels, setIncomingChannels] = useState<IncomingChannel[]>([]);
  const [inboundCalls, setInboundCalls] = useState<InboundCall[]>([]);
  const [agent, setAgent] = useState({
    name: "",
    model: "sarvam-105b-conversations",
    language: "hi-IN",
    voice: "shubh",
    systemPrompt: "You are a helpful phone agent for our company. Be brief, polite, and accurate.",
    greeting: "Namaste {{name}}, main aapki company se baat kar raha hoon. Main aapki kaise madad kar sakta hoon?",
    objective: "",
    questions: "",
    knowledgeBaseId: "",
  });

  async function load() {
    const [opts, key, t, k, a, account, incoming] = await Promise.all([
      api<{ success: true; data: { languages: Lang[]; speakers: string[] } }>("/api/v1/voice-templates/options"),
      api<{ success: true; data: { configured: boolean; last4: string; envFallback: boolean } }>("/api/v1/ai/sarvam"),
      api<{ success: true; data: Template[] }>("/api/v1/voice-templates"),
      api<{ success: true; data: Knowledge[] }>("/api/v1/knowledge-bases"),
      api<{ success: true; data: { configs: Agent[]; sarvamConfigured: boolean } }>("/api/v1/ai-configs"),
      api<{
        success: true;
        data: { organization?: { plan?: { maxKnowledgeBases?: number; maxAiAgents?: number } | null } | null };
      }>("/api/v1/account").catch(() => ({ data: { organization: null } })),
      api<{
        success: true;
        data: { channels: IncomingChannel[]; recent: InboundCall[] };
      }>("/api/v1/incoming-answer").catch(() => ({ data: { channels: [], recent: [] } })),
    ]);
    setLanguages(opts.data.languages);
    setSpeakers(opts.data.speakers);
    setSarvam(key.data);
    setTemplates(t.data);
    setBases(k.data);
    setAgents(a.data.configs ?? []);
    setIncomingChannels(incoming.data.channels ?? []);
    setInboundCalls(incoming.data.recent ?? []);
    setQuota({
      maxKnowledgeBases: account.data.organization?.plan?.maxKnowledgeBases ?? 1,
      maxAiAgents: account.data.organization?.plan?.maxAiAgents ?? 1,
    });
    setTpl((f) => ({
      ...f,
      language: f.language || opts.data.languages[0]?.code || "hi-IN",
      speaker: f.speaker || opts.data.speakers[0] || "shubh",
    }));
    setAgent((f) => ({
      ...f,
      knowledgeBaseId: f.knowledgeBaseId || k.data[0]?.id || "",
    }));
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
    const id = new URLSearchParams(window.location.search).get("test");
    if (id) {
      setTab("agents");
      setTestingId(id);
    }
  }, []);

  async function reloadKb(id: string) {
    if (!id) {
      setDocs([]);
      return;
    }
    const row = await api<{ success: true; data: { documents: Document[] } }>(`/api/v1/knowledge-bases/${id}`);
    setDocs(row.data.documents);
  }

  useEffect(() => {
    if (openKb) void reloadKb(openKb).catch(() => undefined);
  }, [openKb]);

  async function preview(id: string) {
    setError("");
    setMsg("");
    const token = getAccessToken();
    const base = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
    const res = await fetch(`${base}/api/v1/voice-templates/${id}/preview`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      credentials: "include",
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error?.message ?? "Preview failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    await audio.play();
    audio.onended = () => URL.revokeObjectURL(url);
    setMsg("Playing preview");
  }

  return (
    <div>
      <PageHeader
        title="AI calling"
        subtitle="Knowledge base, AI agents, and auto-answer for incoming WhatsApp calls. Test an agent before you start a campaign."
      />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}
      {msg ? <p className="mb-4 text-sm text-brand-400">{msg}</p> : null}
      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === t.id ? "bg-brand-500 text-ink-950" : "bg-white/10 text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "key" ? (
        <section className="max-w-xl rounded-2xl border border-white/10 bg-ink-900/80 p-5">
          <h2 className="mb-2 font-medium text-white">Sarvam AI API key</h2>
          <p className="mb-4 text-sm text-slate-400">
            Create a key at dashboard.sarvam.ai. It is used for TTS (Bulbul), speech-to-text (Saaras), and the
            conversation model.
          </p>
          <p className="mb-3 text-xs text-slate-500">
            {sarvam.configured
              ? `Configured${sarvam.last4 ? ` · ends with ${sarvam.last4}` : ""}`
              : sarvam.envFallback
                ? "Using SARVAM_API_KEY from the server environment"
                : "Not configured yet"}
          </p>
          <input
            type="password"
            placeholder="Paste api-subscription-key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded-lg bg-brand-500 px-4 py-2 text-ink-950"
              onClick={async () => {
                setError("");
                try {
                  await api("/api/v1/ai/sarvam", { method: "PUT", body: JSON.stringify({ apiKey }) });
                  setApiKey("");
                  setMsg("Sarvam API key saved");
                  await load();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not save key");
                }
              }}
            >
              Save key
            </button>
            <button
              type="button"
              disabled={testing}
              className="rounded-lg bg-white/10 px-4 py-2 text-white hover:bg-white/15 disabled:opacity-50"
              onClick={async () => {
                setError("");
                setMsg("");
                setTesting(true);
                try {
                  const res = await api<{
                    success: true;
                    data: { ok: boolean; message: string };
                  }>("/api/v1/ai/sarvam/test", {
                    method: "POST",
                    body: JSON.stringify({ apiKey: apiKey.trim() || undefined }),
                  });
                  if (res.data.ok) setMsg(res.data.message);
                  else setError(res.data.message);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not test Sarvam");
                } finally {
                  setTesting(false);
                }
              }}
            >
              {testing ? "Testing…" : "Test"}
            </button>
          </div>
        </section>
      ) : null}

      {tab === "templates" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
            <h2 className="mb-3 font-medium text-white">New voice script</h2>
            <input
              className="mb-2"
              placeholder="Template name"
              value={tpl.name}
              onChange={(e) => setTpl({ ...tpl, name: e.target.value })}
            />
            <textarea
              className="mb-2 min-h-32 w-full"
              placeholder="Namaste {{name}}, yeh {{company}} se call hai..."
              value={tpl.body}
              onChange={(e) => setTpl({ ...tpl, body: e.target.value })}
            />
            <div className="grid gap-2 md:grid-cols-3">
              <select value={tpl.language} onChange={(e) => setTpl({ ...tpl, language: e.target.value })}>
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              <select value={tpl.speaker} onChange={(e) => setTpl({ ...tpl, speaker: e.target.value })}>
                {speakers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0.5}
                max={2}
                step={0.1}
                value={tpl.pace}
                onChange={(e) => setTpl({ ...tpl, pace: Number(e.target.value) })}
              />
            </div>
            <button
              className="mt-3 rounded-lg bg-brand-500 px-4 py-2 text-ink-950"
              onClick={async () => {
                setError("");
                try {
                  await api("/api/v1/voice-templates", { method: "POST", body: JSON.stringify(tpl) });
                  setTpl((f) => ({ ...f, name: "", body: "" }));
                  setMsg("Template saved");
                  await load();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not save template");
                }
              }}
            >
              Save template
            </button>
          </section>
          <section className="space-y-3">
            {templates.map((t) => (
              <div key={t.id} className="rounded-2xl border border-white/10 bg-ink-900/80 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-white">{t.name}</div>
                  <div className="flex gap-2 text-xs">
                    <button className="rounded-lg bg-white/10 px-2 py-1" onClick={() => preview(t.id)}>
                      Preview
                    </button>
                    <button
                      className="rounded-lg bg-white/10 px-2 py-1"
                      onClick={async () => {
                        await api(`/api/v1/voice-templates/${t.id}`, { method: "DELETE" });
                        await load();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">{t.body}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {t.language} · {t.speaker} · pace {t.pace}
                </p>
              </div>
            ))}
            {templates.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/15 p-6 text-sm text-slate-500">
                No scripts yet. Create one, preview it, then attach it to a Text to speech campaign.
              </p>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === "knowledge" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
            <h2 className="mb-3 font-medium text-white">Knowledge base</h2>
            <p className="mb-3 text-xs text-slate-500">
              {bases.length} of {quota.maxKnowledgeBases} on your plan. Add FAQs, pricing, and product facts here before
              creating an agent.
            </p>
            <input
              className="mb-2"
              placeholder="Name (e.g. Product FAQ)"
              value={kb.name}
              onChange={(e) => setKb({ ...kb, name: e.target.value })}
            />
            <textarea
              className="mb-3 min-h-20 w-full"
              placeholder="Short description"
              value={kb.description}
              onChange={(e) => setKb({ ...kb, description: e.target.value })}
            />
            <button
              className="rounded-lg bg-brand-500 px-4 py-2 text-ink-950"
              onClick={async () => {
                setError("");
                try {
                  const created = await api<{ success: true; data: Knowledge }>("/api/v1/knowledge-bases", {
                    method: "POST",
                    body: JSON.stringify(kb),
                  });
                  setKb({ name: "", description: "" });
                  setOpenKb(created.data.id);
                  await load();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not create knowledge base");
                }
              }}
            >
              Create
            </button>
            <div className="mt-4 space-y-2">
              {bases.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setOpenKb(b.id)}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                    openKb === b.id ? "bg-brand-500/20 text-brand-300" : "bg-white/5 text-slate-200"
                  }`}
                >
                  {b.name} · {b._count?.documents ?? 0} docs
                </button>
              ))}
            </div>
          </section>
          <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
            <h2 className="mb-3 font-medium text-white">Documents</h2>
            {!openKb ? (
              <p className="text-sm text-slate-500">Select a knowledge base to add answers the agent can use on calls.</p>
            ) : (
              <>
                <input
                  className="mb-2"
                  placeholder="Title"
                  value={doc.title}
                  onChange={(e) => setDoc({ ...doc, title: e.target.value })}
                />
                <textarea
                  className="mb-3 min-h-32 w-full"
                  placeholder="Facts, pricing, FAQs, objection handling..."
                  value={doc.content}
                  onChange={(e) => setDoc({ ...doc, content: e.target.value })}
                />
                <button
                  className="mb-4 rounded-lg bg-brand-500 px-4 py-2 text-ink-950"
                  onClick={async () => {
                    setError("");
                    try {
                      await api(`/api/v1/knowledge-bases/${openKb}/documents`, {
                        method: "POST",
                        body: JSON.stringify(doc),
                      });
                      setDoc({ title: "", content: "" });
                      await reloadKb(openKb);
                      await load();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not add document");
                    }
                  }}
                >
                  Add document
                </button>
                <div className="space-y-3">
                  {docs.map((d) => (
                    <div key={d.id} className="rounded-xl border border-white/10 p-3">
                      <div className="flex justify-between gap-2">
                        <div className="font-medium text-white">{d.title}</div>
                        <button
                          className="text-xs text-rose-300"
                          onClick={async () => {
                            await api(`/api/v1/knowledge-bases/${openKb}/documents/${d.id}`, { method: "DELETE" });
                            await reloadKb(openKb);
                            await load();
                          }}
                        >
                          Delete
                        </button>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-400">{d.content}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}

      {tab === "incoming" ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            WhatsApp linked rahe to incoming call server khud attend karega — browser khula hona zaroori nahi.
            Line busy (campaign/dialer) ho to call reject ho jayegi. Channel CONNECTED hona chahiye.
          </p>
          {incomingChannels.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/15 p-6 text-sm text-slate-500">
              Add a WhatsApp channel first, then assign an AI agent here.
            </p>
          ) : (
            incomingChannels.map((ch) => (
              <IncomingCard
                key={ch.id}
                channel={ch}
                agents={agents}
                onSaved={async () => {
                  setMsg("Auto-answer saved");
                  await load();
                }}
                onError={(m) => setError(m)}
              />
            ))
          )}
          <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-4">
            <h2 className="mb-3 text-sm font-medium text-white">Recent incoming calls</h2>
            {inboundCalls.length === 0 ? (
              <p className="text-sm text-slate-500">No inbound calls yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {inboundCalls.map((row) => (
                  <li key={row.id} className="rounded-xl border border-white/10 bg-ink-950/40 px-3 py-2 text-slate-300">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {row.contactName || row.phone} · {row.phone}
                      </span>
                      <span className="inline-flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {row.status} · {new Date(row.createdAt).toLocaleString()}
                        <CallTranscriptButton callId={row.id} hasTranscript={row.hasTranscript} />
                      </span>
                    </div>
                    {row.hasRecording ? (
                      <div className="mt-2">
                        <CallRecordingActions callId={row.id} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      {tab === "agents" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
            <h2 className="mb-3 font-medium text-white">New AI agent</h2>
            <p className="mb-3 text-xs text-slate-500">
              {agents.length} of {quota.maxAiAgents} agents on your plan. After you save one, tap Test, enable the
              microphone, and talk to it like a WhatsApp call.
            </p>
            <input
              className="mb-2"
              placeholder="Agent name"
              value={agent.name}
              onChange={(e) => setAgent({ ...agent, name: e.target.value })}
            />
            <textarea
              className="mb-2 min-h-24 w-full"
              placeholder="System prompt"
              value={agent.systemPrompt}
              onChange={(e) => setAgent({ ...agent, systemPrompt: e.target.value })}
            />
            <textarea
              className="mb-2 min-h-20 w-full"
              placeholder="Greeting spoken when they answer"
              value={agent.greeting}
              onChange={(e) => setAgent({ ...agent, greeting: e.target.value })}
            />
            <textarea
              className="mb-2 min-h-16 w-full"
              placeholder="Objective (optional)"
              value={agent.objective}
              onChange={(e) => setAgent({ ...agent, objective: e.target.value })}
            />
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Greeting language</label>
                <select value={agent.language} onChange={(e) => setAgent({ ...agent, language: e.target.value })}>
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  Opening line uses this. After that the agent mirrors Hindi / English automatically.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Voice</label>
                <select value={agent.voice} onChange={(e) => setAgent({ ...agent, voice: e.target.value })}>
                  {speakers.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-2">
              <label className="mb-1 block text-xs text-slate-400">Conversation model</label>
              <input
                placeholder="e.g. sarvam-105b-conversations"
                value={agent.model}
                onChange={(e) => setAgent({ ...agent, model: e.target.value })}
                className="w-full"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Smaller models are usually faster. If unsure, keep the default.
              </p>
            </div>
            <select
              className="mt-2"
              value={agent.knowledgeBaseId}
              onChange={(e) => setAgent({ ...agent, knowledgeBaseId: e.target.value })}
            >
              <option value="">{bases.length ? "Select knowledge base" : "Create a knowledge base first"}</option>
              {bases.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button
              className="mt-3 rounded-lg bg-brand-500 px-4 py-2 text-ink-950"
              onClick={async () => {
                setError("");
                try {
                  await api("/api/v1/ai-configs", {
                    method: "POST",
                    body: JSON.stringify({
                      ...agent,
                      knowledgeBaseId: agent.knowledgeBaseId || undefined,
                      provider: "sarvam",
                      model: agent.model || "sarvam-105b-conversations",
                    }),
                  });
                  setAgent((f) => ({ ...f, name: "" }));
                  setMsg("AI agent saved. Test it before starting a campaign.");
                  await load();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not save agent");
                }
              }}
            >
              Save agent
            </button>
            {!agent.knowledgeBaseId ? (
              <p className="mt-2 text-xs text-amber-200">Assign a knowledge base before saving the agent.</p>
            ) : null}
          </section>
          <section className="space-y-3">
            {agents.map((a) => (
              <div key={a.id} className="rounded-2xl border border-white/10 bg-ink-900/80 p-4">
                <div className="flex justify-between gap-2">
                  <div className="font-medium text-white">{a.name}</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-brand-500/20 px-2 py-1 text-xs text-brand-300"
                      onClick={() => setTestingId(a.id)}
                    >
                      Test
                    </button>
                    <button
                      className="text-xs text-rose-300"
                      onClick={async () => {
                        await api(`/api/v1/ai-configs/${a.id}`, { method: "DELETE" });
                        await load();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Sarvam AI · {a.language} · {a.voice || "shubh"} · {a.knowledgeBase?.name || "no knowledge base"}
                  {a._count?.appointments ? ` · ${a._count.appointments} appointments` : ""}
                </p>
                <p className="mt-2 text-sm text-slate-400">{a.greeting || a.systemPrompt}</p>
                <div className="mt-3 rounded-xl border border-white/10 p-3">
                  <p className="mb-2 text-xs font-medium text-slate-300">Appointment slots</p>
                  <div className="space-y-1">
                    {(a.appointmentSlots ?? []).map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 text-xs text-slate-400">
                        <span>
                          {DAYS[s.weekday]} {formatHm(s.startMinute)}–{formatHm(s.endMinute)} · {s.durationMin} min
                        </span>
                        <button
                          type="button"
                          className="text-rose-300"
                          onClick={async () => {
                            await api(`/api/v1/ai-configs/${a.id}/appointment-slots/${s.id}`, { method: "DELETE" });
                            await load();
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    {(a.appointmentSlots ?? []).length === 0 ? (
                      <p className="text-xs text-slate-500">Add hours so the agent can book a time while talking.</p>
                    ) : null}
                  </div>
                  <SlotForm
                    agentId={a.id}
                    onSaved={async () => {
                      await load();
                    }}
                  />
                  <ReminderForm
                    agentId={a.id}
                    value={a.appointmentMessage ?? ""}
                    onSaved={async () => {
                      await load();
                    }}
                  />
                  {(a.appointments ?? []).length ? (
                    <div className="mt-3 space-y-1 border-t border-white/10 pt-2">
                      <p className="text-xs font-medium text-slate-300">Upcoming bookings</p>
                      {a.appointments?.map((row) => (
                        <p key={row.id} className="text-xs text-slate-400">
                          {row.contactName || row.phone} · {new Date(row.startsAt).toLocaleString()}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {agents.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/15 p-6 text-sm text-slate-500">
                No agents yet. Create one with a greeting and knowledge base, test it, then pick it on a campaign.
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
      {testingId ? (
        <AgentTestPanel
          agentId={testingId}
          agentName={agents.find((a) => a.id === testingId)?.name || "AI agent"}
          onClose={() => setTestingId("")}
        />
      ) : null}
    </div>
  );
}

function IncomingCard({
  channel,
  agents,
  onSaved,
  onError,
}: {
  channel: IncomingChannel;
  agents: Agent[];
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(channel.config.enabled);
  const [aiConfigId, setAiConfigId] = useState(channel.config.aiConfigId);
  const [sendMessage, setSendMessage] = useState(channel.config.sendMessage);
  const [messageWhen, setMessageWhen] = useState<"answered" | "ringing">(channel.config.messageWhen);
  const [messageBody, setMessageBody] = useState(channel.config.messageBody);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setEnabled(channel.config.enabled);
    setAiConfigId(channel.config.aiConfigId);
    setSendMessage(channel.config.sendMessage);
    setMessageWhen(channel.config.messageWhen);
    setMessageBody(channel.config.messageBody);
  }, [channel]);
  return (
    <form
      className="rounded-2xl border border-white/10 bg-ink-900/80 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await api(`/api/v1/incoming-answer/${channel.id}`, {
            method: "PUT",
            body: JSON.stringify({
              enabled,
              aiConfigId: aiConfigId || null,
              sendMessage,
              messageWhen,
              messageBody,
            }),
          });
          await onSaved();
        } catch (err) {
          onError(err instanceof Error ? err.message : "Could not save auto-answer");
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-white">{channel.displayName}</p>
          <p className="text-xs text-slate-500">
            {channel.phoneNumber || "No number yet"} · {channel.status}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Auto-answer with AI
        </label>
      </div>
      <label className="mb-1 block text-xs text-slate-500">AI agent for incoming calls</label>
      <select className="mb-3" value={aiConfigId} onChange={(e) => setAiConfigId(e.target.value)}>
        <option value="">{agents.length ? "Select AI agent" : "Create an AI agent first"}</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-200">
        <input type="checkbox" checked={sendMessage} onChange={(e) => setSendMessage(e.target.checked)} />
        Send a WhatsApp message on this incoming call
      </label>
      {sendMessage ? (
        <>
          <label className="mb-1 block text-xs text-slate-500">When to send</label>
          <select
            className="mb-2"
            value={messageWhen}
            onChange={(e) => setMessageWhen(e.target.value as "answered" | "ringing")}
          >
            <option value="answered">When AI answers</option>
            <option value="ringing">As soon as the call comes in</option>
          </select>
          <textarea
            className="mb-3 min-h-20 w-full text-sm"
            placeholder="Namaste {{name}}, aapki call connect ho gayi hai."
            value={messageBody}
            onChange={(e) => setMessageBody(e.target.value)}
          />
          <p className="mb-3 text-xs text-slate-500">Use {"{{name}}"} and {"{{phone}}"}.</p>
        </>
      ) : null}
      <button type="submit" className="rounded-lg bg-brand-500 px-4 py-2 text-ink-950" disabled={saving}>
        {saving ? "Saving…" : "Save incoming settings"}
      </button>
    </form>
  );
}

function SlotForm({ agentId, onSaved }: { agentId: string; onSaved: () => Promise<void> }) {
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("18:00");
  const [duration, setDuration] = useState(30);
  return (
    <form
      className="mt-2 grid grid-cols-2 gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        await api(`/api/v1/ai-configs/${agentId}/appointment-slots`, {
          method: "POST",
          body: JSON.stringify({
            weekday,
            startMinute: parseHm(start, 10 * 60),
            endMinute: parseHm(end, 18 * 60),
            durationMin: duration,
          }),
        });
        await onSaved();
      }}
    >
      <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
        {DAYS.map((d, i) => (
          <option key={d} value={i}>
            {d}
          </option>
        ))}
      </select>
      <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
      <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
      <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
        {[15, 30, 45, 60].map((n) => (
          <option key={n} value={n}>
            {n} min
          </option>
        ))}
      </select>
      <button type="submit" className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white">
        Add slot
      </button>
    </form>
  );
}

function ReminderForm({
  agentId,
  value,
  onSaved,
}: {
  agentId: string;
  value: string;
  onSaved: () => Promise<void>;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  return (
    <form
      className="mt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await api(`/api/v1/ai-configs/${agentId}`, {
          method: "PATCH",
          body: JSON.stringify({
            appointmentMessage:
              text.trim() ||
              "Namaste {{name}}, aapka appointment {{datetime}} par booked hai. Kripya time par available rahein.",
          }),
        });
        await onSaved();
      }}
    >
      <label className="mb-1 block text-xs text-slate-500">WhatsApp reminder (sent at the appointment time)</label>
      <textarea
        className="min-h-16 w-full text-xs"
        placeholder="Namaste {{name}}, aapka appointment {{datetime}} par booked hai."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="mt-1 rounded-lg bg-white/10 px-2 py-1 text-xs text-white">
        Save reminder text
      </button>
    </form>
  );
}
