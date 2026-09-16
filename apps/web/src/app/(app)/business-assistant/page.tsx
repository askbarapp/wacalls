"use client";

import { Suspense, useEffect, useState } from "react";
import {
  Sparkles,
  Users,
  Clock,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Shield,
  Phone,
  Briefcase,
  SunMedium,
  Moon,
  Save,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";

type Role =
  | "OWNER"
  | "MANAGER"
  | "SUPERVISOR"
  | "EXECUTIVE"
  | "SALES_MANAGER"
  | "ACCOUNTS"
  | "SUPPORT";

type CommanderMember = {
  id: string;
  channelId: string;
  name: string;
  phone: string;
  role: Role;
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

type BusinessProfile = {
  id?: string;
  businessName?: string;
  assistantName: string;
  morningSlot: string;
  morningEnabled: boolean;
  eodSlot: string;
  eodEnabled: boolean;
  middaySlot: string;
  middayEnabled: boolean;
  language: string;
  reportMetrics?: {
    calls?: boolean;
    tasks?: boolean;
    leads?: boolean;
    invoices?: boolean;
    missedFollowups?: boolean;
  };
};

const ROLE_INFO: Record<Role, { label: string; color: string; desc: string }> = {
  OWNER: {
    label: "Owner / Founder",
    color: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    desc: "Full Master Access: Executive briefings, financial metrics, hot leads, creative studio & team delegation.",
  },
  MANAGER: {
    label: "Manager",
    color: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
    desc: "Team Supervision: Assigns tasks, reviews team schedules, receives department morning & EOD reports.",
  },
  SUPERVISOR: {
    label: "Supervisor",
    color: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    desc: "Operational Oversight: Monitors team follow-ups, pending customer tickets, and task statuses.",
  },
  EXECUTIVE: {
    label: "Executive / Staff",
    color: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    desc: "Private Staff Mode: Sees only their personal assigned tasks & reminders. Zero company confidential data.",
  },
  SALES_MANAGER: {
    label: "Sales Specialist",
    color: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    desc: "Lead Pipeline: Instant hot lead alerts, quotation generation, and customer follow-up actions.",
  },
  ACCOUNTS: {
    label: "Accounts & Finance",
    color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    desc: "Financial Assistant: Invoices, payment receipts, pending payment reminders & customer payment confirmations.",
  },
  SUPPORT: {
    label: "Customer Support",
    color: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    desc: "Desk Support: Missed call notifications, handoffs from AI, and unresolved customer inquiry routing.",
  },
};

const TABS = [
  { id: "team", label: "AI Team & WhatsApp Hierarchy", icon: Users },
  { id: "persona", label: "Assistant Persona & Briefings", icon: Clock },
  { id: "cheatsheet", label: "WhatsApp Commands Cheatsheet", icon: BookOpen },
] as const;

type ActiveTab = (typeof TABS)[number]["id"];

export default function BusinessAssistantPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading Business Assistant…</div>}>
      <BusinessAssistantContent />
    </Suspense>
  );
}

function BusinessAssistantContent() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState<string>("");
  const [ownerPhone, setOwnerPhone] = useState<string>("");
  const [savingOwnerPhone, setSavingOwnerPhone] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("team");
  const [commanders, setCommanders] = useState<CommanderMember[]>([]);
  const [, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Profile & Persona state
  const [profile, setProfile] = useState<BusinessProfile>({
    assistantName: "TenSy",
    morningSlot: "09:00",
    morningEnabled: true,
    eodSlot: "20:00",
    eodEnabled: true,
    middaySlot: "14:00",
    middayEnabled: false,
    language: "Hindi + English",
    reportMetrics: {
      calls: true,
      tasks: true,
      leads: true,
      invoices: true,
      missedFollowups: true,
    },
  });

  // Add Member State
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRole, setNewRole] = useState<Role>("EXECUTIVE");
  const [newMorning, setNewMorning] = useState(true);
  const [newEod, setNewEod] = useState(true);
  const [newAlert, setNewAlert] = useState(true);

  useEffect(() => {
    loadInitial();
  }, []);

  useEffect(() => {
    if (channelId) {
      loadChannelData(channelId);
      const ch = channels.find((c) => c.id === channelId);
      if (ch) {
        setOwnerPhone(ch.ownerPhone || "");
      }
    }
  }, [channelId]);

  async function loadInitial() {
    setLoading(true);
    try {
      const res = await api<{ items: Channel[] }>("/api/v1/channels");
      const chList = res.items || [];
      setChannels(chList);
      if (chList.length > 0) {
        setChannelId(chList[0].id);
        setOwnerPhone(chList[0].ownerPhone || "");
      }
    } catch (e: any) {
      setFeedback({ type: "error", text: e?.message || "Failed to load channels" });
    } finally {
      setLoading(false);
    }
  }

  async function loadChannelData(cid: string) {
    try {
      // Load Commanders
      const cmdRes = await api<{ success: true; data: CommanderMember[] }>(
        `/api/v1/chatbots/commanders?channelId=${cid}`
      );
      setCommanders(cmdRes.data || []);

      // Load Profile
      const profRes = await api<{ success: true; data: any }>(
        `/api/v1/creative/profile?channelId=${cid}`
      );
      if (profRes.data) {
        const d = profRes.data;
        setProfile({
          id: d.id,
          businessName: d.businessName || "",
          assistantName: d.assistantName || "TenSy",
          morningSlot: d.morningSlot || "09:00",
          morningEnabled: d.morningEnabled ?? true,
          eodSlot: d.eodSlot || "20:00",
          eodEnabled: d.eodEnabled ?? true,
          middaySlot: d.middaySlot || "14:00",
          middayEnabled: d.middayEnabled ?? false,
          language: d.language || "Hindi + English",
          reportMetrics: d.reportMetrics || {
            calls: true,
            tasks: true,
            leads: true,
            invoices: true,
            missedFollowups: true,
          },
        });
      }
    } catch {
      /* ignore */
    }
  }

  async function handleSaveOwnerPhone() {
    if (!channelId) return;
    setSavingOwnerPhone(true);
    setFeedback(null);
    try {
      await api(`/api/v1/channels/${channelId}`, {
        method: "PATCH",
        body: JSON.stringify({ ownerPhone: ownerPhone.trim() || null }),
      });
      setChannels((prev) =>
        prev.map((c) => (c.id === channelId ? { ...c, ownerPhone: ownerPhone.trim() || null } : c))
      );
      setFeedback({ type: "success", text: "Primary Owner WhatsApp Line saved successfully!" });
    } catch (e: any) {
      setFeedback({ type: "error", text: e?.message || "Failed to save Owner Line" });
    } finally {
      setSavingOwnerPhone(false);
    }
  }

  async function handleSaveProfile() {
    setSaving(true);
    setFeedback(null);
    try {
      await api("/api/v1/creative/profile", {
        method: "PUT",
        body: JSON.stringify({
          channelId: channelId || null,
          businessName: profile.businessName || "My Business",
          assistantName: profile.assistantName.trim() || "TenSy",
          morningSlot: profile.morningSlot,
          morningEnabled: profile.morningEnabled,
          eodSlot: profile.eodSlot,
          eodEnabled: profile.eodEnabled,
          middaySlot: profile.middaySlot,
          middayEnabled: profile.middayEnabled,
          language: profile.language,
          reportMetrics: profile.reportMetrics,
        }),
      });
      setFeedback({ type: "success", text: "TenSy assistant settings updated successfully!" });
    } catch (e: any) {
      setFeedback({ type: "error", text: e?.message || "Failed to update settings" });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCommander() {
    if (!channelId || !newName.trim() || !newPhone.trim()) {
      setFeedback({ type: "error", text: "Please enter member name and WhatsApp number." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const res = await api<{ success: true; data: CommanderMember }>("/api/v1/chatbots/commanders", {
        method: "POST",
        body: JSON.stringify({
          channelId,
          name: newName.trim(),
          phone: newPhone.trim(),
          role: newRole,
          dailyMorning: newMorning,
          dailyEod: newEod,
          missedAlert: newAlert,
        }),
      });
      if (res.data) {
        setCommanders((prev) => {
          const filtered = prev.filter((m) => m.id !== res.data.id && m.phone !== res.data.phone);
          return [...filtered, res.data];
        });
        setNewName("");
        setNewPhone("");
        setIsAdding(false);
        setFeedback({
          type: "success",
          text: `${res.data.name} (${ROLE_INFO[res.data.role].label}) added to WhatsApp Team!`,
        });
      }
    } catch (e: any) {
      setFeedback({ type: "error", text: e?.message || "Failed to add team member" });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleCommander(cmd: CommanderMember) {
    try {
      const res = await api<{ success: true; data: CommanderMember }>(
        `/api/v1/chatbots/commanders/${cmd.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled: !cmd.enabled }),
        }
      );
      setCommanders((prev) => prev.map((m) => (m.id === cmd.id ? res.data : m)));
    } catch (e: any) {
      setFeedback({ type: "error", text: e?.message || "Failed to toggle status" });
    }
  }

  async function handleDeleteCommander(id: string) {
    if (!confirm("Remove this member from TenSy AI WhatsApp hierarchy?")) return;
    try {
      await api(`/api/v1/chatbots/commanders/${id}`, { method: "DELETE" });
      setCommanders((prev) => prev.filter((m) => m.id !== id));
      setFeedback({ type: "success", text: "Team member removed." });
    } catch (e: any) {
      setFeedback({ type: "error", text: e?.message || "Failed to delete member" });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      {/* Page Header */}
      <PageHeader
        title="Business Assistant (TenSy)"
        subtitle="Your autonomous executive assistant. Configure assistant persona, executive morning & EOD briefings, and assign WhatsApp roles to your team members."
        actions={
          channels.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-400">Channel:</span>
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="rounded-lg border border-white/10 bg-slate-900/90 px-3 py-1.5 text-xs text-white shadow-sm focus:border-amber-400/50 focus:outline-none"
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName || "WhatsApp Line"} ({c.status})
                  </option>
                ))}
              </select>
            </div>
          ) : undefined
        }
      />

      {/* Banner / TenSy Active Status */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-950/40 via-slate-900/80 to-purple-950/40 p-5 shadow-lg backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-400 text-slate-950 shadow-md shadow-amber-500/20">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide">
                  {profile.assistantName || "TenSy"} Executive Business AI
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Active & Listening
                </span>
              </div>
              <p className="text-xs text-slate-300">
                WaCalls OS automatically personalizes interactions on WhatsApp: Employees see their individual tasks, while Owners receive strategic executive briefings.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-right">
              <div className="text-[11px] text-slate-400 font-medium">Connected Team</div>
              <div className="text-sm font-bold text-amber-300">
                {commanders.filter((c) => c.enabled).length + (ownerPhone ? 1 : 0)} Active Members
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Feedback Toast */}
      {feedback && (
        <div
          className={`flex items-center justify-between rounded-xl border p-3.5 text-xs ${
            feedback.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-white/10 pb-px">
        <div className="flex gap-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-xs font-semibold transition-all ${
                  active
                    ? "border-b-2 border-amber-400 bg-white/5 text-amber-300 shadow-sm"
                    : "text-slate-400 hover:bg-white/[0.02] hover:text-slate-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: AI Team & WhatsApp Hierarchy */}
      {activeTab === "team" && (
        <div className="space-y-6">
          {/* 1. PRIMARY OWNER WHATSAPP LINE */}
          <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-slate-900/90 to-slate-950 p-5 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-amber-300">👑 1. Primary Owner WhatsApp Line</span>
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 uppercase tracking-wide">
                    Master Access
                  </span>
                </div>
                <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
                  Send direct commands to TenSy from this personal phone number, or use <b>Self-Chat</b> on your connected WhatsApp business line. Has full master access to all financials, call reports, creative posters, and team task delegations.
                </p>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  placeholder="e.g. 918800101513"
                  className="w-full sm:w-60 rounded-lg border border-white/10 bg-slate-950 px-3.5 py-2 text-xs font-mono text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveOwnerPhone}
                  disabled={savingOwnerPhone}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors shrink-0 shadow-sm"
                >
                  <Save className="h-3.5 w-3.5" />
                  {savingOwnerPhone ? "Saving..." : "Save Line"}
                </button>
              </div>
            </div>
          </div>

          {/* 2. AUTHORIZED TEAM COMMANDER LINES (HIERARCHY) */}
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Shield className="h-4 w-4 text-amber-400" />
                  2. Authorized Team Commander Lines &amp; Hierarchy
                </h3>
                <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                  Connect WhatsApp numbers of your employees or department heads. TenSy intelligently isolates information:
                  when staff (e.g., Amit) texts <span className="text-amber-300 font-mono">&quot;Today task&quot;</span>, TenSy answers privately with only Amit&apos;s assigned tasks. Company financials and owner commands remain strictly protected.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAdding(!isAdding)}
                className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                {isAdding ? "Cancel" : "+ Add Team Member"}
              </button>
            </div>

            {/* Add Member Form */}
            {isAdding && (
              <div className="mt-4 rounded-xl border border-amber-500/20 bg-slate-950/70 p-4 space-y-4">
                <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Add New WhatsApp Team Line
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      Member Name / Alias (e.g. Amit, Rahul)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Amit Sharma"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-400/60 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      WhatsApp Number (with country code)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. +91 98765 43210"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-400/60 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      Operational Role
                    </label>
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as Role)}
                      className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-white focus:border-amber-400/60 focus:outline-none"
                    >
                      <option value="OWNER">Owner / Founder (Full Access)</option>
                      <option value="MANAGER">Manager (Team Supervision)</option>
                      <option value="SUPERVISOR">Supervisor (Operations)</option>
                      <option value="EXECUTIVE">Executive / Staff (Private Tasks)</option>
                      <option value="SALES_MANAGER">Sales Specialist (Leads & Quotes)</option>
                      <option value="ACCOUNTS">Accounts & Finance (Payments & Invoices)</option>
                      <option value="SUPPORT">Customer Support (Tickets & Alerts)</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-white/5">
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newMorning}
                        onChange={(e) => setNewMorning(e.target.checked)}
                        className="rounded border-white/10 bg-slate-900 text-amber-500 focus:ring-0"
                      />
                      <span>🌅 Morning Briefing</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newEod}
                        onChange={(e) => setNewEod(e.target.checked)}
                        className="rounded border-white/10 bg-slate-900 text-amber-500 focus:ring-0"
                      />
                      <span>🌙 EOD Summary</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newAlert}
                        onChange={(e) => setNewAlert(e.target.checked)}
                        className="rounded border-white/10 bg-slate-900 text-amber-500 focus:ring-0"
                      />
                      <span>🚨 Missed Call Alerts</span>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddCommander}
                    disabled={saving}
                    className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Adding..." : "Save Member Line"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Members List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <span>Registered WhatsApp Lines ({commanders.length})</span>
              <span>Individual role filters apply automatically</span>
            </div>

            {commanders.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-8 text-center">
                <Users className="mx-auto h-8 w-8 text-slate-600 mb-2" />
                <div className="text-sm font-medium text-slate-300">No Team Members Added Yet</div>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Add your manager, executive, supervisor, or accounts numbers above so TenSy can coordinate business tasks with them directly on WhatsApp.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {commanders.map((cmd) => {
                  const roleConfig = ROLE_INFO[cmd.role] || ROLE_INFO.EXECUTIVE;
                  return (
                    <div
                      key={cmd.id}
                      className="group relative rounded-xl border border-white/10 bg-slate-900/70 p-4 transition-all hover:border-white/20 hover:bg-slate-900/90 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-white">{cmd.name}</span>
                            <span
                              className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${roleConfig.color}`}
                            >
                              {roleConfig.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                            <Phone className="h-3 w-3 text-slate-500" />
                            <span>{cmd.phone}</span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                            {roleConfig.desc}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col items-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleCommander(cmd)}
                            className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                              cmd.enabled
                                ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                            }`}
                          >
                            {cmd.enabled ? "Active" : "Disabled"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCommander(cmd.id)}
                            className="rounded p-1 text-slate-500 hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
                            title="Remove from WhatsApp Team"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Briefing Toggles Indicators */}
                      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400">
                        <div className="flex items-center gap-3">
                          <span
                            className={cmd.dailyMorning ? "text-amber-300 font-medium" : "text-slate-600"}
                            title="Morning Executive Briefing"
                          >
                            🌅 Morning: {cmd.dailyMorning ? "ON" : "OFF"}
                          </span>
                          <span
                            className={cmd.dailyEod ? "text-indigo-300 font-medium" : "text-slate-600"}
                            title="EOD Summary Report"
                          >
                            🌙 EOD: {cmd.dailyEod ? "ON" : "OFF"}
                          </span>
                          <span
                            className={cmd.missedAlert ? "text-rose-300 font-medium" : "text-slate-600"}
                            title="Instant Missed Call Alert"
                          >
                            🚨 Alert: {cmd.missedAlert ? "ON" : "OFF"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Assistant Persona & Briefings */}
      {activeTab === "persona" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-5 space-y-6">
            {/* Persona Customization */}
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                Assistant Persona &amp; Identity
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Customize what your AI assistant calls itself when greeting commanders and processing tasks on WhatsApp.
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    AI Assistant Name
                  </label>
                  <input
                    type="text"
                    value={profile.assistantName}
                    onChange={(e) => setProfile({ ...profile, assistantName: e.target.value })}
                    placeholder="TenSy"
                    className="w-full rounded-lg border border-white/10 bg-slate-950 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-400/60 focus:outline-none"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Default: <span className="text-amber-300 font-medium">TenSy</span>. You can rename it to your preferred company agent persona.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Interaction Language Tone
                  </label>
                  <select
                    value={profile.language}
                    onChange={(e) => setProfile({ ...profile, language: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-amber-400/60 focus:outline-none"
                  >
                    <option value="Hindi + English">Bilingual (Hinglish / Hindi + English)</option>
                    <option value="Pure Hindi">Shuddh Hindi (हिंदी)</option>
                    <option value="Professional English">Professional English</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Briefing Schedules */}
            <div className="pt-5 border-t border-white/5 space-y-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-400" />
                Executive Briefing Slots (IST)
              </h3>
              <p className="text-xs text-slate-400">
                {profile.assistantName || "TenSy"} compiles and pings team members on WhatsApp at these exact hours with prioritized summaries.
              </p>

              <div className="grid gap-4 sm:grid-cols-3">
                {/* Morning Slot */}
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                      <SunMedium className="h-4 w-4 text-amber-400" />
                      Morning Briefing
                    </div>
                    <input
                      type="checkbox"
                      checked={profile.morningEnabled}
                      onChange={(e) => setProfile({ ...profile, morningEnabled: e.target.checked })}
                      className="rounded border-white/10 bg-slate-900 text-amber-500 focus:ring-0"
                    />
                  </div>
                  <input
                    type="time"
                    value={profile.morningSlot}
                    onChange={(e) => setProfile({ ...profile, morningSlot: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-white focus:border-amber-400/60 focus:outline-none font-mono"
                  />
                  <p className="text-[10px] text-slate-400">
                    Delivers today&apos;s scheduled tasks, priority calls, and yesterday&apos;s follow-up list.
                  </p>
                </div>

                {/* Mid-day Slot */}
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
                      <Briefcase className="h-4 w-4 text-cyan-400" />
                      Midday Check-in
                    </div>
                    <input
                      type="checkbox"
                      checked={profile.middayEnabled}
                      onChange={(e) => setProfile({ ...profile, middayEnabled: e.target.checked })}
                      className="rounded border-white/10 bg-slate-900 text-amber-500 focus:ring-0"
                    />
                  </div>
                  <input
                    type="time"
                    value={profile.middaySlot}
                    onChange={(e) => setProfile({ ...profile, middaySlot: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-white focus:border-amber-400/60 focus:outline-none font-mono"
                  />
                  <p className="text-[10px] text-slate-400">
                    Pings pending high-priority items due before 2 PM to keep workflow on track.
                  </p>
                </div>

                {/* EOD Slot */}
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold text-indigo-300">
                      <Moon className="h-4 w-4 text-indigo-400" />
                      End of Day (EOD)
                    </div>
                    <input
                      type="checkbox"
                      checked={profile.eodEnabled}
                      onChange={(e) => setProfile({ ...profile, eodEnabled: e.target.checked })}
                      className="rounded border-white/10 bg-slate-900 text-amber-500 focus:ring-0"
                    />
                  </div>
                  <input
                    type="time"
                    value={profile.eodSlot}
                    onChange={(e) => setProfile({ ...profile, eodSlot: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 text-xs text-white focus:border-amber-400/60 focus:outline-none font-mono"
                  />
                  <p className="text-[10px] text-slate-400">
                    Daily tally: Calls completed, leads captured, payment receipts, and tomorrow&apos;s preview.
                  </p>
                </div>
              </div>
            </div>

            {/* Included Metrics */}
            <div className="pt-5 border-t border-white/5 space-y-3">
              <h3 className="text-xs font-semibold text-slate-200">
                Metrics to Include in Briefing Reports
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 text-xs text-slate-300">
                <label className="flex items-center gap-2 rounded-lg border border-white/5 bg-slate-950/40 p-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profile.reportMetrics?.calls ?? true}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        reportMetrics: { ...profile.reportMetrics, calls: e.target.checked },
                      })
                    }
                    className="rounded border-white/10 bg-slate-900 text-amber-500 focus:ring-0"
                  />
                  <span>📞 Total Calls &amp; Missed Follow-up Counts</span>
                </label>

                <label className="flex items-center gap-2 rounded-lg border border-white/5 bg-slate-950/40 p-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profile.reportMetrics?.tasks ?? true}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        reportMetrics: { ...profile.reportMetrics, tasks: e.target.checked },
                      })
                    }
                    className="rounded border-white/10 bg-slate-900 text-amber-500 focus:ring-0"
                  />
                  <span>📌 Pending Business Tasks &amp; Schedule</span>
                </label>

                <label className="flex items-center gap-2 rounded-lg border border-white/5 bg-slate-950/40 p-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profile.reportMetrics?.leads ?? true}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        reportMetrics: { ...profile.reportMetrics, leads: e.target.checked },
                      })
                    }
                    className="rounded border-white/10 bg-slate-900 text-amber-500 focus:ring-0"
                  />
                  <span>🔥 Hot High-Intent Leads</span>
                </label>

                <label className="flex items-center gap-2 rounded-lg border border-white/5 bg-slate-950/40 p-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profile.reportMetrics?.invoices ?? true}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        reportMetrics: { ...profile.reportMetrics, invoices: e.target.checked },
                      })
                    }
                    className="rounded border-white/10 bg-slate-900 text-amber-500 focus:ring-0"
                  />
                  <span>💰 Pending Invoices &amp; Overdue Balances</span>
                </label>
              </div>
            </div>

            {/* Save Button */}
            <div className="pt-4 flex justify-end">
              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors shadow-md"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving Settings..." : `Save ${profile.assistantName || "TenSy"} Configuration`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: WhatsApp Commands Cheatsheet */}
      {activeTab === "cheatsheet" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-400" />
                  WhatsApp Commands Cheatsheet for {profile.assistantName || "TenSy"}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Send natural language text or voice notes from any authorized WhatsApp number. TenSy processes them immediately.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Tasks & Scheduling */}
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                  <span>📌 Task Scheduling &amp; Prior Reminders</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Say when the task is and when you want early reminders. TenSy calculates the offset automatically:
                </p>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="rounded bg-white/5 p-2 text-amber-200">
                    &quot;Kal 10 baje Rahul ko call karna hai, 10 min pahle reminder lagao&quot;
                  </div>
                  <div className="rounded bg-white/5 p-2 text-amber-200">
                    &quot;Aaj 1 pm me website design ke liye meeting hai&quot;
                  </div>
                  <div className="rounded bg-white/5 p-2 text-amber-200">
                    &quot;Today task&quot; / &quot;आज के सारे काम बताओ&quot;
                  </div>
                </div>
              </div>

              {/* Call Analytics & Follow-ups */}
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
                  <span>📞 Calls &amp; Auto Follow-up</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Instant reports with 1-tap interactive options to text or auto-dial missed callers:
                </p>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="rounded bg-white/5 p-2 text-cyan-200">
                    &quot;today total call&quot; / &quot;आज कितने कॉल आए हैं&quot;
                  </div>
                  <div className="rounded bg-white/5 p-2 text-cyan-200">
                    Reply <b>1</b>: Send WhatsApp template to missed calls
                  </div>
                  <div className="rounded bg-white/5 p-2 text-cyan-200">
                    Reply <b>2</b>: Trigger AI voice agent to call back
                  </div>
                </div>
              </div>

              {/* AI Creative Studio */}
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-purple-300">
                  <span>🎨 AI Creative Studio (Posters &amp; Banners)</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Generate professional branded posters directly in WhatsApp chat:
                </p>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="rounded bg-white/5 p-2 text-purple-200">
                    &quot;Diwali discount ka poster bana do&quot;
                  </div>
                  <div className="rounded bg-white/5 p-2 text-purple-200">
                    &quot;Logo thoda chhota karo aur contact number add karo&quot;
                  </div>
                  <div className="rounded bg-white/5 p-2 text-purple-200">
                    &quot;Final&quot; (locks design &amp; generates HD ready-to-share poster)
                  </div>
                </div>
              </div>

              {/* Billing & Sales */}
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                  <span>💰 Quotations, Invoicing &amp; Leads</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Execute finance &amp; sales tasks right through WhatsApp:
                </p>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="rounded bg-white/5 p-2 text-emerald-200">
                    &quot;Send quotation to Rahul for ₹15000 for web design&quot;
                  </div>
                  <div className="rounded bg-white/5 p-2 text-emerald-200">
                    &quot;Pending payments batao&quot;
                  </div>
                  <div className="rounded bg-white/5 p-2 text-emerald-200">
                    &quot;Hot leads nikaalo&quot;
                  </div>
                </div>
              </div>

              {/* Inbound Customer Intelligence & Meetings */}
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-blue-300">
                  <span>📬 Inbound Message Intelligence &amp; Meetings</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Scan incoming customer messages, extract meetings &amp; inquiries, and schedule or reply with 1 tap:
                </p>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="rounded bg-white/5 p-2 text-blue-200">
                    &quot;Aaj ke important message batao&quot; / &quot;Meeting hai kya&quot;
                  </div>
                  <div className="rounded bg-white/5 p-2 text-blue-200">
                    &quot;Schedule 1&quot; (Creates meeting task with 15-min prior reminder)
                  </div>
                  <div className="rounded bg-white/5 p-2 text-blue-200">
                    &quot;Reply 1 Haan kal 4 baje milte hain&quot; (Direct customer reply)
                  </div>
                </div>
              </div>
            </div>

            {/* Role privacy note */}
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/90">
              💡 <b>Private Filtering Guarantee:</b> When an employee registered as <i>Executive</i> sends any of the above commands, {profile.assistantName || "TenSy"} strictly limits the output to tasks assigned to that employee. Owner-exclusive commands like financials and overall call statistics are hidden.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
