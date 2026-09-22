"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Target,
  Plus,
  Play,
  CheckCircle2,
  AlertCircle,
  Users,
  User,
  MessageSquare,
  Radio,
  Share2,
  Sparkles,
  Trash2,
  Edit2,
  RefreshCw,
  Clock,
  ArrowRight,
  ShieldCheck,
  Send,
  HelpCircle,
  ChevronRight,
  Check,
  ExternalLink,
  Layers,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";

type TeamUser = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role?: string;
};

type Channel = {
  id: string;
  displayName: string;
  phoneNumber?: string | null;
  status: string;
};

type WhatsAppGroup = {
  id: string;
  subject: string;
  size?: number;
};

type LeadRoutingRule = {
  id: string;
  organizationId: string;
  channelId?: string | null;
  name: string;
  sourcePlatform: "FACEBOOK" | "INSTAGRAM" | "WEBSITE" | "GOOGLE" | "OTHER";
  matchType: "CONTAINS" | "EXACT" | "STARTS_WITH" | "REGEX";
  matchContent: string;
  assignType: "USER" | "GROUP" | "ROUND_ROBIN" | "NONE";
  assignedUserId?: string | null;
  assignedGroupJid?: string | null;
  assignedGroupName?: string | null;
  roundRobinUserIds: string[];
  lastAssignedIndex: number;
  notifyGroup: boolean;
  notifyGroupJid?: string | null;
  notifyGroupName?: string | null;
  notifyAssignee: boolean;
  autoReplyCustomer: boolean;
  autoReplyText?: string | null;
  leadTags: string[];
  leadStage: string;
  leadValue?: number | null;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
  channel?: { id: string; displayName: string; phoneNumber?: string } | null;
  assignedUser?: { id: string; name: string; email: string; phone?: string } | null;
  _count?: { logs: number };
};

type LeadRoutingLog = {
  id: string;
  ruleId?: string | null;
  phone: string;
  incomingText: string;
  assignType: string;
  assignedUserName?: string | null;
  assignedGroupName?: string | null;
  notifiedGroupName?: string | null;
  autoReplied: boolean;
  status: string;
  createdAt: string;
  rule?: { id: string; name: string; sourcePlatform: string } | null;
  assignedUser?: { id: string; name: string; email: string } | null;
};

const PLATFORM_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  FACEBOOK: { bg: "bg-blue-500/15", text: "text-blue-300", border: "border-blue-500/30" },
  INSTAGRAM: { bg: "bg-pink-500/15", text: "text-pink-300", border: "border-pink-500/30" },
  WEBSITE: { bg: "bg-emerald-500/15", text: "text-emerald-300", border: "border-emerald-500/30" },
  GOOGLE: { bg: "bg-amber-500/15", text: "text-amber-300", border: "border-amber-500/30" },
  OTHER: { bg: "bg-violet-500/15", text: "text-violet-300", border: "border-violet-500/30" },
};

export default function LeadRoutingPage() {
  const [activeTab, setActiveTab] = useState<"rules" | "logs">("rules");
  const [rules, setRules] = useState<LeadRoutingRule[]>([]);
  const [logs, setLogs] = useState<LeadRoutingLog[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [waGroups, setWaGroups] = useState<WhatsAppGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<LeadRoutingRule | null>(null);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);

  // Simulation test state
  const [testText, setTestText] = useState("Hello! Can I get more info on this?");
  const [testResult, setTestResult] = useState<any | null>(null);
  const [testing, setTesting] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    channelId: "",
    sourcePlatform: "FACEBOOK" as "FACEBOOK" | "INSTAGRAM" | "WEBSITE" | "GOOGLE" | "OTHER",
    matchType: "CONTAINS" as "CONTAINS" | "EXACT" | "STARTS_WITH" | "REGEX",
    matchContent: "Hello! Can I get more info on this?",
    assignType: "USER" as "USER" | "GROUP" | "ROUND_ROBIN" | "NONE",
    assignedUserId: "",
    assignedGroupJid: "",
    assignedGroupName: "",
    roundRobinUserIds: [] as string[],
    notifyGroup: true,
    notifyGroupJid: "",
    notifyGroupName: "",
    notifyAssignee: true,
    autoReplyCustomer: false,
    autoReplyText: "Hello! Thanks for reaching out. Our team has received your request and will contact you shortly.",
    leadTags: "lead, fb-ad",
    leadStage: "NEW",
    priority: 0,
    enabled: true,
  });

  const fetchData = async () => {
    try {
      setRefreshing(true);
      const [rulesRes, logsRes, usersRes, channelsRes] = await Promise.allSettled([
        api<{ success: true; data: LeadRoutingRule[] }>("/api/v1/lead-routing/rules"),
        api<{ success: true; data: LeadRoutingLog[] }>("/api/v1/lead-routing/logs"),
        api<{ success: true; data: TeamUser[] }>("/api/v1/users"),
        api<{ success: true; data: Channel[] }>("/api/v1/channels"),
      ]);

      if (rulesRes.status === "fulfilled" && rulesRes.value.data) {
        setRules(rulesRes.value.data);
      }
      if (logsRes.status === "fulfilled" && logsRes.value.data) {
        setLogs(logsRes.value.data);
      }
      if (usersRes.status === "fulfilled" && usersRes.value.data) {
        setUsers(usersRes.value.data);
      }
      if (channelsRes.status === "fulfilled" && channelsRes.value.data) {
        setChannels(channelsRes.value.data);
      }

      // Fetch groups from first channel or selected channel
      fetchGroups();
    } catch (err) {
      console.error("Failed to load lead routing data", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchGroups = async (channelId?: string) => {
    try {
      const url = channelId ? `/api/v1/lead-routing/groups?channelId=${channelId}` : "/api/v1/lead-routing/groups";
      const res = await api<{ success: true; data: { groups: WhatsAppGroup[] } }>(url);
      if (res.data?.groups) {
        setWaGroups(res.data.groups);
      }
    } catch {
      setWaGroups([]);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openCreateModal = () => {
    setEditingRule(null);
    setFormData({
      name: "FB Ad - General Inquiry",
      channelId: channels[0]?.id ?? "",
      sourcePlatform: "FACEBOOK",
      matchType: "CONTAINS",
      matchContent: "Hello! Can I get more info on this?",
      assignType: "USER",
      assignedUserId: users[0]?.id ?? "",
      assignedGroupJid: "",
      assignedGroupName: "",
      roundRobinUserIds: users.slice(0, 3).map((u) => u.id),
      notifyGroup: true,
      notifyGroupJid: waGroups[0]?.id ?? "",
      notifyGroupName: waGroups[0]?.subject ?? "",
      notifyAssignee: true,
      autoReplyCustomer: false,
      autoReplyText: "Hello! Thanks for reaching out. Our executive will connect with you in 5 minutes.",
      leadTags: "lead, facebook-ad",
      leadStage: "NEW",
      priority: 0,
      enabled: true,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (rule: LeadRoutingRule) => {
    setEditingRule(rule);
    setFormData({
      name: rule.name,
      channelId: rule.channelId ?? "",
      sourcePlatform: rule.sourcePlatform,
      matchType: rule.matchType,
      matchContent: rule.matchContent,
      assignType: rule.assignType,
      assignedUserId: rule.assignedUserId ?? "",
      assignedGroupJid: rule.assignedGroupJid ?? "",
      assignedGroupName: rule.assignedGroupName ?? "",
      roundRobinUserIds: rule.roundRobinUserIds || [],
      notifyGroup: rule.notifyGroup,
      notifyGroupJid: rule.notifyGroupJid ?? "",
      notifyGroupName: rule.notifyGroupName ?? "",
      notifyAssignee: rule.notifyAssignee,
      autoReplyCustomer: rule.autoReplyCustomer,
      autoReplyText: rule.autoReplyText ?? "",
      leadTags: (rule.leadTags || []).join(", "),
      leadStage: rule.leadStage || "NEW",
      priority: rule.priority,
      enabled: rule.enabled,
    });
    setIsModalOpen(true);
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: formData.name,
        channelId: formData.channelId || null,
        sourcePlatform: formData.sourcePlatform,
        matchType: formData.matchType,
        matchContent: formData.matchContent,
        assignType: formData.assignType,
        assignedUserId: formData.assignType === "USER" && formData.assignedUserId ? formData.assignedUserId : null,
        assignedGroupJid: formData.assignType === "GROUP" ? formData.assignedGroupJid : null,
        assignedGroupName: formData.assignType === "GROUP" ? formData.assignedGroupName : null,
        roundRobinUserIds: formData.assignType === "ROUND_ROBIN" ? formData.roundRobinUserIds : [],
        notifyGroup: formData.notifyGroup,
        notifyGroupJid: formData.notifyGroup ? formData.notifyGroupJid : null,
        notifyGroupName: formData.notifyGroup ? formData.notifyGroupName : null,
        notifyAssignee: formData.notifyAssignee,
        autoReplyCustomer: formData.autoReplyCustomer,
        autoReplyText: formData.autoReplyCustomer ? formData.autoReplyText : null,
        leadTags: formData.leadTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        leadStage: formData.leadStage,
        priority: Number(formData.priority) || 0,
        enabled: formData.enabled,
      };

      if (editingRule) {
        await api(`/api/v1/lead-routing/rules/${editingRule.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await api("/api/v1/lead-routing/rules", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      setIsModalOpen(false);
      fetchData();
    } catch (err: any) {
      alert(err.message || "Failed to save rule");
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm("Are you sure you want to delete this lead routing rule?")) return;
    try {
      await api(`/api/v1/lead-routing/rules/${id}`, { method: "DELETE" });
      fetchData();
    } catch (err: any) {
      alert(err.message || "Failed to delete rule");
    }
  };

  const handleToggleEnabled = async (rule: LeadRoutingRule) => {
    try {
      await api(`/api/v1/lead-routing/rules/${rule.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      fetchData();
    } catch (err: any) {
      alert(err.message || "Failed to toggle status");
    }
  };

  const runSimulation = async () => {
    if (!testText.trim()) return;
    setTesting(true);
    try {
      const res = await api<{ success: true; data: any }>("/api/v1/lead-routing/test", {
        method: "POST",
        body: JSON.stringify({ text: testText }),
      });
      setTestResult(res.data);
    } catch (err: any) {
      setTestResult({ matched: false, message: err.message || "Simulation error" });
    } finally {
      setTesting(false);
    }
  };

  const totalRouted = rules.reduce((acc, r) => acc + (r._count?.logs || 0), 0);
  const activeCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-8 pb-16">
      {/* Top Page Header */}
      <PageHeader
        title="Inbound Lead Routing & Assignment"
        subtitle="Automatically capture prefilled inbound WhatsApp messages from Facebook Ads, Instagram Ads, and Landing Pages to route them to team members or WhatsApp groups."
        tone="from-violet-400 to-fuchsia-400"
        actions={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setTestResult(null);
                setIsTestModalOpen(true);
              }}
              className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
            >
              <Play className="mr-2 h-4 w-4 text-emerald-400" />
              Test Simulation
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-violet-500/25 transition-all hover:from-violet-600 hover:to-fuchsia-600"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Lead Rule
            </button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Active Rules</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{activeCount}</span>
            <span className="text-xs text-slate-400">of {rules.length} rules</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Total Leads Routed</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400">
              <Target className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{totalRouted}</span>
            <span className="text-xs text-slate-400">routed automatically</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Assignment Modes</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
              <Users className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-300">
            <span className="font-semibold text-white">4 Arranged Options:</span> Person, Group, Round-Robin, Hybrid
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">WhatsApp Channels</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
              <Radio className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{channels.length}</span>
            <span className="text-xs text-slate-400">channels linked</span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("rules")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
              activeTab === "rules"
                ? "bg-violet-500/20 text-violet-300 shadow-[inset_0_0_0_1px] shadow-violet-500/40"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Layers className="h-4 w-4" />
            Routing Rules ({rules.length})
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
              activeTab === "logs"
                ? "bg-violet-500/20 text-violet-300 shadow-[inset_0_0_0_1px] shadow-violet-500/40"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Clock className="h-4 w-4" />
            Inbound Lead Logs ({logs.length})
          </button>
        </div>

        <button
          type="button"
          onClick={fetchData}
          disabled={refreshing}
          className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs text-slate-400 transition-colors hover:text-slate-200"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* TAB 1: RULES LIST */}
      {activeTab === "rules" && (
        <div className="space-y-4">
          {rules.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-400">
                <Target className="h-7 w-7" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-white">No Lead Routing Rules configured yet</h3>
              <p className="mt-1.5 max-w-md text-sm text-slate-400">
                Create a rule to automatically detect incoming WhatsApp messages from Facebook ads, Instagram ads, or
                website landing pages and route them to agents or groups.
              </p>
              <button
                type="button"
                onClick={openCreateModal}
                className="mt-5 inline-flex items-center justify-center rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
              >
                <Plus className="mr-2 h-4 w-4" /> Create First Rule
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {rules.map((rule) => {
                const platformStyle = PLATFORM_COLORS[rule.sourcePlatform] || PLATFORM_COLORS.OTHER;
                return (
                  <div
                    key={rule.id}
                    className={`group relative rounded-2xl border bg-slate-900/70 p-6 transition-all hover:border-slate-700 ${
                      rule.enabled ? "border-slate-800" : "border-slate-800/50 opacity-65"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      {/* Left: Info */}
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span
                            className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${platformStyle.bg} ${platformStyle.text} ${platformStyle.border}`}
                          >
                            {rule.sourcePlatform}
                          </span>
                          <h3 className="text-lg font-semibold text-white">{rule.name}</h3>
                          {rule.channel && (
                            <span className="text-xs text-slate-400">
                              Channel: <span className="text-slate-300 font-medium">{rule.channel.displayName}</span>
                            </span>
                          )}
                        </div>

                        {/* Trigger Match Card */}
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded bg-slate-800 px-2 py-1 text-slate-300 font-mono">
                            {rule.matchType}
                          </span>
                          <span className="text-slate-400">matches text:</span>
                          <span className="rounded-lg border border-slate-700/60 bg-slate-950/80 px-3 py-1 font-mono text-emerald-300">
                            &quot;{rule.matchContent}&quot;
                          </span>
                        </div>

                        {/* Arrangement & Actions Badges */}
                        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                          {/* Assignment Badge */}
                          <div className="flex items-center gap-1.5 rounded-lg border border-slate-700/60 bg-slate-800/80 px-2.5 py-1 text-slate-200">
                            {rule.assignType === "USER" && (
                              <>
                                <User className="h-3.5 w-3.5 text-cyan-400" />
                                <span>Single Person: </span>
                                <strong className="text-white">{rule.assignedUser?.name || "Assigned Agent"}</strong>
                              </>
                            )}
                            {rule.assignType === "GROUP" && (
                              <>
                                <Users className="h-3.5 w-3.5 text-violet-400" />
                                <span>WhatsApp Group: </span>
                                <strong className="text-white">{rule.assignedGroupName || "Group"}</strong>
                              </>
                            )}
                            {rule.assignType === "ROUND_ROBIN" && (
                              <>
                                <Share2 className="h-3.5 w-3.5 text-pink-400" />
                                <span>Round-Robin: </span>
                                <strong className="text-white">{rule.roundRobinUserIds.length} Team Members</strong>
                              </>
                            )}
                          </div>

                          {/* Group Alert Badge */}
                          {rule.notifyGroup && (
                            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
                              <Radio className="h-3.5 w-3.5 text-emerald-400" />
                              <span>Group Alert Card: </span>
                              <strong className="text-emerald-200">
                                {rule.notifyGroupName || rule.notifyGroupJid || "Active Group"}
                              </strong>
                            </div>
                          )}

                          {/* Auto reply badge */}
                          {rule.autoReplyCustomer && (
                            <div className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-blue-300">
                              <MessageSquare className="h-3.5 w-3.5 text-blue-400" />
                              <span>Auto-Reply Active</span>
                            </div>
                          )}

                          {/* Leads routed counter */}
                          <span className="text-slate-400">
                            Leads routed: <strong className="text-white">{rule._count?.logs ?? 0}</strong>
                          </span>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleEnabled(rule)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            rule.enabled ? "bg-emerald-500" : "bg-slate-700"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              rule.enabled ? "translate-x-6" : "translate-x-1"
                            }`}
                          />
                        </button>

                        <button
                          type="button"
                          onClick={() => openEditModal(rule)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteRule(rule.id)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-rose-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: INBOUND LEAD LOGS */}
      {activeTab === "logs" && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">Recent Inbound Lead Events</h3>
            <span className="text-xs text-slate-400">Total {logs.length} logged events</span>
          </div>

          {logs.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">No leads routed yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-3 font-medium">Time</th>
                    <th className="pb-3 font-medium">Phone Number</th>
                    <th className="pb-3 font-medium">Platform / Rule</th>
                    <th className="pb-3 font-medium">Message Content</th>
                    <th className="pb-3 font-medium">Assigned To</th>
                    <th className="pb-3 font-medium">Group Alert</th>
                    <th className="pb-3 font-medium">Auto-Reply</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/30">
                      <td className="py-3 text-slate-400 font-mono">
                        {new Date(log.createdAt).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-3 font-medium text-white font-mono">{log.phone}</td>
                      <td className="py-3">
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-200">
                          {log.rule?.name || "Lead Rule"}
                        </span>
                      </td>
                      <td className="py-3 max-w-xs truncate text-slate-300" title={log.incomingText}>
                        &quot;{log.incomingText}&quot;
                      </td>
                      <td className="py-3">
                        <span className="font-medium text-violet-300">
                          {log.assignedUserName || log.assignedGroupName || "None"}
                        </span>
                      </td>
                      <td className="py-3">
                        {log.notifiedGroupName ? (
                          <span className="text-emerald-400">✓ {log.notifiedGroupName}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3">
                        {log.autoReplied ? (
                          <span className="text-blue-400">Sent</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CREATE / EDIT RULE MODAL */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 p-7 shadow-2xl shadow-black/80"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {editingRule ? "Edit Lead Routing Rule" : "Create New Lead Routing Rule"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Arrange how inbound WhatsApp ad text is identified and assigned to people or groups.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveRule} className="mt-6 space-y-6">
                {/* SECTION 1: PLATFORM & BASIC INFO */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-violet-400">
                    Step 1: Campaign & Source Platform
                  </h4>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-300">Rule Name</label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g. FB Ad - Tech Support"
                        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300">Source Platform</label>
                      <select
                        value={formData.sourcePlatform}
                        onChange={(e) => setFormData({ ...formData, sourcePlatform: e.target.value as any })}
                        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
                      >
                        <option value="FACEBOOK">Facebook Ads</option>
                        <option value="INSTAGRAM">Instagram Ads</option>
                        <option value="WEBSITE">Website / Landing Page</option>
                        <option value="GOOGLE">Google Ads</option>
                        <option value="OTHER">Other Campaign</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300">
                      Target WhatsApp Channel (Optional)
                    </label>
                    <select
                      value={formData.channelId}
                      onChange={(e) => {
                        setFormData({ ...formData, channelId: e.target.value });
                        fetchGroups(e.target.value);
                      }}
                      className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
                    >
                      <option value="">All Channels in Workspace</option>
                      {channels.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.displayName} ({ch.phoneNumber || "Web Session"})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* SECTION 2: TRIGGER CONDITION */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                    Step 2: Incoming Message Trigger Condition
                  </h4>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-1">
                      <label className="block text-xs font-medium text-slate-300">Match Type</label>
                      <select
                        value={formData.matchType}
                        onChange={(e) => setFormData({ ...formData, matchType: e.target.value as any })}
                        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                      >
                        <option value="CONTAINS">Contains (Keyword / Substring)</option>
                        <option value="EXACT">Exact Match (Full Text)</option>
                        <option value="STARTS_WITH">Starts With</option>
                        <option value="REGEX">Regular Expression</option>
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-300">Prefilled Ad / Button Text</label>
                      <input
                        type="text"
                        required
                        value={formData.matchContent}
                        onChange={(e) => setFormData({ ...formData, matchContent: e.target.value })}
                        placeholder='e.g. "Hello! Can I get more info on this?"'
                        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none font-mono"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    💡 When a customer clicks your Ad or Landing Page button and sends this message, this routing rule will trigger.
                  </p>
                </div>

                {/* SECTION 3: THE 4 ARRANGE OPTIONS */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 space-y-5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-fuchsia-400">
                      Step 3: Assignment Target
                    </h4>
                  </div>

                  {/* Option Choice Radio Cards */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {/* OPTION 1: SINGLE PERSON */}
                    <div
                      onClick={() => setFormData({ ...formData, assignType: "USER" })}
                      className={`cursor-pointer rounded-xl border p-4 transition-all ${
                        formData.assignType === "USER"
                          ? "border-violet-500 bg-violet-500/15 text-white shadow-md shadow-violet-500/10"
                          : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-violet-400" />
                        <span className="font-semibold text-sm text-white">1. Single Person</span>
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed">
                        Assign directly to a dedicated team member (even if they are not in the WhatsApp group).
                      </p>
                    </div>

                    {/* OPTION 2: WHATSAPP GROUP */}
                    <div
                      onClick={() => setFormData({ ...formData, assignType: "GROUP" })}
                      className={`cursor-pointer rounded-xl border p-4 transition-all ${
                        formData.assignType === "GROUP"
                          ? "border-cyan-500 bg-cyan-500/15 text-white shadow-md shadow-cyan-500/10"
                          : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-cyan-400" />
                        <span className="font-semibold text-sm text-white">2. WhatsApp Group</span>
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed">
                        Forward and assign the inbound lead directly to a WhatsApp Group.
                      </p>
                    </div>

                    {/* OPTION 3: ROUND-ROBIN */}
                    <div
                      onClick={() => setFormData({ ...formData, assignType: "ROUND_ROBIN" })}
                      className={`cursor-pointer rounded-xl border p-4 transition-all ${
                        formData.assignType === "ROUND_ROBIN"
                          ? "border-pink-500 bg-pink-500/15 text-white shadow-md shadow-pink-500/10"
                          : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Share2 className="h-4 w-4 text-pink-400" />
                        <span className="font-semibold text-sm text-white">3. Round-Robin Pool</span>
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed">
                        Distribute incoming leads evenly in rotation across selected team members.
                      </p>
                    </div>
                  </div>

                  {/* Sub-settings based on chosen Option */}
                  {formData.assignType === "USER" && (
                    <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
                      <label className="block text-xs font-medium text-violet-300">
                        Select Single Team Member to Assign:
                      </label>
                      <select
                        value={formData.assignedUserId}
                        onChange={(e) => setFormData({ ...formData, assignedUserId: e.target.value })}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
                      >
                        <option value="">-- Choose Sales Executive --</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.email}) {u.phone ? `— ${u.phone}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {formData.assignType === "GROUP" && (
                    <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 space-y-3">
                      <label className="block text-xs font-medium text-cyan-300">Select WhatsApp Group:</label>
                      {waGroups.length > 0 ? (
                        <select
                          value={formData.assignedGroupJid}
                          onChange={(e) => {
                            const grp = waGroups.find((g) => g.id === e.target.value);
                            setFormData({
                              ...formData,
                              assignedGroupJid: e.target.value,
                              assignedGroupName: grp?.subject || "",
                            });
                          }}
                          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                        >
                          <option value="">-- Choose WhatsApp Group --</option>
                          {waGroups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.subject} {g.size ? `(${g.size} members)` : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div>
                          <input
                            type="text"
                            value={formData.assignedGroupJid}
                            onChange={(e) => setFormData({ ...formData, assignedGroupJid: e.target.value })}
                            placeholder="Enter WhatsApp Group JID (e.g. 12036304xxx@g.us)"
                            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none font-mono"
                          />
                          <p className="mt-1 text-[11px] text-slate-400">
                            (Connect your WhatsApp Channel to automatically list available groups)
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {formData.assignType === "ROUND_ROBIN" && (
                    <div className="rounded-xl border border-pink-500/30 bg-pink-500/5 p-4 space-y-3">
                      <label className="block text-xs font-medium text-pink-300">
                        Select Team Members for Round-Robin Distribution:
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                        {users.map((u) => {
                          const isSelected = formData.roundRobinUserIds.includes(u.id);
                          return (
                            <div
                              key={u.id}
                              onClick={() => {
                                const next = isSelected
                                  ? formData.roundRobinUserIds.filter((id) => id !== u.id)
                                  : [...formData.roundRobinUserIds, u.id];
                                setFormData({ ...formData, roundRobinUserIds: next });
                              }}
                              className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                                isSelected
                                  ? "border-pink-500 bg-pink-500/20 text-white font-medium"
                                  : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700"
                              }`}
                            >
                              <div
                                className={`flex h-4 w-4 items-center justify-center rounded border ${
                                  isSelected ? "border-pink-500 bg-pink-500 text-white" : "border-slate-700"
                                }`}
                              >
                                {isSelected && <Check className="h-3 w-3" />}
                              </div>
                              <span className="truncate">{u.name}</span>
                            </div>
                          );
                        })}
                      </div>
                      <span className="text-[11px] text-pink-300">
                        ✓ Selected: {formData.roundRobinUserIds.length} members
                      </span>
                    </div>
                  )}
                </div>

                {/* SECTION 4: NOTIFICATION & HYBRID GROUP ALERT (OPTION 4) */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    Step 4: Notifications & Hybrid Group Alerts
                  </h4>

                  {/* WhatsApp Group Notification Card Checkbox */}
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.notifyGroup}
                        onChange={(e) => setFormData({ ...formData, notifyGroup: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-700 text-emerald-500 focus:ring-emerald-400"
                      />
                      <span className="text-xs font-semibold text-white">
                        4. Forward Alert Card to Internal WhatsApp Group (Hybrid Visibility)
                      </span>
                    </label>
                    <p className="text-[11px] text-slate-400 pl-7">
                      Whether a lead is assigned to a single person or round-robin, an instant alert card with lead details and assigned agent will be forwarded to this group.
                    </p>

                    {formData.notifyGroup && (
                      <div className="pl-7 pt-2">
                        <label className="block text-xs font-medium text-slate-300">Select WhatsApp Alert Group</label>
                        {waGroups.length > 0 ? (
                          <select
                            value={formData.notifyGroupJid}
                            onChange={(e) => {
                              const grp = waGroups.find((g) => g.id === e.target.value);
                              setFormData({
                                ...formData,
                                notifyGroupJid: e.target.value,
                                notifyGroupName: grp?.subject || "",
                              });
                            }}
                            className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                          >
                            <option value="">-- Choose Alert Group --</option>
                            {waGroups.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.subject} {g.size ? `(${g.size} members)` : ""}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={formData.notifyGroupJid}
                            onChange={(e) => setFormData({ ...formData, notifyGroupJid: e.target.value })}
                            placeholder="e.g. 12036304xxx@g.us"
                            className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono"
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Notify Assignee Directly */}
                  <label className="flex items-center gap-3 cursor-pointer pl-1">
                    <input
                      type="checkbox"
                      checked={formData.notifyAssignee}
                      onChange={(e) => setFormData({ ...formData, notifyAssignee: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-700 text-emerald-500 focus:ring-emerald-400"
                    />
                    <span className="text-xs text-slate-200">
                      Send direct WhatsApp alert to assigned agent&apos;s personal phone
                    </span>
                  </label>

                  {/* Auto-reply to customer */}
                  <div className="pt-2">
                    <label className="flex items-center gap-3 cursor-pointer pl-1">
                      <input
                        type="checkbox"
                        checked={formData.autoReplyCustomer}
                        onChange={(e) => setFormData({ ...formData, autoReplyCustomer: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-700 text-emerald-500 focus:ring-emerald-400"
                      />
                      <span className="text-xs text-slate-200">
                        Send instant auto-reply acknowledgement message to the Customer
                      </span>
                    </label>

                    {formData.autoReplyCustomer && (
                      <textarea
                        rows={2}
                        value={formData.autoReplyText}
                        onChange={(e) => setFormData({ ...formData, autoReplyText: e.target.value })}
                        placeholder="e.g. Hello! Thanks for reaching out. We will call you shortly."
                        className="mt-2.5 w-full rounded-xl border border-slate-700 bg-slate-800 p-3 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                      />
                    )}
                  </div>
                </div>

                {/* SECTION 5: TAGS & STAGE */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5 space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    Step 5: CRM Tags & Lead Stage
                  </h4>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-300">Auto-Apply Contact Tags</label>
                      <input
                        type="text"
                        value={formData.leadTags}
                        onChange={(e) => setFormData({ ...formData, leadTags: e.target.value })}
                        placeholder="lead, facebook-ad, hot-lead"
                        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-400">Comma separated tags</span>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300">Initial Pipeline Stage</label>
                      <select
                        value={formData.leadStage}
                        onChange={(e) => setFormData({ ...formData, leadStage: e.target.value })}
                        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
                      >
                        <option value="NEW">NEW (Uncontacted)</option>
                        <option value="CONTACTED">CONTACTED (Follow-up)</option>
                        <option value="QUALIFIED">QUALIFIED (Hot)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="rounded-xl px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold text-white shadow-lg transition-all hover:from-violet-600 hover:to-fuchsia-600"
                  >
                    {editingRule ? "Save Changes" : "Create Lead Rule"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SIMULATION TEST MODAL */}
      <AnimatePresence>
        {isTestModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 p-7 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                    <Play className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Simulate Inbound Lead</h2>
                    <p className="text-xs text-slate-400">Test how your lead routing rules react to incoming text.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsTestModalOpen(false)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="mt-6 space-y-5">
                <div>
                  <label className="block text-xs font-medium text-slate-300">
                    Type incoming message (or select preset):
                  </label>
                  <input
                    type="text"
                    value={testText}
                    onChange={(e) => setTestText(e.target.value)}
                    placeholder="e.g. Hello! Can I get more info on this?"
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono"
                  />

                  {/* Preset quick buttons */}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setTestText("Hello! Can I get more info on this?")}
                      className="rounded-lg border border-slate-800 bg-slate-800/80 px-2.5 py-1 text-[11px] text-slate-300 hover:border-slate-700"
                    >
                      FB Ad: &quot;Hello! Can I get more info on this?&quot;
                    </button>
                    <button
                      type="button"
                      onClick={() => setTestText("Hello, I need technical support.")}
                      className="rounded-lg border border-slate-800 bg-slate-800/80 px-2.5 py-1 text-[11px] text-slate-300 hover:border-slate-700"
                    >
                      Website: &quot;Hello, I need technical support.&quot;
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={runSimulation}
                  disabled={testing}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                >
                  <Play className={`mr-2 h-4 w-4 ${testing ? "animate-spin" : ""}`} />
                  {testing ? "Testing Rules..." : "Run Test Simulation"}
                </button>

                {/* Results Card */}
                {testResult && (
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      {testResult.matched ? (
                        <>
                          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                          <h4 className="text-sm font-semibold text-emerald-300">Rule Matched Successfully!</h4>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-5 w-5 text-amber-400" />
                          <h4 className="text-sm font-semibold text-amber-300">No Rule Matched</h4>
                        </>
                      )}
                    </div>

                    {testResult.matched ? (
                      <div className="space-y-3 text-xs">
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-1.5">
                          <div>
                            Rule Name: <strong className="text-white">{testResult.rule.name}</strong> (
                            {testResult.rule.sourcePlatform})
                          </div>
                          <div>
                            Match Type: <span className="font-mono text-cyan-300">{testResult.rule.matchType}</span>
                          </div>
                          <div>
                            Assignment Mode:{" "}
                            <span className="font-semibold text-violet-300">{testResult.rule.assignType}</span>
                          </div>
                          {testResult.rule.assignedUser && (
                            <div>
                              Assigned Agent:{" "}
                              <strong className="text-white">{testResult.rule.assignedUser.name}</strong>
                            </div>
                          )}
                        </div>

                        {/* WhatsApp Group Alert Preview */}
                        {testResult.rule.notifyGroup && (
                          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[11px] font-mono text-emerald-200">
                            <div className="font-bold text-emerald-400 mb-1">
                              📲 WhatsApp Group Alert Card Preview:
                            </div>
                            <div>🚨 *New Inbound Lead Alert!*</div>
                            <div>📍 Source: {testResult.rule.sourcePlatform}</div>
                            <div>👤 Lead Number: +91 9876543210</div>
                            <div>💬 Message: &quot;{testText}&quot;</div>
                            <div>🎯 Assigned To: {testResult.rule.assignedUser?.name || "Group"}</div>
                            <div>⏰ Time: 02:30 PM</div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {testResult.message || "This incoming message would be processed by normal Chatbot / Inbox."}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
