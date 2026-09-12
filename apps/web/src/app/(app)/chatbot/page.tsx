"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { ListPagination } from "@/components/list-pagination";
import { emptyMeta, type ListMeta, type PageSize } from "@/lib/csv";

type Channel = { id: string; displayName: string; status: string; provider?: string };
type Agent = { id: string; name: string; provider?: string };
type Knowledge = { id: string; name: string };
type Keyword = {
  id: string;
  trigger: string;
  matchType: string;
  reply: string;
  action: string;
  enabled: boolean;
  sortOrder: number;
};
type Bot = {
  id: string;
  channelId: string;
  enabled: boolean;
  aiEnabled: boolean;
  greetingEnabled: boolean;
  greetingMessage: string;
  greetingCooldownDays: number;
  aiConfigId: string | null;
  knowledgeBaseId: string | null;
  fallbackMessage: string;
  optOutMessage: string;
  handoffMessage: string;
  unknownHandoff: boolean;
  keywords: Keyword[];
  channel?: Channel;
};
type Conversation = {
  id: string;
  phone: string;
  status: string;
  optOut: boolean;
  lastMessageAt: string;
  channel?: { displayName: string };
  contact?: { name: string | null; phone: string } | null;
  messages?: Array<{ body: string; direction: string; createdAt: string }>;
};
type ChatLine = { id: string; body: string; direction: string; source: string; createdAt: string };
type Thread = Omit<Conversation, "messages"> & {
  messages: ChatLine[];
};

const TABS = [
  { id: "setup", label: "Setup" },
  { id: "inbox", label: "Inbox" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function ChatbotPage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">Loading chatbot…</div>}>
      <ChatbotInner />
    </Suspense>
  );
}

function ChatbotInner() {
  const router = useRouter();
  const search = useSearchParams();
  const tab = (TABS.some((t) => t.id === search.get("tab")) ? search.get("tab") : "setup") as Tab;
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [bases, setBases] = useState<Knowledge[]>([]);
  const [channelId, setChannelId] = useState("");
  const [bot, setBot] = useState<Bot | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [kw, setKw] = useState({ trigger: "", reply: "", matchType: "exact", action: "reply" });
  const [editingKw, setEditingKw] = useState<string | null>(null);
  const [rows, setRows] = useState<Conversation[]>([]);
  const [meta, setMeta] = useState<ListMeta>(emptyMeta(25));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = chatScrollRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  }, [thread?.id, thread?.messages.length]);

  function setTab(next: Tab) {
    router.replace(`/chatbot?tab=${next}`);
  }

  async function loadBot(id: string) {
    const r = await api<{ success: true; data: Bot }>(`/api/v1/chatbots?channelId=${id}`);
    setBot(r.data);
  }

  async function loadInbox(pageNum = page, limit = pageSize, ch = channelId) {
    const params = new URLSearchParams({ page: String(pageNum), limit: String(limit) });
    if (ch) params.set("channelId", ch);
    const r = await api<{ success: true; data: Conversation[]; meta?: ListMeta }>(
      `/api/v1/chat/conversations?${params}`,
    );
    setRows(r.data);
    setMeta(r.meta ?? emptyMeta(limit));
  }

  useEffect(() => {
    void (async () => {
      try {
        const [ch, ai, kb] = await Promise.all([
          api<{ success: true; data: Channel[] }>("/api/v1/channels"),
          api<{ success: true; data: { configs: Agent[] } }>("/api/v1/ai-configs").catch(() => ({
            data: { configs: [] as Agent[] },
          })),
          api<{ success: true; data: Knowledge[] }>("/api/v1/knowledge-bases").catch(() => ({
            data: [] as Knowledge[],
          })),
        ]);
        setChannels(ch.data);
        setAgents(ai.data.configs ?? []);
        setBases(kb.data);
        const first = ch.data[0]?.id ?? "";
        setChannelId((id) => id || first);
        if (first) await loadBot(first);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
  }, []);

  useEffect(() => {
    if (tab !== "inbox" || !channelId) return;
    void loadInbox(page, pageSize, channelId).catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load inbox"),
    );
  }, [tab, page, pageSize, channelId]);

  async function saveBot() {
    if (!bot) return;
    setError("");
    setBusy(true);
    try {
      const r = await api<{ success: true; data: Bot }>("/api/v1/chatbots", {
        method: "PUT",
        body: JSON.stringify({
          channelId: bot.channelId,
          enabled: bot.enabled,
          aiEnabled: bot.aiEnabled,
          greetingEnabled: bot.greetingEnabled ?? true,
          greetingMessage: bot.greetingMessage ?? "नमस्ते! WaCalls में आपका स्वागत है। हम आपकी क्या सहायता कर सकते हैं?",
          greetingCooldownDays: bot.greetingCooldownDays ?? 14,
          aiConfigId: bot.aiConfigId,
          knowledgeBaseId: bot.knowledgeBaseId,
          fallbackMessage: bot.fallbackMessage,
          optOutMessage: bot.optOutMessage,
          handoffMessage: bot.handoffMessage,
          unknownHandoff: bot.unknownHandoff,
        }),
      });
      setBot(r.data);
      setMsg("Chatbot saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save chatbot");
    } finally {
      setBusy(false);
    }
  }

  async function saveKeyword() {
    if (!bot) return;
    setError("");
    try {
      if (editingKw) {
        await api(`/api/v1/chat-keywords/${editingKw}`, {
          method: "PATCH",
          body: JSON.stringify(kw),
        });
      } else {
        await api(`/api/v1/chatbots/${bot.id}/keywords`, {
          method: "POST",
          body: JSON.stringify(kw),
        });
      }
      setKw({ trigger: "", reply: "", matchType: "exact", action: "reply" });
      setEditingKw(null);
      await loadBot(bot.channelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save keyword");
    }
  }

  return (
    <div>
      <PageHeader
        title="WhatsApp chatbot"
        subtitle="Keyword replies first (HI, PRICE, STOP, AGENT). Everything else uses your Gemini or Sarvam agent plus knowledge base."
      />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {msg ? (
        <div className="mb-6 rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-sm text-brand-200">
          {msg}
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
      <label className="mb-4 block max-w-md text-xs text-slate-400">
        WhatsApp line
        <select
          className="mt-1 w-full"
          value={channelId}
          onChange={async (e) => {
            const id = e.target.value;
            setChannelId(id);
            setOpenId(null);
            setThread(null);
            if (id) await loadBot(id).catch((err) => setError(err instanceof Error ? err.message : "Load failed"));
          }}
        >
          {channels.length === 0 ? <option value="">Add a WhatsApp channel first</option> : null}
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName} · {c.status}
            </option>
          ))}
        </select>
      </label>

      {tab === "setup" && bot ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
            <h2 className="mb-4 text-base font-semibold text-white">Bot Controls & Status</h2>
            <div className="mb-5 space-y-4 rounded-xl border border-white/10 bg-black/30 p-4">
              {/* Master Switch */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">Chatbot Master Switch</span>
                    {bot.enabled ? (
                      <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
                        ON
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-500/20 px-2.5 py-0.5 text-[11px] font-bold text-slate-400">
                        OFF
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Enable or disable auto-replies for this WhatsApp line
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={bot.enabled}
                  onClick={() => setBot({ ...bot, enabled: !bot.enabled })}
                  className={`relative inline-flex h-8 w-16 shrink-0 cursor-pointer items-center rounded-full p-1 transition-colors duration-200 ease-in-out focus:outline-none ${
                    bot.enabled ? "bg-emerald-500 shadow-lg shadow-emerald-500/20" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      bot.enabled ? "translate-x-8" : "translate-x-0"
                    }`}
                  />
                  <span
                    className={`absolute text-[10px] font-extrabold tracking-wider ${
                      bot.enabled ? "left-2 text-white" : "right-2 text-slate-400"
                    }`}
                  >
                    {bot.enabled ? "ON" : "OFF"}
                  </span>
                </button>
              </div>

              {/* AI Knowledge Chat Switch */}
              <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">AI Knowledge Chat</span>
                    {bot.aiEnabled ? (
                      <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
                        ON
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-500/20 px-2.5 py-0.5 text-[11px] font-bold text-slate-400">
                        OFF
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Use Sarvam / Gemini when no keyword matches
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={bot.aiEnabled}
                  onClick={() => setBot({ ...bot, aiEnabled: !bot.aiEnabled })}
                  className={`relative inline-flex h-8 w-16 shrink-0 cursor-pointer items-center rounded-full p-1 transition-colors duration-200 ease-in-out focus:outline-none ${
                    bot.aiEnabled ? "bg-emerald-500 shadow-lg shadow-emerald-500/20" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      bot.aiEnabled ? "translate-x-8" : "translate-x-0"
                    }`}
                  />
                  <span
                    className={`absolute text-[10px] font-extrabold tracking-wider ${
                      bot.aiEnabled ? "left-2 text-white" : "right-2 text-slate-400"
                    }`}
                  >
                    {bot.aiEnabled ? "ON" : "OFF"}
                  </span>
                </button>
              </div>

              {/* Greeting Message Switch */}
              <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">Greeting Welcome Message</span>
                    {bot.greetingEnabled ? (
                      <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
                        ON
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-500/20 px-2.5 py-0.5 text-[11px] font-bold text-slate-400">
                        OFF
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Send welcome greeting on first message or after cooldown period
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={bot.greetingEnabled}
                  onClick={() => setBot({ ...bot, greetingEnabled: !bot.greetingEnabled })}
                  className={`relative inline-flex h-8 w-16 shrink-0 cursor-pointer items-center rounded-full p-1 transition-colors duration-200 ease-in-out focus:outline-none ${
                    bot.greetingEnabled ? "bg-emerald-500 shadow-lg shadow-emerald-500/20" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      bot.greetingEnabled ? "translate-x-8" : "translate-x-0"
                    }`}
                  />
                  <span
                    className={`absolute text-[10px] font-extrabold tracking-wider ${
                      bot.greetingEnabled ? "left-2 text-white" : "right-2 text-slate-400"
                    }`}
                  >
                    {bot.greetingEnabled ? "ON" : "OFF"}
                  </span>
                </button>
              </div>

              {/* Greeting Message Details & Cooldown Config */}
              {bot.greetingEnabled && (
                <div className="space-y-3 rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-slate-300">
                  <label className="block">
                    <span className="font-semibold text-white">Welcome Greeting Text</span>
                    <textarea
                      className="mt-1 min-h-20 w-full rounded-md border border-white/10 bg-black/60 p-2 text-xs text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none"
                      placeholder="नमस्ते! WaCalls में आपका स्वागत है। हम आपकी क्या सहायता कर सकते हैं?"
                      value={bot.greetingMessage ?? ""}
                      onChange={(e) => setBot({ ...bot, greetingMessage: e.target.value })}
                    />
                  </label>

                  <div>
                    <span className="font-semibold text-white block mb-1">Inactivity Cooldown (Repeat only after)</span>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {[
                        { label: "24 Hours", days: 1 },
                        { label: "7 Days", days: 7 },
                        { label: "14 Days", days: 14 },
                        { label: "30 Days", days: 30 },
                      ].map((preset) => (
                        <button
                          key={preset.days}
                          type="button"
                          onClick={() => setBot({ ...bot, greetingCooldownDays: preset.days })}
                          className={`rounded-md px-2 py-1.5 text-center text-[11px] font-semibold transition-all ${
                            (bot.greetingCooldownDays ?? 14) === preset.days
                              ? "bg-brand-500 text-ink-950 font-bold shadow"
                              : "bg-white/5 text-slate-300 hover:bg-white/10"
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-slate-400">Custom Duration:</span>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={bot.greetingCooldownDays ?? 14}
                        onChange={(e) =>
                          setBot({
                            ...bot,
                            greetingCooldownDays: Math.max(1, parseInt(e.target.value) || 1),
                          })
                        }
                        className="w-20 rounded border border-white/10 bg-black/60 px-2 py-1 text-center text-xs text-white"
                      />
                      <span className="text-slate-400">days</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      💡 इस अवधि के अंदर ग्राहक के दोबारा "Hi" या मैसेज करने पर Greeting दोबारा नहीं जाएगी।
                    </p>
                  </div>
                </div>
              )}
            </div>
            <label className="mb-2 block text-xs text-slate-400">
              AI agent
              <select
                className="mt-1 w-full"
                value={bot.aiConfigId ?? ""}
                onChange={(e) => setBot({ ...bot, aiConfigId: e.target.value || null })}
              >
                <option value="">None (keywords + fallback only)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="mb-3 text-[11px] text-slate-500">
              Create or <Link href="/ai-calling?tab=agents" className="text-brand-300 underline">edit AI agents</Link>{" "}
              on the AI calling page (Edit + Delete).
            </p>
            <label className="mb-2 block text-xs text-slate-400">
              Knowledge base
              <select
                className="mt-1 w-full"
                value={bot.knowledgeBaseId ?? ""}
                onChange={(e) => setBot({ ...bot, knowledgeBaseId: e.target.value || null })}
              >
                <option value="">Use the agent’s knowledge base</option>
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mb-2 block text-xs text-slate-400">
              Fallback
              <textarea
                className="mt-1 min-h-16 w-full"
                value={bot.fallbackMessage}
                onChange={(e) => setBot({ ...bot, fallbackMessage: e.target.value })}
              />
            </label>
            <label className="mb-2 block text-xs text-slate-400">
              STOP reply
              <textarea
                className="mt-1 min-h-16 w-full"
                value={bot.optOutMessage}
                onChange={(e) => setBot({ ...bot, optOutMessage: e.target.value })}
              />
            </label>
            <label className="mb-2 block text-xs text-slate-400">
              AGENT / handoff reply
              <textarea
                className="mt-1 min-h-16 w-full"
                value={bot.handoffMessage}
                onChange={(e) => setBot({ ...bot, handoffMessage: e.target.value })}
              />
            </label>
            <div className="mb-4 flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
              <div>
                <div className="text-sm font-medium text-white">After fallback, hand off to inbox</div>
                <div className="text-xs text-slate-400">Pause bot and transfer to human agent when unknown</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={bot.unknownHandoff}
                onClick={() => setBot({ ...bot, unknownHandoff: !bot.unknownHandoff })}
                className={`relative inline-flex h-7 w-14 shrink-0 cursor-pointer items-center rounded-full p-1 transition-colors duration-200 ease-in-out focus:outline-none ${
                  bot.unknownHandoff ? "bg-brand-500" : "bg-slate-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                    bot.unknownHandoff ? "translate-x-7" : "translate-x-0"
                  }`}
                />
                <span
                  className={`absolute text-[9px] font-bold ${
                    bot.unknownHandoff ? "left-1.5 text-ink-950" : "right-1.5 text-slate-400"
                  }`}
                >
                  {bot.unknownHandoff ? "ON" : "OFF"}
                </span>
              </button>
            </div>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg bg-brand-500 px-4 py-2 text-ink-950"
              onClick={() => void saveBot()}
            >
              Save chatbot
            </button>
          </section>
          <section className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
            <h2 className="mb-3 font-medium text-white">Keywords</h2>
            <p className="mb-3 text-xs text-slate-500">
              Priority: STOP → AGENT → these keywords → AI → fallback. Exact match is the whole message; contains matches a
              word inside it.
            </p>
            <div className="mb-4 grid gap-2">
              <input
                placeholder="Trigger (HI, PRICE…)"
                value={kw.trigger}
                onChange={(e) => setKw({ ...kw, trigger: e.target.value })}
              />
              <textarea
                className="min-h-16"
                placeholder="Reply"
                value={kw.reply}
                onChange={(e) => setKw({ ...kw, reply: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-2">
                <select value={kw.matchType} onChange={(e) => setKw({ ...kw, matchType: e.target.value })}>
                  <option value="exact">Exact</option>
                  <option value="contains">Contains</option>
                </select>
                <select value={kw.action} onChange={(e) => setKw({ ...kw, action: e.target.value })}>
                  <option value="reply">Reply</option>
                  <option value="handoff">Handoff</option>
                  <option value="opt_out">STOP / opt out</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button type="button" className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white" onClick={() => void saveKeyword()}>
                  {editingKw ? "Update keyword" : "Add keyword"}
                </button>
                {editingKw ? (
                  <button
                    type="button"
                    className="text-xs text-slate-400"
                    onClick={() => {
                      setEditingKw(null);
                      setKw({ trigger: "", reply: "", matchType: "exact", action: "reply" });
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
            <ul className="space-y-2 text-sm">
              {bot.keywords.map((k) => (
                <li key={k.id} className="rounded-xl border border-white/10 p-3">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-white">
                      {k.trigger}{" "}
                      <span className="text-xs font-normal text-slate-500">
                        {k.matchType} · {k.action}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <button
                        type="button"
                        className="text-xs text-brand-300"
                        onClick={() => {
                          setEditingKw(k.id);
                          setKw({
                            trigger: k.trigger,
                            reply: k.reply,
                            matchType: k.matchType,
                            action: k.action,
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs text-rose-300"
                        onClick={async () => {
                          await api(`/api/v1/chat-keywords/${k.id}`, { method: "DELETE" });
                          await loadBot(bot.channelId);
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                  <p className="mt-1 text-slate-400">{k.reply}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "inbox" ? (
        <div className="flex h-[min(70dvh,40rem)] min-h-[22rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900/80 lg:flex-row">
          <section
            className={`flex min-h-0 w-full shrink-0 flex-col border-white/10 lg:w-80 lg:border-r ${
              thread ? "hidden lg:flex" : "flex"
            }`}
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
              <ul className="space-y-2">
                {rows.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={async () => {
                        setOpenId(c.id);
                        const r = await api<{ success: true; data: Thread }>(`/api/v1/chat/conversations/${c.id}`);
                        setThread(r.data);
                      }}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm ${
                        openId === c.id ? "border-brand-500/40 bg-brand-500/10" : "border-white/10 bg-ink-950/40"
                      }`}
                    >
                      <div className="flex justify-between gap-2 text-white">
                        <span className="truncate">{c.contact?.name || c.phone}</span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">{c.status}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-400">
                        {c.messages?.[0]?.body || "No messages yet"}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
              {rows.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">
                  Inbound WhatsApp texts on this line will show up here after the channel is CONNECTED.
                </p>
              ) : null}
            </div>
            <div className="shrink-0 border-t border-white/10 px-3 py-2">
              <ListPagination
                className="mt-0"
                meta={meta}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            </div>
          </section>
          <section className={`min-h-0 min-w-0 flex-1 flex-col ${thread ? "flex" : "hidden lg:flex"}`}>
            {thread ? (
              <>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="mb-1 text-xs text-slate-400 lg:hidden"
                      onClick={() => {
                        setThread(null);
                        setOpenId(null);
                      }}
                    >
                      ← Conversations
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-white">{thread.contact?.name || thread.phone}</span>
                      {thread.status === "HANDOFF" ? (
                        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                          👤 Human Active (AI Paused)
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                          🤖 AI Bot Active
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {thread.phone}
                      {thread.optOut ? " · opted out" : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {thread.status === "HANDOFF" ? (
                      <button
                        type="button"
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                        onClick={async () => {
                          await api(`/api/v1/chat/conversations/${thread.id}/resume`, { method: "POST" });
                          const r = await api<{ success: true; data: Thread }>(
                            `/api/v1/chat/conversations/${thread.id}`,
                          );
                          setThread(r.data);
                          await loadInbox();
                        }}
                      >
                        ▶️ Resume AI Bot
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
                        onClick={async () => {
                          await api(`/api/v1/chat/conversations/${thread.id}/handoff`, { method: "POST" });
                          const r = await api<{ success: true; data: Thread }>(
                            `/api/v1/chat/conversations/${thread.id}`,
                          );
                          setThread(r.data);
                          await loadInbox();
                        }}
                      >
                        👤 Take Over (Pause AI)
                      </button>
                    )}
                  </div>
                </div>
                <div
                  ref={chatScrollRef}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
                >
                  <div className="flex flex-col gap-2">
                    {thread.messages.map((m) => {
                      const fromUser = m.direction === "IN";
                      return (
                        <div
                          key={m.id}
                          className={`flex ${fromUser ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[min(85%,22rem)] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                              fromUser
                                ? "rounded-br-md bg-emerald-700/80 text-white"
                                : "rounded-bl-md bg-white/10 text-slate-100"
                            }`}
                          >
                            <p className="text-[10px] font-medium uppercase tracking-wide text-white/50">
                              {fromUser ? "User" : m.source === "agent" ? "Agent (Web)" : m.source === "human_device" ? "You (Phone)" : "AI Bot"}
                            </p>
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            <p className="mt-1 text-[10px] text-white/40">
                              {new Date(m.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </div>
                </div>
                <form
                  className="flex shrink-0 gap-2 border-t border-white/10 p-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!reply.trim() || sending) return;
                    setSending(true);
                    try {
                      await api(`/api/v1/chat/conversations/${thread.id}/reply`, {
                        method: "POST",
                        body: JSON.stringify({ text: reply }),
                      });
                      setReply("");
                      const r = await api<{ success: true; data: Thread }>(
                        `/api/v1/chat/conversations/${thread.id}`,
                      );
                      setThread(r.data);
                      await loadInbox();
                    } finally {
                      setSending(false);
                    }
                  }}
                >
                  <input
                    className="min-w-0 flex-1"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Reply as agent…"
                  />
                  <button
                    type="submit"
                    disabled={sending}
                    className="shrink-0 rounded-lg bg-brand-500 px-3 py-2 text-sm text-ink-950 disabled:opacity-60"
                  >
                    Send
                  </button>
                </form>
              </>
            ) : (
              <p className="m-auto p-6 text-sm text-slate-500">Select a conversation.</p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
