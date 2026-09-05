"use client";

import { useEffect, useState } from "react";
import { api, getAccessToken } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { AgentTestPanel } from "@/components/agent-test-panel";
import { CallTranscriptButton } from "@/components/call-transcript";
import { CallRecordingActions } from "@/components/call-recording-actions";

type Tab = "knowledge" | "agents" | "incoming" | "templates" | "key" | "memory" | "analytics";

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
type IntentRow = {
  intent: string;
  examples: string;
  reply: string;
  action: "continue" | "hangup";
};
type Agent = {
  id: string;
  name: string;
  provider?: string;
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
  maxCallDurationSec?: number;
  wrapUpSec?: number;
  memoryRecallMode?: "related_only" | "always" | "never";
  intentPlaybook?: IntentRow[] | null;
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
  { id: "memory", label: "Caller memory" },
  { id: "analytics", label: "Intent analytics" },
  { id: "templates", label: "Voice scripts" },
  { id: "key", label: "API keys" },
];

const GEMINI_VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"];

const DEFAULT_PLAYBOOK: IntentRow[] = [
  {
    intent: "hangup_request",
    examples: "cut the call, hang up, phone cut, call band karo, baad mein, busy hun, mat call karo",
    reply: "Theek hai, dhanyavaad. Aapse phir baat karenge. Alvida.",
    action: "hangup",
  },
  {
    intent: "refuse_style",
    examples: "aisi baat mat karo, don't talk like this, galat baat, spam, pareshan mat karo",
    reply: "Maafi chahta hoon. Main aapko disturb nahi karunga. Dhanyavaad, alvida.",
    action: "hangup",
  },
  {
    intent: "not_interested",
    examples: "not interested, nahi chahiye, interested nahi, no thanks",
    reply: "Samajh gaya. Dhanyavaad aapka time dene ke liye. Alvida.",
    action: "hangup",
  },
  {
    intent: "price",
    examples: "price, cost, kitna, fees, charge, mahanga, rate",
    reply: "Pricing aapke plan pe depend karti hai — main short mein bataata hoon, ya detail bhej doon?",
    action: "continue",
  },
  {
    intent: "callback",
    examples: "callback, later, baad mein call, call back, phir se call",
    reply: "Zaroor — kab call karun, aap bataiye?",
    action: "continue",
  },
];

const DURATION_OPTIONS = [60, 90, 120, 180, 240, 300];

export default function AiCallingPage() {
  const [tab, setTab] = useState<Tab>("knowledge");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [quota, setQuota] = useState({ maxKnowledgeBases: 1, maxAiAgents: 1 });
  const [languages, setLanguages] = useState<Lang[]>([]);
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [sarvam, setSarvam] = useState({ configured: false, last4: "", envFallback: false });
  const [gemini, setGemini] = useState({ configured: false, last4: "", envFallback: false });
  const [apiKey, setApiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [testing, setTesting] = useState<"sarvam" | "gemini" | "">("");
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
    provider: "sarvam" as "sarvam" | "gemini",
    model: "sarvam-105b-conversations",
    language: "hi-IN",
    voice: "shubh",
    systemPrompt: "You are a helpful phone agent for our company. Be brief, polite, and accurate.",
    greeting: "Namaste {{name}}, main aapki company se baat kar raha hoon. Main aapki kaise madad kar sakta hoon?",
    objective: "",
    questions: "",
    knowledgeBaseId: "",
    maxCallDurationSec: 120,
    wrapUpSec: 25,
    memoryRecallMode: "related_only" as "related_only" | "always" | "never",
    intentPlaybook: DEFAULT_PLAYBOOK as IntentRow[],
  });
  const [memories, setMemories] = useState<
    Array<{
      phone: string;
      summary: string | null;
      facts: string[];
      lastIntent: string | null;
      callCount: number;
      lastCallAt: string | null;
      optOut?: boolean;
    }>
  >([]);
  const [memoryQ, setMemoryQ] = useState("");
  const [memoryEdit, setMemoryEdit] = useState<{
    phone: string;
    summary: string;
    factsText: string;
    lastIntent: string;
    optOut: boolean;
  } | null>(null);
  const [retentionDays, setRetentionDays] = useState(90);
  const [intentStats, setIntentStats] = useState<{
    days: number;
    total: number;
    byIntent: Array<{ intent: string; count: number; hangups: number }>;
    recent: Array<{
      intent: string;
      action: string | null;
      phone: string | null;
      createdAt: string;
      utterance: string | null;
    }>;
  } | null>(null);

  async function load() {
    const [opts, key, gemKey, t, k, a, account, incoming] = await Promise.all([
      api<{ success: true; data: { languages: Lang[]; speakers: string[] } }>("/api/v1/voice-templates/options"),
      api<{ success: true; data: { configured: boolean; last4: string; envFallback: boolean } }>("/api/v1/ai/sarvam"),
      api<{ success: true; data: { configured: boolean; last4: string; envFallback: boolean } }>("/api/v1/ai/gemini"),
      api<{ success: true; data: Template[] }>("/api/v1/voice-templates"),
      api<{ success: true; data: Knowledge[] }>("/api/v1/knowledge-bases"),
      api<{
        success: true;
        data: { configs: Agent[]; sarvamConfigured: boolean; geminiConfigured?: boolean };
      }>("/api/v1/ai-configs"),
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
    setGemini(gemKey.data);
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

  async function loadMemories(q = memoryQ) {
    const res = await api<{
      success: true;
      data: Array<{
        phone: string;
        summary: string | null;
        facts: string[];
        lastIntent: string | null;
        callCount: number;
        lastCallAt: string | null;
        optOut?: boolean;
      }>;
    }>(`/api/v1/ai/memories?limit=100${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);
    setMemories(res.data ?? []);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
    const id = new URLSearchParams(window.location.search).get("test");
    if (id) {
      setTab("agents");
      setTestingId(id);
    }
  }, []);

  useEffect(() => {
    if (tab !== "memory") return;
    void Promise.all([
      loadMemories(),
      api<{ success: true; data: { retentionDays: number } }>("/api/v1/ai/memory-settings")
        .then((r) => setRetentionDays(r.data.retentionDays))
        .catch(() => undefined),
    ]).catch((err) => setError(err instanceof Error ? err.message : "Failed to load memories"));
  }, [tab]);

  useEffect(() => {
    if (tab !== "analytics") return;
    void api<{
      success: true;
      data: {
        days: number;
        total: number;
        byIntent: Array<{ intent: string; count: number; hangups: number }>;
        recent: Array<{
          intent: string;
          action: string | null;
          phone: string | null;
          createdAt: string;
          utterance: string | null;
        }>;
      };
    }>("/api/v1/ai/analytics/intents?days=30")
      .then((r) => setIntentStats(r.data))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load analytics"));
  }, [tab]);

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

      {tab === "memory" ? (
        <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
          <h2 className="mb-1 font-medium text-white">Caller memory</h2>
          <p className="mb-4 text-sm text-slate-400">
            Organization-wide notes per phone number. Auto-updated after AI calls — edit anytime.
          </p>
          <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-ink-950/50 p-3">
            <label className="text-xs text-slate-400">
              Auto-delete unused memory after (days)
              <input
                className="mt-1 block min-h-10 w-28"
                type="number"
                min={0}
                max={3650}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value) || 0)}
              />
            </label>
            <button
              type="button"
              className="rounded-lg bg-white/10 px-3 py-2 text-xs"
              onClick={async () => {
                setError("");
                try {
                  await api("/api/v1/ai/memory-settings", {
                    method: "PUT",
                    body: JSON.stringify({ retentionDays }),
                  });
                  setMsg(
                    retentionDays <= 0
                      ? "Memory retention: keep forever."
                      : `Memory older than ${retentionDays} days will be purged.`,
                  );
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not save retention");
                }
              }}
            >
              Save retention
            </button>
            <p className="text-[11px] text-slate-500">0 = keep forever. Worker purges daily.</p>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            <input
              className="min-w-[14rem] flex-1"
              placeholder="Search phone or summary"
              value={memoryQ}
              onChange={(e) => setMemoryQ(e.target.value)}
            />
            <button
              type="button"
              className="rounded-lg bg-white/10 px-4 py-2 text-sm"
              onClick={() => void loadMemories().catch((err) => setError(err instanceof Error ? err.message : "Search failed"))}
            >
              Search
            </button>
            <button
              type="button"
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm text-ink-950"
              onClick={() => setMemoryEdit({ phone: "", summary: "", factsText: "", lastIntent: "", optOut: false })}
            >
              Add note
            </button>
          </div>
          {memoryEdit ? (
            <div className="mb-4 rounded-xl border border-white/10 bg-ink-950/60 p-4">
              <input
                className="mb-2 w-full"
                placeholder="Phone number"
                value={memoryEdit.phone}
                onChange={(e) => setMemoryEdit({ ...memoryEdit, phone: e.target.value })}
              />
              <textarea
                className="mb-2 min-h-20 w-full"
                placeholder="Summary"
                value={memoryEdit.summary}
                onChange={(e) => setMemoryEdit({ ...memoryEdit, summary: e.target.value })}
              />
              <textarea
                className="mb-2 min-h-16 w-full"
                placeholder="Facts (one per line)"
                value={memoryEdit.factsText}
                onChange={(e) => setMemoryEdit({ ...memoryEdit, factsText: e.target.value })}
              />
              <input
                className="mb-3 w-full"
                placeholder="Last intent (optional)"
                value={memoryEdit.lastIntent}
                onChange={(e) => setMemoryEdit({ ...memoryEdit, lastIntent: e.target.value })}
              />
              <label className="mb-3 flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={memoryEdit.optOut}
                  onChange={(e) => setMemoryEdit({ ...memoryEdit, optOut: e.target.checked })}
                />
                Opt out — AI will not use or update memory for this number
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm text-ink-950"
                  onClick={async () => {
                    setError("");
                    try {
                      if (!memoryEdit.phone.trim()) throw new Error("Phone is required");
                      await api(`/api/v1/ai/memories/${encodeURIComponent(memoryEdit.phone.trim())}`, {
                        method: "PUT",
                        body: JSON.stringify({
                          summary: memoryEdit.summary.trim() || null,
                          facts: memoryEdit.factsText
                            .split("\n")
                            .map((l) => l.trim())
                            .filter(Boolean),
                          lastIntent: memoryEdit.lastIntent.trim() || null,
                          optOut: memoryEdit.optOut,
                        }),
                      });
                      setMemoryEdit(null);
                      setMsg("Memory saved.");
                      await loadMemories();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not save memory");
                    }
                  }}
                >
                  Save memory
                </button>
                <button type="button" className="rounded-lg bg-white/10 px-4 py-2 text-sm" onClick={() => setMemoryEdit(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          <ul className="divide-y divide-white/5">
            {memories.map((m) => (
              <li key={m.phone} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-white">
                    {m.phone}
                    {m.optOut ? <span className="ml-2 text-xs text-amber-300">opted out</span> : null}
                  </p>
                  <p className="text-sm text-slate-400">{m.summary || "No summary yet"}</p>
                  {m.facts?.length ? (
                    <p className="mt-1 text-xs text-slate-500">{m.facts.join(" · ")}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-slate-600">
                    {m.callCount} calls
                    {m.lastIntent ? ` · ${m.lastIntent}` : ""}
                    {m.lastCallAt ? ` · last ${new Date(m.lastCallAt).toLocaleString()}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-white/10 px-3 py-1.5 text-xs"
                    onClick={() =>
                      setMemoryEdit({
                        phone: m.phone,
                        summary: m.summary || "",
                        factsText: (m.facts || []).join("\n"),
                        lastIntent: m.lastIntent || "",
                        optOut: Boolean(m.optOut),
                      })
                    }
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs text-rose-200"
                    onClick={async () => {
                      await api(`/api/v1/ai/memories/${encodeURIComponent(m.phone)}`, { method: "DELETE" });
                      await loadMemories();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {memories.length === 0 ? (
              <li className="py-8 text-center text-sm text-slate-500">
                No memories yet. They appear automatically after AI calls, or add a note above.
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {tab === "analytics" ? (
        <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
          <h2 className="mb-1 font-medium text-white">Intent analytics</h2>
          <p className="mb-4 text-sm text-slate-400">
            Matched playbook intents from live AI calls (last {intentStats?.days ?? 30} days).
          </p>
          <p className="mb-4 text-sm text-slate-300">
            Total matches: <span className="font-medium text-white">{intentStats?.total ?? 0}</span>
          </p>
          <div className="mb-6 space-y-2">
            {(intentStats?.byIntent ?? []).map((row) => (
              <div key={row.intent} className="flex items-center gap-3 text-sm">
                <div className="w-36 shrink-0 truncate text-slate-300">{row.intent}</div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{
                      width: `${Math.max(6, Math.round((row.count / Math.max(intentStats?.total || 1, 1)) * 100))}%`,
                    }}
                  />
                </div>
                <div className="w-24 shrink-0 text-right text-xs text-slate-400">
                  {row.count}
                  {row.hangups ? ` · ${row.hangups} hangup` : ""}
                </div>
              </div>
            ))}
            {!intentStats?.byIntent?.length ? (
              <p className="py-6 text-center text-sm text-slate-500">
                No intent matches yet. Run AI calls with the playbook to populate this.
              </p>
            ) : null}
          </div>
          <h3 className="mb-2 text-sm font-medium text-white">Recent matches</h3>
          <ul className="divide-y divide-white/5 text-sm">
            {(intentStats?.recent ?? []).map((r, i) => (
              <li key={`${r.intent}-${r.createdAt}-${i}`} className="py-2">
                <p className="text-slate-200">
                  <span className="font-medium text-white">{r.intent}</span>
                  {r.action === "hangup" ? " · hangup" : ""}
                  {r.phone ? ` · ${r.phone}` : ""}
                </p>
                {r.utterance ? <p className="text-xs text-slate-500">&ldquo;{r.utterance}&rdquo;</p> : null}
                <p className="text-[11px] text-slate-600">{new Date(r.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "key" ? (
        <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
            <h2 className="mb-2 font-medium text-white">Sarvam AI</h2>
            <p className="mb-4 text-sm text-slate-400">
              dashboard.sarvam.ai — Indian languages, Bulbul TTS, Saaras STT, and conversation model.
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
                disabled={testing === "sarvam"}
                className="rounded-lg bg-white/10 px-4 py-2 text-white hover:bg-white/15 disabled:opacity-50"
                onClick={async () => {
                  setError("");
                  setMsg("");
                  setTesting("sarvam");
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
                    setTesting("");
                  }
                }}
              >
                {testing === "sarvam" ? "Testing…" : "Test"}
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
            <h2 className="mb-2 font-medium text-white">Google Gemini</h2>
            <p className="mb-4 text-sm text-slate-400">
              aistudio.google.com/apikey — strong multi-language chat, audio transcription, and Gemini TTS voices.
            </p>
            <p className="mb-3 text-xs text-slate-500">
              {gemini.configured
                ? `Configured${gemini.last4 ? ` · ends with ${gemini.last4}` : ""}`
                : gemini.envFallback
                  ? "Using GEMINI_API_KEY from the server environment"
                  : "Not configured yet"}
            </p>
            <input
              type="password"
              placeholder="Paste Gemini API key"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="rounded-lg bg-brand-500 px-4 py-2 text-ink-950"
                onClick={async () => {
                  setError("");
                  try {
                    await api("/api/v1/ai/gemini", {
                      method: "PUT",
                      body: JSON.stringify({ apiKey: geminiKey }),
                    });
                    setGeminiKey("");
                    setMsg("Gemini API key saved");
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
                disabled={testing === "gemini"}
                className="rounded-lg bg-white/10 px-4 py-2 text-white hover:bg-white/15 disabled:opacity-50"
                onClick={async () => {
                  setError("");
                  setMsg("");
                  setTesting("gemini");
                  try {
                    const res = await api<{
                      success: true;
                      data: { ok: boolean; message: string };
                    }>("/api/v1/ai/gemini/test", {
                      method: "POST",
                      body: JSON.stringify({ apiKey: geminiKey.trim() || undefined }),
                    });
                    if (res.data.ok) setMsg(res.data.message);
                    else setError(res.data.message);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not test Gemini");
                  } finally {
                    setTesting("");
                  }
                }}
              >
                {testing === "gemini" ? "Testing…" : "Test"}
              </button>
            </div>
          </section>
          <p className="text-sm text-slate-400 lg:col-span-2">
            Each AI agent picks Sarvam or Gemini. Speech, replies, and voice all use that provider’s key.
          </p>
        </div>
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
            <div className="mb-3 grid gap-2 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Max call duration</label>
                <select
                  value={agent.maxCallDurationSec}
                  onChange={(e) => setAgent({ ...agent, maxCallDurationSec: Number(e.target.value) })}
                >
                  {DURATION_OPTIONS.map((sec) => (
                    <option key={sec} value={sec}>
                      {sec < 60 ? `${sec}s` : `${sec / 60} min`}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  Soft wrap-up starts ~{agent.wrapUpSec}s before the limit, then the call hangs up.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Wrap-up window (seconds)</label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={agent.wrapUpSec}
                  onChange={(e) => setAgent({ ...agent, wrapUpSec: Number(e.target.value) || 25 })}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Caller says cut / not interested → thank them and hang up early.
                </p>
              </div>
            </div>
            <div className="mb-3">
              <label className="mb-1 block text-xs text-slate-400">Caller memory recall</label>
              <select
                value={agent.memoryRecallMode}
                onChange={(e) =>
                  setAgent({
                    ...agent,
                    memoryRecallMode: e.target.value as "related_only" | "always" | "never",
                  })
                }
              >
                <option value="related_only">Only when topic is related (recommended)</option>
                <option value="always">Acknowledge past context when helpful</option>
                <option value="never">Do not use memory on calls</option>
              </select>
            </div>
            <div className="mb-3 rounded-xl border border-white/10 bg-ink-950/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-white">Intent playbook</p>
                  <p className="text-[11px] text-slate-500">
                    If the caller means this intent, use this reply. Hangup intents end the call after thanks.
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-300"
                  onClick={() =>
                    setAgent({
                      ...agent,
                      intentPlaybook: [
                        ...agent.intentPlaybook,
                        { intent: "", examples: "", reply: "", action: "continue" },
                      ],
                    })
                  }
                >
                  Add intent
                </button>
              </div>
              <div className="space-y-3">
                {agent.intentPlaybook.map((row, idx) => (
                  <div key={`${row.intent}-${idx}`} className="rounded-lg border border-white/10 p-2">
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        placeholder="Intent (e.g. price)"
                        value={row.intent}
                        onChange={(e) => {
                          const intentPlaybook = [...agent.intentPlaybook];
                          intentPlaybook[idx] = { ...row, intent: e.target.value };
                          setAgent({ ...agent, intentPlaybook });
                        }}
                      />
                      <select
                        value={row.action}
                        onChange={(e) => {
                          const intentPlaybook = [...agent.intentPlaybook];
                          intentPlaybook[idx] = {
                            ...row,
                            action: e.target.value as "continue" | "hangup",
                          };
                          setAgent({ ...agent, intentPlaybook });
                        }}
                      >
                        <option value="continue">Continue call</option>
                        <option value="hangup">Thank & hang up</option>
                      </select>
                    </div>
                    <input
                      className="mt-2 w-full"
                      placeholder="Cues / examples (comma separated)"
                      value={row.examples}
                      onChange={(e) => {
                        const intentPlaybook = [...agent.intentPlaybook];
                        intentPlaybook[idx] = { ...row, examples: e.target.value };
                        setAgent({ ...agent, intentPlaybook });
                      }}
                    />
                    <textarea
                      className="mt-2 min-h-14 w-full text-sm"
                      placeholder="AI reply for this intent"
                      value={row.reply}
                      onChange={(e) => {
                        const intentPlaybook = [...agent.intentPlaybook];
                        intentPlaybook[idx] = { ...row, reply: e.target.value };
                        setAgent({ ...agent, intentPlaybook });
                      }}
                    />
                    <button
                      type="button"
                      className="mt-1 text-xs text-rose-300"
                      onClick={() =>
                        setAgent({
                          ...agent,
                          intentPlaybook: agent.intentPlaybook.filter((_, i) => i !== idx),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Per-number memory is automatic for your organization. AI recalls it only when the topic is related.
              </p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-400">AI provider</label>
                <select
                  value={agent.provider}
                  onChange={(e) => {
                    const provider = e.target.value as "sarvam" | "gemini";
                    setAgent({
                      ...agent,
                      provider,
                      model: provider === "gemini" ? "gemini-3.6-flash" : "sarvam-105b-conversations",
                      voice: provider === "gemini" ? "Kore" : "shubh",
                    });
                  }}
                >
                  <option value="sarvam">Sarvam AI</option>
                  <option value="gemini">Google Gemini</option>
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  {agent.provider === "gemini"
                    ? gemini.configured || gemini.envFallback
                      ? "Uses your Gemini API key for speech, chat, and voice."
                      : "Save a Gemini API key first on the API keys tab."
                    : sarvam.configured || sarvam.envFallback
                      ? "Uses your Sarvam API key for speech, chat, and voice."
                      : "Save a Sarvam API key first on the API keys tab."}
                </p>
              </div>
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
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Voice</label>
                <select value={agent.voice} onChange={(e) => setAgent({ ...agent, voice: e.target.value })}>
                  {(agent.provider === "gemini" ? GEMINI_VOICES : speakers).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Conversation model</label>
                <input
                  placeholder={
                    agent.provider === "gemini" ? "e.g. gemini-3.6-flash" : "e.g. sarvam-105b-conversations"
                  }
                  value={agent.model}
                  onChange={(e) => setAgent({ ...agent, model: e.target.value })}
                  className="w-full"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  {agent.provider === "gemini"
                    ? "gemini-3.6-flash is a good default for fast multilingual calls."
                    : "Smaller models are usually faster. If unsure, keep the default."}
                </p>
              </div>
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
                      provider: agent.provider,
                      maxCallDurationSec: agent.maxCallDurationSec,
                      wrapUpSec: agent.wrapUpSec,
                      memoryRecallMode: agent.memoryRecallMode,
                      intentPlaybook: agent.intentPlaybook.filter((r) => r.intent.trim() && r.reply.trim()),
                      model:
                        agent.model ||
                        (agent.provider === "gemini" ? "gemini-3.6-flash" : "sarvam-105b-conversations"),
                    }),
                  });
                  setAgent((f) => ({
                    ...f,
                    name: "",
                    intentPlaybook: DEFAULT_PLAYBOOK,
                    maxCallDurationSec: 120,
                    wrapUpSec: 25,
                  }));
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
                  {a.provider === "gemini" ? "Google Gemini" : "Sarvam AI"} · {a.language} ·{" "}
                  {a.voice || (a.provider === "gemini" ? "Kore" : "shubh")} · max{" "}
                  {a.maxCallDurationSec ?? 120}s · {a.knowledgeBase?.name || "no knowledge base"}
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
