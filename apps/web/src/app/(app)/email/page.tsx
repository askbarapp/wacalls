"use client";

import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  Loader2,
  Mail,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Sliders,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";

interface EmailStats {
  accountsCount: number;
  emailsToday: number;
  urgentToday: number;
  actionRequiredToday: number;
}

interface EmailAccount {
  id: string;
  label: string;
  email: string;
  fromName?: string | null;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapPassword?: string;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean;
  smtpUser?: string | null;
  smtpPassword?: string;
  syncEnabled: boolean;
  lastSyncAt?: string | null;
  lastError?: string | null;
  status: string;
  filterSenders: string[];
  filterDomains: string[];
  filterKeywords: string[];
  minPriority: string;
  aiFilterEnabled: boolean;
  targetPhone?: string | null;
  digestMode: string;
  channel?: { id: string; displayName: string; ownerPhone: string } | null;
}

interface EmailMessage {
  id: string;
  messageId: string;
  fromName?: string | null;
  fromEmail: string;
  toEmail: string;
  subject: string;
  bodyText?: string | null;
  date: string;
  priority: "URGENT" | "IMPORTANT" | "NORMAL" | "LOW";
  category: string;
  summary?: string | null;
  actionRequired: boolean;
  suggestedAction?: string | null;
  detectedDeadline?: string | null;
  attachments?: Array<{ filename: string; contentType: string; size: number }> | null;
  whatsappSent: boolean;
  notifiedAt?: string | null;
  replyDraft?: string | null;
  replyStatus: string;
  account?: { id: string; label: string; email: string } | null;
}

export default function EmailCommandCenterPage() {
  const [activeTab, setActiveTab] = useState<"stream" | "accounts" | "rules">("stream");
  const [stats, setStats] = useState<EmailStats>({
    accountsCount: 0,
    emailsToday: 0,
    urgentToday: 0,
    actionRequiredToday: 0,
  });
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // Filter states
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replySuccess, setReplySuccess] = useState(false);

  // New account form
  const [form, setForm] = useState({
    label: "Work Email",
    email: "",
    fromName: "",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    imapUser: "",
    imapPassword: "",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: "",
    smtpPassword: "",
    filterSendersStr: "",
    filterDomainsStr: "",
    filterKeywordsStr: "",
    minPriority: "IMPORTANT",
    aiFilterEnabled: true,
    targetPhone: "",
  });

  const [testingImap, setTestingImap] = useState(false);
  const [imapTestResult, setImapTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);

  // Load Data
  const loadData = useCallback(async () => {
    try {
      const [sRes, aRes, mRes] = await Promise.all([
        api<{ success: true; data: EmailStats }>("/api/v1/email/stats"),
        api<{ success: true; data: EmailAccount[] }>("/api/v1/email/accounts"),
        api<{ success: true; data: EmailMessage[] }>(
          `/api/v1/email/messages?priority=${priorityFilter}&category=${categoryFilter}&search=${encodeURIComponent(searchQuery)}`,
        ),
      ]);
      setStats(sRes.data);
      setAccounts(aRes.data);
      setMessages(mRes.data);
    } catch (err) {
      console.error("Failed to load email data", err);
    } finally {
      setLoading(false);
    }
  }, [priorityFilter, categoryFilter, searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync an account immediately
  async function handleSyncNow(id: string) {
    setSyncingId(id);
    try {
      await api(`/api/v1/email/accounts/${id}/sync`, { method: "POST" });
      await loadData();
    } catch (err: any) {
      alert(err?.message || "Sync failed");
    } finally {
      setSyncingId(null);
    }
  }

  // Delete account
  async function handleDeleteAccount(id: string) {
    if (!confirm("Are you sure you want to disconnect this email account?")) return;
    try {
      await api(`/api/v1/email/accounts/${id}`, { method: "DELETE" });
      await loadData();
    } catch (err: any) {
      alert(err?.message || "Failed to delete account");
    }
  }

  // Test IMAP
  async function handleTestImap() {
    setTestingImap(true);
    setImapTestResult(null);
    try {
      const res = await api<{ success: boolean; message: string }>("/api/v1/email/accounts/test-imap", {
        method: "POST",
        body: JSON.stringify({
          host: form.imapHost,
          port: Number(form.imapPort),
          secure: form.imapSecure,
          user: form.imapUser || form.email,
          password: form.imapPassword,
        }),
      });
      setImapTestResult(res);
    } catch (err: any) {
      setImapTestResult({ success: false, message: err?.message || "Connection failed" });
    } finally {
      setTestingImap(false);
    }
  }

  // Test SMTP
  async function handleTestSmtp() {
    setTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      const res = await api<{ success: boolean; message: string }>("/api/v1/email/accounts/test-smtp", {
        method: "POST",
        body: JSON.stringify({
          host: form.smtpHost,
          port: Number(form.smtpPort),
          secure: form.smtpSecure,
          user: form.smtpUser || form.email,
          password: form.smtpPassword || form.imapPassword,
        }),
      });
      setSmtpTestResult(res);
    } catch (err: any) {
      setSmtpTestResult({ success: false, message: err?.message || "Connection failed" });
    } finally {
      setTestingSmtp(false);
    }
  }

  // Save Account
  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault();
    setSavingAccount(true);
    try {
      const filterSenders = form.filterSendersStr
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const filterDomains = form.filterDomainsStr
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const filterKeywords = form.filterKeywordsStr
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      await api("/api/v1/email/accounts", {
        method: "POST",
        body: JSON.stringify({
          label: form.label,
          email: form.email,
          fromName: form.fromName || undefined,
          imapHost: form.imapHost,
          imapPort: Number(form.imapPort),
          imapSecure: form.imapSecure,
          imapUser: form.imapUser || form.email,
          imapPassword: form.imapPassword,
          smtpHost: form.smtpHost || undefined,
          smtpPort: form.smtpPort ? Number(form.smtpPort) : undefined,
          smtpSecure: form.smtpSecure,
          smtpUser: form.smtpUser || form.imapUser || form.email,
          smtpPassword: form.smtpPassword || form.imapPassword || undefined,
          filterSenders,
          filterDomains,
          filterKeywords,
          minPriority: form.minPriority,
          aiFilterEnabled: form.aiFilterEnabled,
          targetPhone: form.targetPhone || undefined,
        }),
      });

      setAccountModalOpen(false);
      await loadData();
    } catch (err: any) {
      alert(err?.message || "Failed to create email account");
    } finally {
      setSavingAccount(false);
    }
  }

  // Send Reply from Modal
  async function handleSendReply() {
    if (!selectedMessage || !replyText.trim()) return;
    setSendingReply(true);
    setReplySuccess(false);
    try {
      await api(`/api/v1/email/messages/${selectedMessage.id}/reply`, {
        method: "POST",
        body: JSON.stringify({ textBody: replyText }),
      });
      setReplySuccess(true);
      await loadData();
      setTimeout(() => {
        setSelectedMessage(null);
        setReplySuccess(false);
      }, 1500);
    } catch (err: any) {
      alert(err?.message || "Failed to send email reply via SMTP");
    } finally {
      setSendingReply(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              Email Command Center
            </h1>
            <span className="rounded-md bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-300 border border-violet-500/30">
              WaCall OS
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            AI-powered email intelligence inside WhatsApp. Never open your email client for critical updates.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => loadData()}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setAccountModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-600/20 transition-all hover:bg-violet-500 active:scale-95"
          >
            <Plus className="h-4 w-4" />
            Connect Email Account
          </button>
        </div>
      </div>

      {/* Top Analytics Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Connected Accounts</span>
            <Mail className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white">{stats.accountsCount}</div>
          <div className="mt-1 text-[11px] text-slate-500">Active IMAP/SMTP mailboxes</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Processed Today</span>
            <Sparkles className="h-4 w-4 text-violet-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white">{stats.emailsToday}</div>
          <div className="mt-1 text-[11px] text-slate-500">Scanned &amp; summarized by AI</div>
        </div>

        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-rose-300">Urgent Emails</span>
            <ShieldAlert className="h-4 w-4 text-rose-400 animate-pulse" />
          </div>
          <div className="mt-2 text-2xl font-bold text-rose-200">{stats.urgentToday}</div>
          <div className="mt-1 text-[11px] text-rose-400/80">Payments, outages, escalations</div>
        </div>

        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-amber-300">Action Required</span>
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-200">{stats.actionRequiredToday}</div>
          <div className="mt-1 text-[11px] text-amber-400/80">Pending meetings &amp; approvals</div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-white/10 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab("stream")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-medium transition-colors ${
            activeTab === "stream"
              ? "border-violet-500 text-violet-400"
              : "border-transparent text-slate-400 hover:text-white"
          }`}
        >
          <Mail className="h-4 w-4" />
          Live Feed &amp; Intelligence ({messages.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("accounts")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-medium transition-colors ${
            activeTab === "accounts"
              ? "border-violet-500 text-violet-400"
              : "border-transparent text-slate-400 hover:text-white"
          }`}
        >
          <Sliders className="h-4 w-4" />
          Connected Accounts ({accounts.length})
        </button>
      </div>

      {/* TAB 1: Live Feed */}
      {activeTab === "stream" && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-3">
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/60 px-2.5 py-1 text-xs text-white"
              >
                <option value="ALL">All Priorities</option>
                <option value="URGENT">🔴 Urgent Only</option>
                <option value="IMPORTANT">⚡ Important Only</option>
                <option value="NORMAL">Normal</option>
              </select>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/60 px-2.5 py-1 text-xs text-white"
              >
                <option value="ALL">All Categories</option>
                <option value="PAYMENT">💰 Payment</option>
                <option value="INVOICE">📄 Invoice</option>
                <option value="MEETING">📅 Meeting</option>
                <option value="TASK">📌 Task</option>
                <option value="CLIENT_INQUIRY">👥 Client</option>
              </select>
            </div>

            <input
              type="text"
              placeholder="Search sender, subject, or AI summary..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-64 rounded-lg border border-white/10 bg-black/60 px-3 py-1 text-xs text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
            />
          </div>

          {/* Email Messages List */}
          {loading ? (
            <div className="flex h-64 items-center justify-center text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 p-12 text-center">
              <Mail className="mb-3 h-10 w-10 text-slate-600" />
              <h3 className="text-sm font-semibold text-white">No emails synced yet</h3>
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                Connect your Gmail or IMAP mailbox using the button above. WaCall will monitor incoming emails and send actionable alerts to your WhatsApp line.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => {
                const isUrgent = msg.priority === "URGENT";
                const isImportant = msg.priority === "IMPORTANT";
                return (
                  <div
                    key={msg.id}
                    onClick={() => {
                      setSelectedMessage(msg);
                      setReplyText(msg.replyDraft || "");
                    }}
                    className={`group cursor-pointer rounded-2xl border p-4 transition-all hover:scale-[1.005] ${
                      isUrgent
                        ? "border-rose-500/40 bg-rose-950/10 hover:border-rose-500/60"
                        : isImportant
                        ? "border-amber-500/30 bg-amber-950/10 hover:border-amber-500/50"
                        : "border-white/10 bg-black/40 hover:border-white/20"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base ${
                            isUrgent
                              ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                              : isImportant
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-white/5 text-slate-400"
                          }`}
                        >
                          {msg.category === "PAYMENT"
                            ? "💰"
                            : msg.category === "INVOICE"
                            ? "📄"
                            : msg.category === "MEETING"
                            ? "📅"
                            : msg.category === "TASK"
                            ? "📌"
                            : "✉️"}
                        </div>

                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-white">
                              {msg.fromName ? `${msg.fromName} (${msg.fromEmail})` : msg.fromEmail}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                isUrgent
                                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                  : isImportant
                                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                  : "bg-white/10 text-slate-300"
                              }`}
                            >
                              {msg.priority}
                            </span>
                            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">
                              {msg.category}
                            </span>
                            {msg.whatsappSent && (
                              <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                                <CheckCircle2 className="h-3 w-3" /> WhatsApp Sent
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-sm font-medium text-slate-200">{msg.subject}</div>
                        </div>
                      </div>

                      <div className="text-right text-[11px] text-slate-500 shrink-0">
                        {new Date(msg.date).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>

                    {/* AI Executive Summary */}
                    {msg.summary && (
                      <div className="mt-3 rounded-xl border border-white/5 bg-black/50 p-3 text-xs text-slate-300">
                        <div className="flex items-center gap-1.5 font-semibold text-violet-300 mb-1 text-[11px]">
                          <Sparkles className="h-3.5 w-3.5" />
                          AI Summary &amp; Context:
                        </div>
                        <div className="whitespace-pre-line text-slate-300 text-[11px] leading-relaxed">
                          {msg.summary}
                        </div>

                        {msg.suggestedAction && (
                          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-200 border border-amber-500/20">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                            <span>
                              <b>Action Required:</b> {msg.suggestedAction}
                            </span>
                          </div>
                        )}

                        {msg.detectedDeadline && (
                          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                            <Clock className="h-3 w-3 text-slate-400" />
                            <span>
                              <b>Deadline / Time:</b>{" "}
                              {new Date(msg.detectedDeadline).toLocaleString("en-IN", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Footer Badges & Actions */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5 text-[11px] text-slate-400">
                      <div className="flex items-center gap-2">
                        {msg.attachments && msg.attachments.length > 0 && (
                          <span className="flex items-center gap-1 text-slate-400">
                            <Paperclip className="h-3 w-3" />
                            {msg.attachments.length} attachment(s)
                          </span>
                        )}
                        {msg.replyStatus === "SENT" && (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                            ✓ Reply Dispatched
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-violet-400 group-hover:text-violet-300 font-medium">
                        <span>View Details &amp; Reply</span>
                        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Connected Accounts */}
      {activeTab === "accounts" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Configured Email Mailboxes</h2>
            <button
              type="button"
              onClick={() => setAccountModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Mailbox
            </button>
          </div>

          {accounts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-xs text-slate-400">
              No email accounts connected yet. Click &quot;Add Mailbox&quot; above to connect your Gmail or corporate IMAP account.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">{acc.label}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                            acc.status === "CONNECTED"
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          }`}
                        >
                          {acc.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 font-mono mt-0.5">{acc.email}</div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={syncingId === acc.id}
                        onClick={() => handleSyncNow(acc.id)}
                        className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                        title="Sync Now"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${syncingId === acc.id ? "animate-spin" : ""}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAccount(acc.id)}
                        className="rounded p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
                        title="Delete Account"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-2 border-t border-white/5">
                    <div>
                      <span className="text-slate-500 block">IMAP Host:</span>
                      <span className="text-white font-mono text-[10px]">{acc.imapHost}:{acc.imapPort}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">WhatsApp Routing:</span>
                      <span className="text-white">{acc.targetPhone || "Channel Owner"}</span>
                    </div>
                  </div>

                  {/* Filter Pills */}
                  <div className="space-y-1 text-[11px]">
                    <div className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold">3-Level Filter:</div>
                    <div className="flex flex-wrap gap-1">
                      <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                        Priority: {acc.minPriority}
                      </span>
                      {acc.filterSenders.length > 0 && (
                        <span className="rounded bg-violet-500/20 px-2 py-0.5 text-[10px] text-violet-300">
                          {acc.filterSenders.length} Allowed Senders
                        </span>
                      )}
                      {acc.filterDomains.length > 0 && (
                        <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] text-cyan-300">
                          {acc.filterDomains.length} Domains
                        </span>
                      )}
                    </div>
                  </div>

                  {acc.lastError && (
                    <div className="rounded-lg bg-rose-500/10 p-2 text-[10px] text-rose-300 border border-rose-500/20">
                      Error: {acc.lastError}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL: Connect Email Account */}
      {accountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-xl rounded-2xl border border-white/15 bg-ink-900 p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Connect Email Account</h3>
                <p className="text-xs text-slate-400">
                  Connect via IMAP &amp; SMTP. For Gmail, use an <b>App Password</b>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAccountModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAccount} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="font-semibold text-slate-300">Account Label</span>
                  <input
                    type="text"
                    required
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    placeholder="e.g. Work Gmail, Accounts Mail"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/60 p-2 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-300">Email Address</span>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="you@company.com"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/60 p-2 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
                  />
                </label>
              </div>

              {/* IMAP Settings Section */}
              <div className="rounded-xl border border-white/10 bg-black/40 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-violet-300 uppercase tracking-wider text-[10px]">
                    1. Incoming Mail (IMAP Server)
                  </span>
                  <button
                    type="button"
                    disabled={testingImap || !form.email || !form.imapPassword}
                    onClick={handleTestImap}
                    className="rounded bg-violet-600/30 px-2 py-1 text-[10px] font-bold text-violet-200 hover:bg-violet-600/50 transition-colors disabled:opacity-50"
                  >
                    {testingImap ? "Testing..." : "Test IMAP Handshake"}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <label className="col-span-2 block">
                    <span className="text-slate-400">IMAP Host</span>
                    <input
                      type="text"
                      required
                      value={form.imapHost}
                      onChange={(e) => setForm({ ...form, imapHost: e.target.value })}
                      placeholder="imap.gmail.com"
                      className="mt-0.5 w-full rounded border border-white/10 bg-black/60 p-1.5 text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="text-slate-400">Port</span>
                    <input
                      type="number"
                      required
                      value={form.imapPort}
                      onChange={(e) => setForm({ ...form, imapPort: parseInt(e.target.value) || 993 })}
                      className="mt-0.5 w-full rounded border border-white/10 bg-black/60 p-1.5 text-white text-center"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-slate-400">Username</span>
                    <input
                      type="text"
                      value={form.imapUser || form.email}
                      onChange={(e) => setForm({ ...form, imapUser: e.target.value })}
                      placeholder="Email username"
                      className="mt-0.5 w-full rounded border border-white/10 bg-black/60 p-1.5 text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="text-slate-400">Password / App Password</span>
                    <input
                      type="password"
                      required
                      value={form.imapPassword}
                      onChange={(e) => setForm({ ...form, imapPassword: e.target.value })}
                      placeholder="••••••••"
                      className="mt-0.5 w-full rounded border border-white/10 bg-black/60 p-1.5 text-white"
                    />
                  </label>
                </div>

                {imapTestResult && (
                  <div
                    className={`rounded-lg p-2 text-[11px] font-medium border ${
                      imapTestResult.success
                        ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-300 border-rose-500/20"
                    }`}
                  >
                    {imapTestResult.success ? "✓ " : "✕ "}
                    {imapTestResult.message}
                  </div>
                )}
              </div>

              {/* SMTP Settings Section */}
              <div className="rounded-xl border border-white/10 bg-black/40 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-violet-300 uppercase tracking-wider text-[10px]">
                    2. Outgoing Replies (SMTP Server)
                  </span>
                  <button
                    type="button"
                    disabled={testingSmtp || !form.email}
                    onClick={handleTestSmtp}
                    className="rounded bg-violet-600/30 px-2 py-1 text-[10px] font-bold text-violet-200 hover:bg-violet-600/50 transition-colors disabled:opacity-50"
                  >
                    {testingSmtp ? "Testing..." : "Test SMTP Handshake"}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <label className="col-span-2 block">
                    <span className="text-slate-400">SMTP Host</span>
                    <input
                      type="text"
                      value={form.smtpHost}
                      onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
                      placeholder="smtp.gmail.com"
                      className="mt-0.5 w-full rounded border border-white/10 bg-black/60 p-1.5 text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="text-slate-400">Port</span>
                    <input
                      type="number"
                      value={form.smtpPort}
                      onChange={(e) => setForm({ ...form, smtpPort: parseInt(e.target.value) || 465 })}
                      className="mt-0.5 w-full rounded border border-white/10 bg-black/60 p-1.5 text-white text-center"
                    />
                  </label>
                </div>

                {smtpTestResult && (
                  <div
                    className={`rounded-lg p-2 text-[11px] font-medium border ${
                      smtpTestResult.success
                        ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-300 border-rose-500/20"
                    }`}
                  >
                    {smtpTestResult.success ? "✓ " : "✕ "}
                    {smtpTestResult.message}
                  </div>
                )}
              </div>

              {/* 3-Level Filter Configuration */}
              <div className="rounded-xl border border-white/10 bg-black/40 p-3 space-y-3">
                <span className="font-bold text-amber-300 uppercase tracking-wider text-[10px]">
                  3. Intelligence &amp; 3-Level Filter Rules
                </span>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-slate-400">Allowed Senders (Comma separated)</span>
                    <input
                      type="text"
                      value={form.filterSendersStr}
                      onChange={(e) => setForm({ ...form, filterSendersStr: e.target.value })}
                      placeholder="accounts@abc.com, hr@xyz.com"
                      className="mt-0.5 w-full rounded border border-white/10 bg-black/60 p-1.5 text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="text-slate-400">Allowed Domains (Comma separated)</span>
                    <input
                      type="text"
                      value={form.filterDomainsStr}
                      onChange={(e) => setForm({ ...form, filterDomainsStr: e.target.value })}
                      placeholder="@company.com, @client.com"
                      className="mt-0.5 w-full rounded border border-white/10 bg-black/60 p-1.5 text-white"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-slate-400">Min WhatsApp Priority Required</span>
                    <select
                      value={form.minPriority}
                      onChange={(e) => setForm({ ...form, minPriority: e.target.value })}
                      className="mt-0.5 w-full rounded border border-white/10 bg-black/60 p-1.5 text-white"
                    >
                      <option value="IMPORTANT">⚡ Important &amp; Urgent (Recommended)</option>
                      <option value="URGENT">🔴 Urgent Only</option>
                      <option value="ALL">All Emails</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-slate-400">Target WhatsApp Line (Optional)</span>
                    <input
                      type="text"
                      value={form.targetPhone}
                      onChange={(e) => setForm({ ...form, targetPhone: e.target.value })}
                      placeholder="e.g. +919876543210"
                      className="mt-0.5 w-full rounded border border-white/10 bg-black/60 p-1.5 text-white"
                    />
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setAccountModalOpen(false)}
                  className="rounded-lg px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAccount}
                  className="rounded-lg bg-violet-600 px-5 py-2 font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50"
                >
                  {savingAccount ? "Connecting..." : "Save &amp; Activate Mailbox"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: View Email & Reply */}
      {selectedMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl border border-white/15 bg-ink-900 p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-start justify-between border-b border-white/10 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      selectedMessage.priority === "URGENT"
                        ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                        : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    }`}
                  >
                    {selectedMessage.priority}
                  </span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold text-slate-300">
                    {selectedMessage.category}
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mt-1">{selectedMessage.subject}</h3>
                <div className="text-xs text-slate-400 mt-0.5">
                  From: <b>{selectedMessage.fromName || selectedMessage.fromEmail}</b> &lt;{selectedMessage.fromEmail}&gt;
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedMessage(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* AI Executive Summary */}
            {selectedMessage.summary && (
              <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-violet-300">
                  <Sparkles className="h-4 w-4" /> AI Summary &amp; Decision Items:
                </div>
                <div className="whitespace-pre-line text-slate-200 text-xs leading-relaxed">
                  {selectedMessage.summary}
                </div>
                {selectedMessage.suggestedAction && (
                  <div className="mt-2 text-amber-300 font-medium">
                    ⚠️ Action Item: {selectedMessage.suggestedAction}
                  </div>
                )}
              </div>
            )}

            {/* Email Body Content */}
            <div className="max-h-60 overflow-y-auto rounded-xl border border-white/10 bg-black/50 p-3 text-xs text-slate-300 leading-relaxed font-sans whitespace-pre-line">
              {selectedMessage.bodyText || "(No plain text content)"}
            </div>

            {/* Quick Reply Form */}
            <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Send className="h-3.5 w-3.5 text-violet-400" />
                  Reply via SMTP ({selectedMessage.fromEmail})
                </span>
                <span className="text-[10px] text-slate-400">Requires human approval before sending</span>
              </div>

              <textarea
                rows={4}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Type your reply or edit AI draft here..."
                className="w-full rounded-xl border border-white/10 bg-black/60 p-3 text-xs text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
              />

              {replySuccess && (
                <div className="rounded-lg bg-emerald-500/20 p-2 text-xs font-semibold text-emerald-300">
                  ✓ Email reply sent successfully via SMTP!
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSelectedMessage(null)}
                  className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={sendingReply || !replyText.trim()}
                  onClick={handleSendReply}
                  className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 transition-colors disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  {sendingReply ? "Sending via SMTP..." : "Approve &amp; Send Reply"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
