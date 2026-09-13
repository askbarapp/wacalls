"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { ListPagination } from "@/components/list-pagination";
import { emptyMeta, type ListMeta, type PageSize } from "@/lib/csv";

type CommanderMember = {
  id: string;
  channelId: string;
  name: string;
  phone: string;
  role: "OWNER" | "SALES_MANAGER" | "ACCOUNTS" | "SUPPORT";
  dailyMorning: boolean;
  dailyEod: boolean;
  missedAlert: boolean;
  enabled: boolean;
  createdAt: string;
};

type Channel = {
  id: string;
  displayName: string;
  status: string;
  provider?: string;
  ownerPhone?: string | null;
  commanderMembers?: CommanderMember[];
};
type Agent = { id: string; name: string; provider?: string };
type Knowledge = { id: string; name: string };
type Keyword = {
  id: string;
  trigger: string;
  matchType: string;
  reply: string;
  action: string;
  targetAiConfigId?: string | null;
  targetKnowledgeBaseId?: string | null;
  targetAiConfig?: { id: string; name: string };
  targetKnowledgeBase?: { id: string; name: string };
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
  ownerPhone?: string | null;
  keywords: Keyword[];
  channel?: Channel;
};
type Conversation = {
  id: string;
  phone: string;
  status: string;
  optOut: boolean;
  lastMessageAt: string;
  workCategory?: string | null;
  leadStage?: string | null;
  intent?: string | null;
  sentiment?: string | null;
  dealValue?: number | null;
  summary?: string | null;
  channel?: { displayName: string };
  contact?: { name: string | null; phone: string } | null;
  messages?: Array<{ body: string; direction: string; createdAt: string }>;
};
type BusinessTask = {
  id: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority: string;
  status: string;
  contactPhone?: string | null;
  contactName?: string | null;
  category?: string | null;
  dealAmount?: number | null;
  createdAt: string;
  channel?: { displayName: string };
};
type BusinessInvoice = {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientPhone: string;
  kind: string;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  status: string;
  dueDate?: string | null;
  notes?: string | null;
  createdAt: string;
  channel?: { displayName: string };
};
type ChatLine = { id: string; body: string; direction: string; source: string; createdAt: string };
type Thread = Omit<Conversation, "messages"> & {
  messages: ChatLine[];
};

type InboxFilter = "all" | "hot" | "tasks" | "invoices" | "escalations";

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
  const [kw, setKw] = useState<{
    trigger: string;
    reply: string;
    matchType: string;
    action: string;
    targetAiConfigId?: string | null;
    targetKnowledgeBaseId?: string | null;
  }>({
    trigger: "",
    reply: "",
    matchType: "exact",
    action: "reply",
    targetAiConfigId: null,
    targetKnowledgeBaseId: null,
  });
  const [editingKw, setEditingKw] = useState<string | null>(null);
  const [rows, setRows] = useState<Conversation[]>([]);
  const [meta, setMeta] = useState<ListMeta>(emptyMeta(25));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>("all");
  const [tasks, setTasks] = useState<BusinessTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [invoices, setInvoices] = useState<BusinessInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // WhatsApp Commander Lines (WaCall OS Hub)
  const [commanders, setCommanders] = useState<CommanderMember[]>([]);
  const [isAddingCommander, setIsAddingCommander] = useState(false);
  const [newCmdName, setNewCmdName] = useState("");
  const [newCmdPhone, setNewCmdPhone] = useState("");
  const [newCmdRole, setNewCmdRole] = useState<"OWNER" | "SALES_MANAGER" | "ACCOUNTS" | "SUPPORT">("SALES_MANAGER");
  const [newCmdMorning, setNewCmdMorning] = useState(true);
  const [newCmdEod, setNewCmdEod] = useState(true);
  const [newCmdAlert, setNewCmdAlert] = useState(true);
  const [savingCommander, setSavingCommander] = useState(false);

  async function loadCommanders(cid: string) {
    try {
      const res = await api<{ success: true; data: CommanderMember[] }>(`/api/v1/chatbots/commanders?channelId=${cid}`);
      setCommanders(res.data || []);
    } catch {
      /* ignore */
    }
  }

  async function handleAddCommander() {
    if (!channelId || !newCmdName.trim() || !newCmdPhone.trim()) return;
    setSavingCommander(true);
    try {
      const res = await api<{ success: true; data: CommanderMember }>("/api/v1/chatbots/commanders", {
        method: "POST",
        body: JSON.stringify({
          channelId,
          name: newCmdName.trim(),
          phone: newCmdPhone.trim(),
          role: newCmdRole,
          dailyMorning: newCmdMorning,
          dailyEod: newCmdEod,
          missedAlert: newCmdAlert,
        }),
      });
      setCommanders((prev) => [...prev.filter((m) => m.id !== res.data.id), res.data]);
      setNewCmdName("");
      setNewCmdPhone("");
      setIsAddingCommander(false);
      setMsg("Commander line added successfully!");
    } catch (err: any) {
      setError(err?.message || "Failed to add commander");
    } finally {
      setSavingCommander(false);
    }
  }

  async function handleToggleCommander(member: CommanderMember) {
    try {
      const nextState = !member.enabled;
      await api(`/api/v1/chatbots/commanders/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: nextState }),
      });
      setCommanders((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, enabled: nextState } : m)),
      );
    } catch (err: any) {
      setError(err?.message || "Failed to update commander status");
    }
  }

  async function handleDeleteCommander(id: string) {
    if (!confirm("Are you sure you want to remove this commander line?")) return;
    try {
      await api(`/api/v1/chatbots/commanders/${id}`, { method: "DELETE" });
      setCommanders((prev) => prev.filter((m) => m.id !== id));
      setMsg("Commander line removed.");
    } catch (err: any) {
      setError(err?.message || "Failed to remove commander");
    }
  }

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
    const botData = r.data;
    if (!botData.ownerPhone && botData.channel?.ownerPhone) {
      botData.ownerPhone = botData.channel.ownerPhone;
    }
    setBot(botData);
    if (botData.channel?.commanderMembers) {
      setCommanders(botData.channel.commanderMembers);
    } else {
      void loadCommanders(id);
    }
  }

  async function loadTasks() {
    setLoadingTasks(true);
    try {
      const r = await api<{ success: true; data: BusinessTask[] }>("/api/v1/chat/tasks");
      setTasks(r.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoadingTasks(false);
    }
  }

  async function loadInvoices() {
    setLoadingInvoices(true);
    try {
      const r = await api<{ success: true; data: BusinessInvoice[] }>("/api/v1/invoices?limit=50");
      setInvoices(r.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoices");
    } finally {
      setLoadingInvoices(false);
    }
  }

  async function sendInvoiceWhatsApp(invoiceId: string) {
    try {
      await api(`/api/v1/invoices/${invoiceId}/send`, { method: "POST" });
      setMsg("Quotation / Invoice sent to client on WhatsApp with PDF!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invoice on WhatsApp");
    }
  }

  async function markInvoiceAsPaid(invoice: BusinessInvoice) {
    try {
      const balance = invoice.total - invoice.amountPaid;
      await api(`/api/v1/invoices/${invoice.id}/payment`, {
        method: "PATCH",
        body: JSON.stringify({ amount: balance }),
      });
      setMsg(`Invoice #${invoice.invoiceNumber} marked as PAID.`);
      await loadInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update payment");
    }
  }

  async function toggleTaskStatus(task: BusinessTask) {
    const nextStatus = task.status === "COMPLETED" ? "PENDING" : "COMPLETED";
    try {
      await api(`/api/v1/chat/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task");
    }
  }

  async function loadInbox(pageNum = page, limit = pageSize, ch = channelId, filter = inboxFilter) {
    if (filter === "tasks") {
      await loadTasks();
      return;
    }
    if (filter === "invoices") {
      await loadInvoices();
      return;
    }
    const params = new URLSearchParams({ page: String(pageNum), limit: String(limit) });
    if (ch) params.set("channelId", ch);
    if (filter === "hot") params.set("leadStage", "HOT");
    if (filter === "escalations") params.set("sentiment", "ANGRY");
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
    void loadInbox(page, pageSize, channelId, inboxFilter).catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load inbox"),
    );
  }, [tab, page, pageSize, channelId, inboxFilter]);

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
          ownerPhone: bot.ownerPhone ?? bot.channel?.ownerPhone ?? null,
        }),
      });
      const updated = r.data;
      if (!updated.ownerPhone && updated.channel?.ownerPhone) {
        updated.ownerPhone = updated.channel.ownerPhone;
      }
      setBot(updated);
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
      setKw({ trigger: "", reply: "", matchType: "exact", action: "reply", targetAiConfigId: null, targetKnowledgeBaseId: null });
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
            {/* WhatsApp Commander Hub (WaCall OS) */}
            <div className="mb-5 rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-ink-950/70 to-brand-500/10 p-4 sm:p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-amber-300">👑 WhatsApp Commander Hub (WaCall OS)</span>
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 uppercase tracking-wide">
                      Hybrid OS
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-300 leading-relaxed">
                    बिज़नेस ओनर व आपकी टीम (सेल्स हेड, अकाउंट्स आदि) सीधे अपने WhatsApp से बात करके या वॉइस नोट भेजकर पूरे बिज़नेस को चला सकते हैं।
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddingCommander(!isAddingCommander)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black transition-all hover:bg-amber-400 self-start sm:self-auto shrink-0 shadow-sm"
                >
                  <span>{isAddingCommander ? "✕ बंद करें" : "+ नया कमांडर जोड़ें"}</span>
                </button>
              </div>

              {/* Primary Owner Line */}
              <div className="mt-3.5 space-y-1.5">
                <label className="text-[11px] font-semibold text-amber-200/90 uppercase tracking-wide">
                  1. प्राइमरी ओनर नंबर (Primary Owner WhatsApp Line)
                </label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <input
                    type="text"
                    placeholder="e.g. 919876543210 (आपका व्यक्तिगत WhatsApp नंबर)"
                    className="flex-1 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                    value={bot.ownerPhone ?? bot.channel?.ownerPhone ?? ""}
                    onChange={(e) => setBot({ ...bot, ownerPhone: e.target.value })}
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  💡 इस नंबर से या अपने बिज़नेस नंबर पर <b>Self-Chat</b> करके आप WaCall को सीधे कमांड दे सकते हैं। नीचे “Save Changes” दबाने पर यह सेव हो जाएगा।
                </p>
              </div>

              {/* Add Commander Member Form (Expandable) */}
              {isAddingCommander ? (
                <div className="mt-4 rounded-xl border border-amber-400/30 bg-black/70 p-3.5 space-y-3">
                  <div className="text-xs font-semibold text-amber-300 flex items-center justify-between">
                    <span>➕ नया टीम मेंबर कमांडर जोड़ें (Team Commander Line)</span>
                    <span className="text-[10px] text-slate-400">Role-Based Access</span>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">नाम व पद (Member Name)</label>
                      <input
                        type="text"
                        placeholder="e.g. Pooja (Sales Head)"
                        className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                        value={newCmdName}
                        onChange={(e) => setNewCmdName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">WhatsApp नंबर (Country Code सहित)</label>
                      <input
                        type="text"
                        placeholder="e.g. 919876543210"
                        className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                        value={newCmdPhone}
                        onChange={(e) => setNewCmdPhone(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">रोल व अनुमति (Role & Permissions)</label>
                      <select
                        className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                        value={newCmdRole}
                        onChange={(e) => setNewCmdRole(e.target.value as any)}
                      >
                        <option value="OWNER">👑 Owner (पूर्ण अधिकार - कॉल, फाइनेंस, लीड्स, पोस्टर)</option>
                        <option value="SALES_MANAGER">🎯 Sales Head (कॉल रिपोर्ट, हॉट लीड्स, कैंपेन)</option>
                        <option value="ACCOUNTS">💼 Accounts (इनवॉइस, बकाया पेमेंट, मार्क पेड)</option>
                        <option value="SUPPORT">🎧 Support (कॉल स्टेटस, ऑटो-रिप्लाई नियम)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">दैनिक ऑटो-रिपोर्ट्स (Daily Alerts)</label>
                      <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-slate-300">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newCmdMorning}
                            onChange={(e) => setNewCmdMorning(e.target.checked)}
                            className="rounded border-white/20 bg-black/60 text-amber-500 focus:ring-0"
                          />
                          <span>🌅 9 AM मॉर्निंग</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newCmdEod}
                            onChange={(e) => setNewCmdEod(e.target.checked)}
                            className="rounded border-white/20 bg-black/60 text-amber-500 focus:ring-0"
                          />
                          <span>🌙 8 PM EOD</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newCmdAlert}
                            onChange={(e) => setNewCmdAlert(e.target.checked)}
                            className="rounded border-white/20 bg-black/60 text-amber-500 focus:ring-0"
                          />
                          <span>🚨 मिस्ड कॉल</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsAddingCommander(false)}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                    >
                      रद्द करें
                    </button>
                    <button
                      type="button"
                      disabled={savingCommander || !newCmdName.trim() || !newCmdPhone.trim()}
                      onClick={handleAddCommander}
                      className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
                    >
                      {savingCommander ? "सेव हो रहा है…" : "कमांडर जोड़ें"}
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Authorized Commander Members List */}
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-amber-200/90 uppercase tracking-wide">
                  <span>2. अधिकृत टीम मेंबर्स ({commanders.length})</span>
                  <span className="text-[10px] font-normal text-slate-400">कॉल व व्हाट्सऐप से एक्सेस</span>
                </div>

                {commanders.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 bg-black/30 p-3 text-center text-xs text-slate-400">
                    अभी कोई टीम मेंबर नहीं जोड़ा गया है। &quot;+ नया कमांडर जोड़ें&quot; बटन दबाकर सेल्स हेड या अकाउंट्स का नंबर अधिकृत करें।
                  </div>
                ) : (
                  <div className="space-y-2">
                    {commanders.map((cmd) => (
                      <div
                        key={cmd.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-white/10 bg-black/50 p-2.5 transition-all hover:border-amber-400/30"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-base">
                            {cmd.role === "OWNER" ? "👑" : cmd.role === "SALES_MANAGER" ? "🎯" : cmd.role === "ACCOUNTS" ? "💼" : "🎧"}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-white">{cmd.name}</span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                  cmd.role === "OWNER"
                                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                    : cmd.role === "SALES_MANAGER"
                                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                    : cmd.role === "ACCOUNTS"
                                    ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                                    : "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                }`}
                              >
                                {cmd.role === "OWNER" ? "Owner" : cmd.role === "SALES_MANAGER" ? "Sales Head" : cmd.role === "ACCOUNTS" ? "Accounts" : "Support"}
                              </span>
                              {!cmd.enabled && (
                                <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-medium text-rose-300">
                                  Disabled
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">{cmd.phone}</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 pl-10 sm:pl-0">
                          {/* Alert badges */}
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                            {cmd.dailyMorning && <span title="9 AM Morning Briefing">🌅</span>}
                            {cmd.dailyEod && <span title="8 PM EOD Report">🌙</span>}
                            {cmd.missedAlert && <span title="Missed Call Alert">🚨</span>}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleToggleCommander(cmd)}
                              className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                                cmd.enabled
                                  ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                                  : "bg-slate-700/50 text-slate-300 hover:bg-slate-700"
                              }`}
                            >
                              {cmd.enabled ? "Active" : "Paused"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCommander(cmd.id)}
                              className="rounded p-1 text-slate-500 hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
                              title="हटाएं"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Natural Language Cheatsheet */}
              <div className="mt-4 rounded-xl border border-white/5 bg-black/40 p-3 text-[11px] text-slate-300 space-y-2">
                <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                  <span>⚡ WhatsApp Commander Commands (व्हाट्सऐप कमांड्स):</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 text-slate-400">
                  <div className="rounded-lg bg-white/5 p-2 space-y-0.5">
                    <div className="font-medium text-white">📞 Call Intelligence (कॉल रिपोर्ट):</div>
                    <div>&quot;today total call&quot;, &quot;आज कितने call आए हैं&quot; पूछें। रिपोर्ट के नीचे <b>1</b> (WhatsApp फॉलो-अप) या <b>2</b> (AI डायलर) दबाएँ।</div>
                  </div>
                  <div className="rounded-lg bg-white/5 p-2 space-y-0.5">
                    <div className="font-medium text-white">🎙️ Voice Notes (बोलकर काम कराएं):</div>
                    <div>WhatsApp पर वॉइस नोट भेजें — Sarvam STT द्वारा WaCall अपने आप ट्रांसक्राइब करके टास्क या रिपोर्ट देगा।</div>
                  </div>
                  <div className="rounded-lg bg-white/5 p-2 space-y-0.5">
                    <div className="font-medium text-white">🔥 Hot Leads & Tasks:</div>
                    <div>&quot;Hot leads निकालो&quot;, &quot;आज के सारे काम बताओ&quot; या ग्राहक की चैट WaCall को Forward करें।</div>
                  </div>
                  <div className="rounded-lg bg-white/5 p-2 space-y-0.5">
                    <div className="font-medium text-white">🎨 AI Creative Studio:</div>
                    <div>&quot;Diwali ka poster bana do&quot; बोलें, पोस्टर पसंद आने पर &quot;Final&quot; या &quot;Logo छोटा करो&quot; कहें।</div>
                  </div>
                  <div className="rounded-lg bg-white/5 p-2 space-y-0.5">
                    <div className="font-medium text-white">💰 Finance & Payments:</div>
                    <div>&quot;Pending payments बताओ&quot;, &quot;Mark paid Rahul 25000&quot; या &quot;Send invoice to Amit 15000&quot;।</div>
                  </div>
                  <div className="rounded-lg bg-white/5 p-2 space-y-0.5">
                    <div className="font-medium text-white">🌅 Scheduled Scorecards:</div>
                    <div>अधिकृत नंबर्स पर रोज़ सुबह 9:00 AM मॉर्निंग ब्रीफिंग व रात 8:00 PM EOD परफॉर्मेंस रिपोर्ट अपने आप आएगी।</div>
                  </div>
                </div>
              </div>
            </div>

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
                placeholder={
                  kw.action === "attend_to_ai"
                    ? "Optional transition reply (e.g. Connecting you with our product expert...)"
                    : "Reply"
                }
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
                  <option value="attend_to_ai">Attend to AI (Route to AI Agent)</option>
                  <option value="handoff">Handoff</option>
                  <option value="opt_out">STOP / opt out</option>
                </select>
              </div>

              {kw.action === "attend_to_ai" && (
                <div className="grid gap-2 rounded-xl border border-brand-500/30 bg-brand-500/5 p-3">
                  <label className="block text-xs font-semibold text-brand-300">
                    Assign Specialized AI Agent
                    <select
                      className="mt-1 w-full rounded border border-white/10 bg-black/60 p-2 text-xs text-white"
                      value={kw.targetAiConfigId ?? ""}
                      onChange={(e) => setKw({ ...kw, targetAiConfigId: e.target.value || null })}
                    >
                      <option value="">
                        Default Bot Agent ({agents.find((a) => a.id === bot.aiConfigId)?.name || "Default"})
                      </option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs font-semibold text-brand-300">
                    Knowledge Base (Optional override)
                    <select
                      className="mt-1 w-full rounded border border-white/10 bg-black/60 p-2 text-xs text-white"
                      value={kw.targetKnowledgeBaseId ?? ""}
                      onChange={(e) => setKw({ ...kw, targetKnowledgeBaseId: e.target.value || null })}
                    >
                      <option value="">Use Agent’s assigned knowledge base</option>
                      {bases.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-[11px] text-slate-400">
                    💡 जब ग्राहक यह keyword चुनेगा, तो यह AI Agent उस विषय पर अपनी Knowledge Base के आधार पर बातचीत आगे संभालेगा।
                  </p>
                </div>
              )}

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
                      setKw({ trigger: "", reply: "", matchType: "exact", action: "reply", targetAiConfigId: null, targetKnowledgeBaseId: null });
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
                      <span className="text-xs font-normal text-slate-400">
                        {k.matchType} ·{" "}
                        {k.action === "attend_to_ai" ? (
                          <span className="rounded bg-brand-500/20 px-1.5 py-0.5 font-semibold text-brand-300">
                            🤖 Attend to AI ({k.targetAiConfig?.name || agents.find((a) => a.id === k.targetAiConfigId)?.name || "Specialized Agent"})
                          </span>
                        ) : (
                          k.action
                        )}
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
                            targetAiConfigId: k.targetAiConfigId || null,
                            targetKnowledgeBaseId: k.targetKnowledgeBaseId || null,
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
                  {k.reply ? <p className="mt-1 text-slate-400">{k.reply}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "inbox" ? (
        <div className="space-y-4">
          {/* Work Inbox Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setInboxFilter("all");
                  setPage(1);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  inboxFilter === "all"
                    ? "bg-brand-500 text-ink-950 font-bold shadow"
                    : "border border-white/10 bg-ink-900/80 text-slate-300 hover:bg-white/10"
                }`}
              >
                All Chats
              </button>
              <button
                type="button"
                onClick={() => {
                  setInboxFilter("hot");
                  setPage(1);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  inboxFilter === "hot"
                    ? "bg-rose-500 text-white font-bold shadow shadow-rose-500/30"
                    : "border border-white/10 bg-ink-900/80 text-slate-300 hover:bg-white/10"
                }`}
              >
                <span>🔥 Hot Leads</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setInboxFilter("tasks");
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  inboxFilter === "tasks"
                    ? "bg-amber-500 text-ink-950 font-bold shadow shadow-amber-500/30"
                    : "border border-white/10 bg-ink-900/80 text-slate-300 hover:bg-white/10"
                }`}
              >
                <span>📋 Tasks & Follow-ups</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setInboxFilter("invoices");
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  inboxFilter === "invoices"
                    ? "bg-emerald-500 text-ink-950 font-bold shadow shadow-emerald-500/30"
                    : "border border-white/10 bg-ink-900/80 text-slate-300 hover:bg-white/10"
                }`}
              >
                <span>💰 Invoices & Quotes</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setInboxFilter("escalations");
                  setPage(1);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  inboxFilter === "escalations"
                    ? "bg-red-600 text-white font-bold shadow shadow-red-600/30 animate-pulse"
                    : "border border-white/10 bg-ink-900/80 text-slate-300 hover:bg-white/10"
                }`}
              >
                <span>🚨 Urgent Escalations</span>
              </button>
            </div>
            <div className="text-xs text-slate-400">
              {inboxFilter === "tasks"
                ? `${tasks.length} Business Tasks`
                : inboxFilter === "invoices"
                ? `${invoices.length} Invoices & Quotes`
                : `${meta.total} Conversations`}
            </div>
          </div>

          {inboxFilter === "tasks" ? (
            <div className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">Business Tasks & Client Actions</h3>
                  <p className="text-xs text-slate-400">
                    Tasks and actions automatically extracted from forwarded WhatsApp chats or owner commands
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadTasks()}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                >
                  🔄 Refresh
                </button>
              </div>

              {loadingTasks ? (
                <div className="py-12 text-center text-sm text-slate-400">Loading tasks…</div>
              ) : tasks.length === 0 ? (
                <div className="rounded-xl border border-white/5 bg-black/20 py-12 text-center text-sm text-slate-400">
                  <p className="font-medium text-slate-300">No business tasks found.</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Forward any client WhatsApp message to your WaCall number or send a WhatsApp command like{" "}
                    <span className="text-amber-300">&quot;Remind me to call Rahul tomorrow at 5pm&quot;</span> to see tasks here.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tasks.map((task) => {
                    const isCompleted = task.status === "COMPLETED";
                    return (
                      <div
                        key={task.id}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-4 transition-all ${
                          isCompleted
                            ? "border-white/5 bg-black/20 opacity-60"
                            : "border-white/10 bg-black/40 hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={isCompleted}
                            onChange={() => void toggleTaskStatus(task)}
                            className="mt-1 h-4 w-4 rounded border-white/20 bg-black/40 text-brand-500 focus:ring-brand-500 cursor-pointer"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`text-sm font-semibold ${isCompleted ? "line-through text-slate-400" : "text-white"}`}>
                                {task.title}
                              </span>
                              {task.priority === "URGENT" && (
                                <span className="rounded bg-red-600/30 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
                                  URGENT
                                </span>
                              )}
                              {task.priority === "HIGH" && (
                                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                                  HIGH
                                </span>
                              )}
                              {task.category && (
                                <span className="rounded bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-300 uppercase">
                                  {task.category}
                                </span>
                              )}
                              {task.dealAmount ? (
                                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                                  ₹{task.dealAmount.toLocaleString()}
                                </span>
                              ) : null}
                            </div>
                            {task.description && (
                              <p className="mt-1 text-xs text-slate-400 whitespace-pre-wrap">
                                {task.description}
                              </p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                              {task.contactName || task.contactPhone ? (
                                <span>
                                  👤 Contact: <b className="text-slate-300">{task.contactName || task.contactPhone}</b>
                                  {task.contactPhone && (
                                    <a
                                      href={`https://wa.me/${task.contactPhone.replace(/\D/g, "")}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="ml-1 text-emerald-400 underline hover:text-emerald-300"
                                    >
                                      Chat on WA
                                    </a>
                                  )}
                                </span>
                              ) : null}
                              {task.dueDate && (
                                <span>
                                  📅 Due: <b className="text-amber-300">{new Date(task.dueDate).toLocaleString()}</b>
                                </span>
                              )}
                              <span>Created: {new Date(task.createdAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => void toggleTaskStatus(task)}
                            className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                              isCompleted
                                ? "border border-white/10 text-slate-400 hover:text-white"
                                : "bg-emerald-600/80 text-white hover:bg-emerald-500"
                            }`}
                          >
                            {isCompleted ? "Mark Pending" : "Mark Done ✓"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : inboxFilter === "invoices" ? (
            <div className="rounded-2xl border border-white/10 bg-ink-900/80 p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">Commercial Invoices & Quotations</h3>
                  <p className="text-xs text-slate-400">
                    PDF Quotations and Invoices generated via WhatsApp commands with automated 3-Step Follow-up Drip & Payment Reminders
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadInvoices()}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                >
                  🔄 Refresh
                </button>
              </div>

              {loadingInvoices ? (
                <div className="py-12 text-center text-sm text-slate-400">Loading invoices…</div>
              ) : invoices.length === 0 ? (
                <div className="rounded-xl border border-white/5 bg-black/20 py-12 text-center text-sm text-slate-400">
                  <p className="font-medium text-slate-300">No invoices or quotations created yet.</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Type a WhatsApp command like <span className="text-emerald-300">&quot;Send quotation to Rahul 9876543210 for ₹25000 Website Development&quot;</span> to create your first PDF quotation!
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {invoices.map((inv) => {
                    const isPaid = inv.status === "PAID";
                    const isOverdue = inv.status === "OVERDUE";
                    return (
                      <div
                        key={inv.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 p-4 transition-all hover:border-white/20"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-brand-500/20 px-2 py-0.5 text-xs font-mono font-bold text-brand-300">
                              #{inv.invoiceNumber}
                            </span>
                            <span className="text-sm font-semibold text-white">
                              {inv.clientName}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                isPaid
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : isOverdue
                                  ? "bg-rose-600/30 text-rose-300"
                                  : "bg-amber-500/20 text-amber-300"
                              }`}
                            >
                              {inv.status}
                            </span>
                            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300 uppercase">
                              {inv.kind}
                            </span>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                            <span>
                              💰 Total: <b className="text-white">₹{inv.total.toLocaleString("en-IN")}</b>
                            </span>
                            {inv.amountPaid > 0 && !isPaid && (
                              <span>Paid: ₹{inv.amountPaid.toLocaleString("en-IN")}</span>
                            )}
                            {inv.dueDate && (
                              <span>
                                📅 Due: <b className="text-amber-300">{new Date(inv.dueDate).toLocaleDateString("en-IN")}</b>
                              </span>
                            )}
                            <span>📞 {inv.clientPhone}</span>
                            <span>Created: {new Date(inv.createdAt).toLocaleDateString("en-IN")}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <a
                            href={`/api/v1/invoices/public/${inv.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 hover:text-white"
                          >
                            📄 Download PDF
                          </a>
                          <button
                            type="button"
                            onClick={() => void sendInvoiceWhatsApp(inv.id)}
                            className="rounded-lg bg-emerald-600/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                          >
                            📲 Send on WA
                          </button>
                          {!isPaid && (
                            <button
                              type="button"
                              onClick={() => void markInvoiceAsPaid(inv)}
                              className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-bold text-ink-950 hover:bg-brand-400"
                            >
                              ✓ Mark Paid
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
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
                          className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${
                            openId === c.id ? "border-brand-500/40 bg-brand-500/10" : "border-white/10 bg-ink-950/40 hover:border-white/20"
                          }`}
                        >
                          <div className="flex justify-between gap-2 text-white">
                            <span className="truncate font-medium">{c.contact?.name || c.phone}</span>
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">{c.status}</span>
                          </div>

                          {/* Work Categorization & Badges */}
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {c.leadStage === "HOT" && (
                              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                                🔥 HOT
                              </span>
                            )}
                            {c.leadStage === "WARM" && (
                              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                                ⚡ WARM
                              </span>
                            )}
                            {c.sentiment === "ANGRY" && (
                              <span className="rounded bg-red-600/30 px-1.5 py-0.5 text-[10px] font-bold text-red-300 animate-pulse">
                                🚨 ESCALATION
                              </span>
                            )}
                            {c.intent && (
                              <span className="rounded bg-brand-500/10 px-1.5 py-0.5 text-[10px] text-brand-300 font-medium">
                                {c.intent}
                              </span>
                            )}
                            {c.dealValue ? (
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                                ₹{c.dealValue.toLocaleString()}
                              </span>
                            ) : null}
                          </div>

                          <p className="mt-1 truncate text-xs text-slate-400">
                            {c.summary || c.messages?.[0]?.body || "No messages yet"}
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
                          {thread.leadStage === "HOT" && (
                            <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[11px] font-bold text-rose-300">
                              🔥 Hot Lead
                            </span>
                          )}
                          {thread.sentiment === "ANGRY" && (
                            <span className="rounded bg-red-600/30 px-2 py-0.5 text-[11px] font-bold text-red-300 animate-pulse">
                              🚨 Escalation
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>{thread.phone}</span>
                          {thread.optOut ? <span>· opted out</span> : null}
                          {thread.intent ? <span>· Intent: {thread.intent}</span> : null}
                          {thread.dealValue ? <span className="font-semibold text-emerald-400">· Deal: ₹{thread.dealValue.toLocaleString()}</span> : null}
                        </div>
                        {thread.summary ? (
                          <p className="mt-1 text-xs text-slate-300 italic">
                            💡 AI Summary: {thread.summary}
                          </p>
                        ) : null}
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
      )}
    </div>
  ) : null}
    </div>
  );
}
