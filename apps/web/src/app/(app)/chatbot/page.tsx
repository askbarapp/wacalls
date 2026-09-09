"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { ConnectionBadge } from "@/components/status-badge";
import { ListPagination } from "@/components/list-pagination";
import { emptyMeta, type ListMeta, type PageSize } from "@/lib/csv";

type Channel = { id: string; displayName: string; phoneNumber?: string | null; status: string; provider?: string };
type Keyword = {
  id: string;
  keyword: string;
  reply: string;
  matchType: string;
  enabled: boolean;
  sortOrder: number;
};
type Bot = {
  id: string;
  channelId: string;
  enabled: boolean;
  mode: "RULES" | "AI" | "HYBRID";
  provider: string;
  welcomeMessage: string;
  fallbackMessage: string;
  handoffMessage: string;
  systemPrompt?: string | null;
  knowledgeBaseId?: string | null;
  aiConfigId?: string | null;
  channel?: Channel;
  keywords: Keyword[];
};
type Kb = { id: string; name: string };
type AiConfig = { id: string; name: string };
type Conversation = {
  id: string;
  phone: string;
  name: string;
  status: string;
  botPaused: boolean;
  lastMessageAt: string;
  preview?: string;
};
type Thread = Conversation & {
  messages: Array<{ id: string; sender: string; body: string; createdAt: string; source?: string | null }>;
};

export default function ChatbotPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [bot, setBot] = useState<Bot | null>(null);
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [agents, setAgents] = useState<AiConfig[]>([]);
  const [inbox, setInbox] = useState<Conversation[]>([]);
  const [inboxMeta, setInboxMeta] = useState<ListMeta>(emptyMeta(25));
  const [inboxPage, setInboxPage] = useState(1);
  const [inboxPageSize, setInboxPageSize] = useState<PageSize>(25);
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [reply, setReply] = useState("");
  const [tab, setTab] = useState<"setup" | "inbox">("setup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newKw, setNewKw] = useState({ keyword: "", reply: "" });

  async function loadBot(cid: string) {
    const r = await api<{ success: true; data: { channels: Channel[]; bot: Bot | null } }>(
      `/api/v1/chatbot?channelId=${cid}`,
    );
    setChannels(r.data.channels);
    setBot(r.data.bot);
  }

  async function loadInbox(cid: string) {
    const r = await api<{ success: true; data: Conversation[]; meta?: ListMeta }>(
      `/api/v1/chatbot/conversations?channelId=${cid}&page=${inboxPage}&limit=${inboxPageSize}`,
    );
    setInbox(r.data);
    setInboxMeta(r.meta ?? { ...emptyMeta(inboxPageSize), total: r.data.length, page: inboxPage });
  }

  async function openChat(id: string) {
    setOpenId(id);
    const r = await api<{ success: true; data: Thread }>(`/api/v1/chatbot/conversations/${id}`);
    setThread(r.data);
  }

  useEffect(() => {
    api<{ success: true; data: Channel[] }>("/api/v1/channels")
      .then((r) => {
        setChannels(r.data);
        if (r.data[0]?.id) setChannelId(r.data[0].id);
      })
      .catch(() => undefined);
    api<{ success: true; data: Kb[] }>("/api/v1/knowledge-bases")
      .then((r) => setKbs(r.data))
      .catch(() => undefined);
    api<{ success: true; data: { configs: AiConfig[] } }>("/api/v1/ai-configs")
      .then((r) => setAgents(r.data.configs ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!channelId) return;
    void loadBot(channelId).catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [channelId]);

  useEffect(() => {
    if (!channelId || tab !== "inbox") return;
    void loadInbox(channelId).catch(() => undefined);
    const t = setInterval(() => void loadInbox(channelId).catch(() => undefined), 4000);
    return () => clearInterval(t);
  }, [channelId, tab, inboxPage, inboxPageSize]);

  useEffect(() => {
    if (!openId) return;
    const t = setInterval(() => void openChat(openId).catch(() => undefined), 2500);
    return () => clearInterval(t);
  }, [openId]);

  async function saveBot(patch: Partial<Bot>) {
    if (!channelId) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ success: true; data: Bot }>("/api/v1/chatbot", {
        method: "PUT",
        body: JSON.stringify({ channelId, ...patch }),
      });
      setBot(r.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function seedKeywords() {
    setBusy(true);
    try {
      const r = await api<{ success: true; data: { keywords: Keyword[] } }>("/api/v1/chatbot/keywords/seed", {
        method: "POST",
        body: JSON.stringify({ channelId }),
      });
      setBot((b) => (b ? { ...b, keywords: r.data.keywords } : b));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setBusy(false);
    }
  }

  async function addKeyword() {
    if (!newKw.keyword.trim()) return;
    setBusy(true);
    try {
      await api("/api/v1/chatbot/keywords", {
        method: "POST",
        body: JSON.stringify({ channelId, keyword: newKw.keyword, reply: newKw.reply }),
      });
      setNewKw({ keyword: "", reply: "" });
      await loadBot(channelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add keyword");
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!openId || !reply.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ success: true; data: Thread }>(`/api/v1/chatbot/conversations/${openId}/reply`, {
        method: "POST",
        body: JSON.stringify({ text: reply }),
      });
      setThread(r.data);
      setReply("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  const selected = channels.find((c) => c.id === channelId);

  return (
    <div>
      <PageHeader
        title="WhatsApp Chatbot"
        subtitle="Keyword replies, AI chat (Gemini or Sarvam), and agent inbox on your connected WhatsApp line."
      />
      {error ? (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm"
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName} {c.phoneNumber ? `(${c.phoneNumber})` : ""}
            </option>
          ))}
        </select>
        {selected ? <ConnectionBadge status={selected.status} /> : null}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setTab("setup")}
            className={`rounded-lg px-3 py-1.5 text-sm ${tab === "setup" ? "bg-brand-500 text-ink-950" : "bg-white/10"}`}
          >
            Setup
          </button>
          <button
            type="button"
            onClick={() => setTab("inbox")}
            className={`rounded-lg px-3 py-1.5 text-sm ${tab === "inbox" ? "bg-brand-500 text-ink-950" : "bg-white/10"}`}
          >
            Inbox
          </button>
        </div>
      </div>

      {tab === "setup" && bot ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-ink-900/70 p-5">
            <h2 className="mb-4 text-sm font-semibold text-white">Bot settings</h2>
            <label className="mb-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={bot.enabled}
                onChange={(e) => void saveBot({ enabled: e.target.checked })}
              />
              Enable chatbot on this line
            </label>
            <div className="mb-3">
              <label className="mb-1 block text-xs text-slate-400">Mode</label>
              <select
                value={bot.mode}
                onChange={(e) => void saveBot({ mode: e.target.value as Bot["mode"] })}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              >
                <option value="HYBRID">Hybrid (keywords + AI)</option>
                <option value="RULES">Rules only</option>
                <option value="AI">AI only</option>
              </select>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">AI provider</label>
                <select
                  value={bot.provider}
                  onChange={(e) => void saveBot({ provider: e.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                >
                  <option value="gemini">Gemini</option>
                  <option value="sarvam">Sarvam</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">AI agent (optional)</label>
                <select
                  value={bot.aiConfigId ?? ""}
                  onChange={(e) => void saveBot({ aiConfigId: e.target.value || null })}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                >
                  <option value="">Custom prompt</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mb-3">
              <label className="mb-1 block text-xs text-slate-400">Knowledge base</label>
              <select
                value={bot.knowledgeBaseId ?? ""}
                onChange={(e) => void saveBot({ knowledgeBaseId: e.target.value || null })}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              >
                <option value="">None</option>
                {kbs.map((kb) => (
                  <option key={kb.id} value={kb.id}>{kb.name}</option>
                ))}
              </select>
            </div>
            {["welcomeMessage", "fallbackMessage", "handoffMessage"].map((field) => (
              <div key={field} className="mb-3">
                <label className="mb-1 block text-xs capitalize text-slate-400">
                  {field.replace(/Message$/, " message").replace(/([A-Z])/g, " $1")}
                </label>
                <textarea
                  value={bot[field as keyof Bot] as string}
                  onChange={(e) => setBot({ ...bot, [field]: e.target.value })}
                  onBlur={() => void saveBot({ [field]: bot[field as keyof Bot] })}
                  rows={2}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                />
              </div>
            ))}
          </section>

          <section className="rounded-2xl border border-white/10 bg-ink-900/70 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Keywords</h2>
              <button
                type="button"
                disabled={busy}
                onClick={() => void seedKeywords()}
                className="rounded-lg bg-white/10 px-3 py-1 text-xs hover:bg-white/15"
              >
                Add recommended
              </button>
            </div>
            <div className="mb-3 flex gap-2">
              <input
                placeholder="Keyword e.g. PRICE"
                value={newKw.keyword}
                onChange={(e) => setNewKw({ ...newKw, keyword: e.target.value })}
                className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              />
              <input
                placeholder="Reply"
                value={newKw.reply}
                onChange={(e) => setNewKw({ ...newKw, reply: e.target.value })}
                className="flex-[2] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              />
              <button type="button" onClick={() => void addKeyword()} className="rounded-lg bg-brand-500 px-3 text-sm text-ink-950">
                Add
              </button>
            </div>
            <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
              {bot.keywords.map((kw) => (
                <li key={kw.id} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                  <div className="font-medium text-brand-300">{kw.keyword}</div>
                  <div className="text-slate-400">{kw.reply || "(handoff / use default)"}</div>
                </li>
              ))}
              {!bot.keywords.length ? <li className="text-slate-500">No keywords yet.</li> : null}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "inbox" ? (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-ink-900/70">
            <ul className="max-h-[32rem] divide-y divide-white/5 overflow-y-auto">
              {inbox.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void openChat(c.id)}
                    className={`w-full px-4 py-3 text-left hover:bg-white/5 ${openId === c.id ? "bg-white/5" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-white">{c.name || c.phone}</span>
                      <span className="text-xs text-slate-500">{c.status}</span>
                    </div>
                    <div className="truncate text-xs text-slate-400">{c.preview || c.phone}</div>
                  </button>
                </li>
              ))}
              {!inbox.length ? <li className="px-4 py-8 text-center text-sm text-slate-500">No conversations yet.</li> : null}
            </ul>
            <ListPagination
              meta={inboxMeta}
              onPageChange={setInboxPage}
              pageSize={inboxPageSize}
              onPageSizeChange={setInboxPageSize}
            />
          </div>
          <div className="lg:col-span-3 flex min-h-[32rem] flex-col rounded-2xl border border-white/10 bg-ink-900/70">
            {thread ? (
              <>
                <div className="border-b border-white/10 px-4 py-3 text-sm">
                  <div className="font-medium text-white">{thread.name || thread.phone}</div>
                  <div className="text-slate-400">{thread.phone}</div>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-4">
                  {thread.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                        m.sender === "user"
                          ? "ml-auto bg-brand-500/20 text-brand-100"
                          : "bg-white/10 text-slate-200"
                      }`}
                    >
                      <div className="text-[10px] uppercase text-slate-500">{m.sender}</div>
                      {m.body}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 border-t border-white/10 p-3">
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Reply as agent…"
                    className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                    onKeyDown={(e) => e.key === "Enter" && void sendReply()}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void sendReply()}
                    className="rounded-lg bg-brand-500 px-4 text-sm font-medium text-ink-950"
                  >
                    Send
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Select a conversation</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
