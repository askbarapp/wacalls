"use client";

import { useEffect, useState, useCallback } from "react";
import {
  FolderKanban,
  Plus,
  Search,
  Filter,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Users,
  Send,
  RefreshCw,
  Phone,
  MessageSquare,
  ArrowRight,
  TrendingUp,
  X,
  ChevronRight,
  Sparkles,
  CheckSquare,
  DollarSign,
  Briefcase,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { api } from "@/lib/api";

interface ProjectMember {
  id?: string;
  name: string;
  phone: string;
  roleInProject: string;
  isLead?: boolean;
}

interface ProjectUpdateLog {
  id: string;
  authorName: string;
  authorPhone: string;
  authorRole?: string | null;
  updateText: string;
  source: "WHATSAPP" | "WEB_PORTAL" | "VOICE_NOTE" | "SYSTEM";
  sentiment: "POSITIVE" | "NEUTRAL" | "BLOCKED";
  blockers?: string | null;
  nextStepSuggested?: string | null;
  createdAt: string;
}

interface BusinessProject {
  id: string;
  projectCode: string;
  title: string;
  description?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  budget?: number | null;
  currency: string;
  startDate: string;
  targetDeadline?: string | null;
  completedAt?: string | null;
  status: "PLANNING" | "IN_PROGRESS" | "REVIEW" | "COMPLETED" | "ON_HOLD" | "CANCELLED";
  progressPercent: number;
  healthStatus: "ON_TRACK" | "AT_RISK" | "DELAYED";
  keyDeliverables?: string[] | null;
  nextStepAction?: string | null;
  nextStepOwner?: string | null;
  nextStepDueAt?: string | null;
  members: ProjectMember[];
  recentUpdates?: ProjectUpdateLog[];
  updates?: ProjectUpdateLog[];
  taskStats?: { total: number; completed: number };
  createdAt: string;
  updatedAt: string;
}

interface ProjectStats {
  total: number;
  inProgress: number;
  review: number;
  delayed: number;
  completed: number;
  activeCount: number;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<BusinessProject[]>([]);
  const [stats, setStats] = useState<ProjectStats>({
    total: 0,
    inProgress: 0,
    review: 0,
    delayed: 0,
    completed: 0,
    activeCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState("ALL");
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");

  // Project Journey Drawer Modal
  const [selectedProject, setSelectedProject] = useState<BusinessProject | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [fullJourney, setFullJourney] = useState<BusinessProject | null>(null);

  // Quick Update Form inside Drawer
  const [updateText, setUpdateText] = useState("");
  const [updateAuthor, setUpdateAuthor] = useState("Admin");
  const [updateSentiment, setUpdateSentiment] = useState<"POSITIVE" | "NEUTRAL" | "BLOCKED">("NEUTRAL");
  const [updateNextStep, setUpdateNextStep] = useState("");
  const [updateNextOwner, setUpdateNextOwner] = useState("");
  const [updateProgress, setUpdateProgress] = useState<number | "">("");
  const [notifyNextOwner, setNotifyNextOwner] = useState(true);
  const [postingUpdate, setPostingUpdate] = useState(false);

  // Create Project Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formClientName, setFormClientName] = useState("");
  const [formClientPhone, setFormClientPhone] = useState("");
  const [formBudget, setFormBudget] = useState("");
  const [formDeadline, setFormDeadline] = useState("");
  const [formStatus, setFormStatus] = useState<any>("PLANNING");
  const [formHealth, setFormHealth] = useState<any>("ON_TRACK");
  const [formNextStep, setFormNextStep] = useState("");
  const [formNextOwner, setFormNextOwner] = useState("");
  const [deliverablesInput, setDeliverablesInput] = useState("");
  const [formMembers, setFormMembers] = useState<ProjectMember[]>([
    { name: "", phone: "", roleInProject: "Lead" },
  ]);
  const [notifyMembersOnWhatsApp, setNotifyMembersOnWhatsApp] = useState(true);

  const [bannerMsg, setBannerMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api<{ success: boolean; data: ProjectStats }>("/api/v1/projects/stats");
      if (res?.data) setStats(res.data);
    } catch {
      // fallback
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (healthFilter !== "ALL") params.append("healthStatus", healthFilter);
      if (search.trim()) params.append("search", search.trim());

      const res = await api<{ success: boolean; data: BusinessProject[] }>(
        `/api/v1/projects?${params.toString()}`,
      );
      if (res?.data) {
        setProjects(res.data);
      }
    } catch (err: any) {
      setBannerMsg({ type: "error", text: err?.message || "Failed to load projects" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [healthFilter, search]);

  useEffect(() => {
    fetchStats();
    fetchProjects();
  }, [fetchStats, fetchProjects]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchStats();
    fetchProjects();
  };

  const openProjectJourney = async (project: BusinessProject) => {
    setSelectedProject(project);
    setJourneyLoading(true);
    try {
      const res = await api<{ success: boolean; data: BusinessProject }>(`/api/v1/projects/${project.id}`);
      if (res?.data) {
        setFullJourney(res.data);
        setUpdateProgress(res.data.progressPercent);
        setUpdateNextStep(res.data.nextStepAction || "");
        setUpdateNextOwner(res.data.nextStepOwner || "");
      }
    } catch (err: any) {
      setBannerMsg({ type: "error", text: err?.message || "Failed to load project journey" });
    } finally {
      setJourneyLoading(false);
    }
  };

  const handleAddMemberRow = () => {
    setFormMembers([...formMembers, { name: "", phone: "", roleInProject: "Team Member" }]);
  };

  const handleRemoveMemberRow = (index: number) => {
    setFormMembers(formMembers.filter((_, i) => i !== index));
  };

  const handleMemberChange = (index: number, field: keyof ProjectMember, val: string) => {
    const updated = [...formMembers];
    updated[index] = { ...updated[index], [field]: val };
    setFormMembers(updated);
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      setBannerMsg({ type: "error", text: "Project Title is required" });
      return;
    }

    try {
      setCreating(true);
      const filteredMembers = formMembers.filter((m) => m.name.trim() && m.phone.trim());
      const deliverables = deliverablesInput
        .split("\n")
        .map((d) => d.trim())
        .filter(Boolean);

      const payload = {
        title: formTitle.trim(),
        projectCode: formCode.trim() || undefined,
        description: formDesc.trim() || null,
        clientName: formClientName.trim() || null,
        clientPhone: formClientPhone.trim() || null,
        budget: formBudget ? parseFloat(formBudget) : null,
        targetDeadline: formDeadline ? new Date(formDeadline).toISOString() : null,
        status: formStatus,
        healthStatus: formHealth,
        keyDeliverables: deliverables,
        nextStepAction: formNextStep.trim() || null,
        nextStepOwner: formNextOwner.trim() || null,
        members: filteredMembers,
        notifyMembersOnWhatsApp,
      };

      const res = await api<{ success: boolean; data: BusinessProject }>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (res?.success) {
        setBannerMsg({
          type: "success",
          text: `🎉 Project ${res.data.projectCode}: ${res.data.title} launched successfully!`,
        });
        setShowCreateModal(false);
        // Reset form
        setFormTitle("");
        setFormCode("");
        setFormDesc("");
        setFormClientName("");
        setFormClientPhone("");
        setFormBudget("");
        setFormDeadline("");
        setFormNextStep("");
        setFormNextOwner("");
        setDeliverablesInput("");
        setFormMembers([{ name: "", phone: "", roleInProject: "Lead" }]);
        fetchStats();
        fetchProjects();
      }
    } catch (err: any) {
      setBannerMsg({ type: "error", text: err?.message || "Failed to create project" });
    } finally {
      setCreating(false);
    }
  };

  const handlePostUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !updateText.trim()) return;

    try {
      setPostingUpdate(true);
      const res = await api<{ success: boolean; data: ProjectUpdateLog }>(
        `/api/v1/projects/${selectedProject.id}/updates`,
        {
          method: "POST",
          body: JSON.stringify({
            authorName: updateAuthor || "Admin",
            authorPhone: "Admin",
            authorRole: "Manager",
            updateText: updateText.trim(),
            source: "WEB_PORTAL",
            sentiment: updateSentiment,
            nextStepSuggested: updateNextStep.trim() || null,
            nextStepOwner: updateNextOwner.trim() || null,
            progressPercent: updateProgress !== "" ? Number(updateProgress) : null,
            notifyNextOwnerOnWhatsApp: notifyNextOwner,
          }),
        },
      );

      if (res?.success) {
        setBannerMsg({ type: "success", text: "Journey update posted to project timeline!" });
        setUpdateText("");
        // Reload project drawer
        openProjectJourney(selectedProject);
        fetchProjects();
        fetchStats();
      }
    } catch (err: any) {
      setBannerMsg({ type: "error", text: err?.message || "Failed to post update" });
    } finally {
      setPostingUpdate(false);
    }
  };

  const renderHealthBadge = (health: string) => {
    switch (health) {
      case "ON_TRACK":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            On-Track
          </span>
        );
      case "AT_RISK":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3 h-3" />
            At-Risk
          </span>
        );
      case "DELAYED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertCircle className="w-3 h-3" />
            Delayed
          </span>
        );
      default:
        return null;
    }
  };

  // Kanban Stage Columns
  const stages = [
    { key: "PLANNING", label: "1. Planning & Setup", color: "border-sky-500/30 text-sky-400 bg-sky-500/5" },
    { key: "IN_PROGRESS", label: "2. Active Execution", color: "border-amber-500/30 text-amber-400 bg-amber-500/5" },
    { key: "REVIEW", label: "3. Review & QC", color: "border-purple-500/30 text-purple-400 bg-purple-500/5" },
    { key: "COMPLETED", label: "4. Delivered & Done", color: "border-emerald-500/30 text-emerald-400 bg-emerald-500/5" },
  ];

  return (
    <div className="min-h-screen bg-[#0d0f12] text-slate-100 p-4 md:p-8">
      {/* Alert Banner */}
      {bannerMsg && (
        <div
          className={`mb-6 p-4 rounded-xl border flex items-center justify-between text-sm transition-all ${
            bannerMsg.type === "success"
              ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-200"
              : "bg-rose-950/40 border-rose-500/30 text-rose-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {bannerMsg.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <span>{bannerMsg.text}</span>
          </div>
          <button
            onClick={() => setBannerMsg(null)}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-600/15 border border-violet-500/30 text-violet-400">
              <FolderKanban className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white flex items-center gap-2">
                Business Projects & Supervision
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 font-medium border border-violet-500/30">
                  WhatsApp Co-pilot
                </span>
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">
                Organize deliverables, assign multi-role teams, and let TenSy capture living timelines directly via WhatsApp.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-1 flex items-center">
            <button
              onClick={() => setViewMode("kanban")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                viewMode === "kanban"
                  ? "bg-violet-600 text-white shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Kanban
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                viewMode === "list"
                  ? "bg-violet-600 text-white shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              List View
            </button>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm shadow-lg shadow-violet-600/20 transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>New Project</span>
          </button>
        </div>
      </div>

      {/* Top Executive Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 mb-8">
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
          <p className="text-xs font-medium text-slate-400">Total Projects</p>
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-2xl font-bold text-white">{stats.total}</p>
            <Briefcase className="w-4 h-4 text-slate-500" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
          <p className="text-xs font-medium text-sky-400">In Progress</p>
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-2xl font-bold text-sky-300">{stats.inProgress}</p>
            <TrendingUp className="w-4 h-4 text-sky-400" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
          <p className="text-xs font-medium text-purple-400">Review & QC</p>
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-2xl font-bold text-purple-300">{stats.review}</p>
            <Clock className="w-4 h-4 text-purple-400" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
          <p className="text-xs font-medium text-rose-400">Delayed / Attention</p>
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-2xl font-bold text-rose-400">{stats.delayed}</p>
            <AlertCircle className="w-4 h-4 text-rose-400" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
          <p className="text-xs font-medium text-emerald-400">Delivered</p>
          <div className="flex items-baseline justify-between mt-2">
            <p className="text-2xl font-bold text-emerald-400">{stats.completed}</p>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 mb-6">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search projects by code (PRJ-101), title, or client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0">
            <Filter className="w-3.5 h-3.5" />
            Health:
          </span>
          <select
            value={healthFilter}
            onChange={(e) => setHealthFilter(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-violet-500/50 cursor-pointer"
          >
            <option value="ALL">All Health</option>
            <option value="ON_TRACK">🟢 On-Track</option>
            <option value="AT_RISK">🟡 At-Risk</option>
            <option value="DELAYED">🔴 Delayed</option>
          </select>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="py-24 text-center">
          <RefreshCw className="w-8 h-8 text-violet-500 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading business projects...</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="py-16 text-center rounded-2xl bg-slate-900/40 border border-slate-800/80 p-8">
          <div className="w-12 h-12 rounded-2xl bg-violet-600/10 border border-violet-500/20 text-violet-400 flex items-center justify-center mx-auto mb-3">
            <FolderKanban className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-white">No Projects Found</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto mt-1 mb-5">
            Get started by launching your first multi-stage project with team assignments and automated WhatsApp supervision.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-sm transition"
          >
            <Plus className="w-4 h-4" />
            Create First Project
          </button>
        </div>
      ) : viewMode === "kanban" ? (
        /* KANBAN BOARD */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {stages.map((stage) => {
            const stageProjects = projects.filter((p) => p.status === stage.key);
            return (
              <div
                key={stage.key}
                className="flex flex-col rounded-2xl bg-slate-900/40 border border-slate-800/80 p-3 min-h-[500px]"
              >
                {/* Column Header */}
                <div
                  className={`flex items-center justify-between px-3 py-2 rounded-xl border mb-3 font-semibold text-xs tracking-wider uppercase ${stage.color}`}
                >
                  <span>{stage.label}</span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-950/50 text-slate-300 text-xs">
                    {stageProjects.length}
                  </span>
                </div>

                {/* Cards Container */}
                <div className="space-y-3 flex-1 overflow-y-auto">
                  {stageProjects.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-600">No projects in this stage</div>
                  ) : (
                    stageProjects.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => openProjectJourney(p)}
                        className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80 hover:border-violet-500/40 hover:bg-slate-900 transition-all cursor-pointer shadow-sm hover:shadow-md group"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="text-xs font-mono font-bold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded">
                            {p.projectCode}
                          </span>
                          {renderHealthBadge(p.healthStatus)}
                        </div>

                        <h4 className="text-sm font-semibold text-white group-hover:text-violet-300 transition line-clamp-1 mb-1">
                          {p.title}
                        </h4>

                        {p.clientName && (
                          <p className="text-xs text-slate-400 mb-3 flex items-center gap-1">
                            <span className="text-slate-500">Client:</span> {p.clientName}
                          </p>
                        )}

                        {/* Progress Bar */}
                        <div className="mb-3">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-400">Progress</span>
                            <span className="font-semibold text-slate-300">{p.progressPercent}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                p.progressPercent >= 100
                                  ? "bg-emerald-400"
                                  : p.healthStatus === "DELAYED"
                                  ? "bg-rose-400"
                                  : "bg-violet-500"
                              }`}
                              style={{ width: `${p.progressPercent}%` }}
                            />
                          </div>
                        </div>

                        {/* Next Step Banner */}
                        {p.nextStepAction && (
                          <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/50 text-xs mb-3">
                            <div className="text-violet-300 font-medium flex items-center gap-1 mb-0.5">
                              <Sparkles className="w-3 h-3 text-violet-400" />
                              Next: {p.nextStepAction}
                            </div>
                            {p.nextStepOwner && (
                              <div className="text-slate-500 text-[11px]">Owner: {p.nextStepOwner}</div>
                            )}
                          </div>
                        )}

                        {/* Footer: Members & Deadline */}
                        <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
                          <div className="flex items-center gap-1 text-slate-400">
                            <Users className="w-3.5 h-3.5 text-slate-500" />
                            <span>{p.members.length} team</span>
                          </div>

                          {p.targetDeadline && (
                            <div className="flex items-center gap-1 text-slate-400">
                              <Calendar className="w-3.5 h-3.5 text-slate-500" />
                              <span>
                                {new Date(p.targetDeadline).toLocaleDateString("en-IN", {
                                  day: "numeric",
                                  month: "short",
                                })}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE LIST VIEW */
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/60 text-xs uppercase font-semibold text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-5 py-3.5">Code & Project</th>
                  <th className="px-5 py-3.5">Client</th>
                  <th className="px-5 py-3.5">Stage</th>
                  <th className="px-5 py-3.5">Health</th>
                  <th className="px-5 py-3.5">Progress</th>
                  <th className="px-5 py-3.5">Team</th>
                  <th className="px-5 py-3.5">Next Action</th>
                  <th className="px-5 py-3.5">Deadline</th>
                  <th className="px-5 py-3.5 text-right">Journey</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-800/30 transition cursor-pointer"
                    onClick={() => openProjectJourney(p)}
                  >
                    <td className="px-5 py-4">
                      <div className="font-mono text-xs font-bold text-violet-400">{p.projectCode}</div>
                      <div className="font-semibold text-white mt-0.5">{p.title}</div>
                    </td>
                    <td className="px-5 py-4 text-xs">
                      <div className="text-slate-200">{p.clientName || "—"}</div>
                      {p.clientPhone && <div className="text-slate-500 font-mono">{p.clientPhone}</div>}
                    </td>
                    <td className="px-5 py-4 text-xs font-semibold">
                      <span className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">
                        {p.status}
                      </span>
                    </td>
                    <td className="px-5 py-4">{renderHealthBadge(p.healthStatus)}</td>
                    <td className="px-5 py-4">
                      <div className="w-28">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-slate-300">{p.progressPercent}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-violet-500 rounded-full"
                            style={{ width: `${p.progressPercent}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-xs">
                      <div className="flex items-center gap-1 text-slate-300">
                        <Users className="w-3.5 h-3.5 text-slate-500" />
                        <span>{p.members.length} members</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-xs max-w-xs">
                      {p.nextStepAction ? (
                        <div>
                          <p className="text-violet-300 font-medium truncate">{p.nextStepAction}</p>
                          <p className="text-slate-500 text-[11px]">{p.nextStepOwner || "Assigned"}</p>
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-400">
                      {p.targetDeadline
                        ? new Date(p.targetDeadline).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "Open"}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openProjectJourney(p);
                        }}
                        className="p-2 rounded-lg bg-violet-600/10 text-violet-400 hover:bg-violet-600/20 transition"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* LIVING JOURNEY TIMELINE & SUPERVISION DRAWER (MODAL)                       */}
      {/* ========================================================================= */}
      {selectedProject && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-2xl bg-[#11141a] border-l border-slate-800 h-full overflow-y-auto flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
            {/* Drawer Header */}
            <div className="p-6 border-b border-slate-800 flex items-start justify-between bg-slate-950/40 sticky top-0 z-10">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono font-bold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded">
                    {selectedProject.projectCode}
                  </span>
                  {renderHealthBadge(selectedProject.healthStatus)}
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                    {selectedProject.status}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-white">{selectedProject.title}</h2>
                {selectedProject.clientName && (
                  <p className="text-xs text-slate-400 mt-1">
                    Client: <span className="text-slate-200">{selectedProject.clientName}</span>{" "}
                    {selectedProject.clientPhone && `(${selectedProject.clientPhone})`}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setSelectedProject(null);
                  setFullJourney(null);
                }}
                className="p-2 rounded-xl bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="p-6 space-y-6 flex-1">
              {journeyLoading ? (
                <div className="py-20 text-center">
                  <RefreshCw className="w-6 h-6 text-violet-500 animate-spin mx-auto mb-2" />
                  <p className="text-xs text-slate-400">Loading project audit history...</p>
                </div>
              ) : (
                <>
                  {/* Progress & Quick Stats Card */}
                  <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400 font-medium">Completion Progress</span>
                      <span className="text-lg font-bold text-violet-400">
                        {fullJourney?.progressPercent || selectedProject.progressPercent}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-600 to-emerald-400 rounded-full"
                        style={{
                          width: `${fullJourney?.progressPercent || selectedProject.progressPercent}%`,
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-2 text-xs border-t border-slate-800/60">
                      <div>
                        <span className="text-slate-500">Target Deadline:</span>
                        <p className="font-semibold text-slate-300 mt-0.5">
                          {selectedProject.targetDeadline
                            ? new Date(selectedProject.targetDeadline).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })
                            : "No deadline specified"}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Budget:</span>
                        <p className="font-semibold text-slate-300 mt-0.5">
                          {selectedProject.budget ? `₹${selectedProject.budget.toLocaleString("en-IN")}` : "Open"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Next Step / Baton Card */}
                  {(fullJourney?.nextStepAction || selectedProject.nextStepAction) && (
                    <div className="p-4 rounded-2xl bg-violet-950/20 border border-violet-500/30">
                      <div className="flex items-center gap-2 text-violet-300 font-semibold text-sm mb-1">
                        <Sparkles className="w-4 h-4 text-violet-400" />
                        Next Baton Pass (Immediate Step):
                      </div>
                      <p className="text-sm text-slate-200 mt-1">
                        {fullJourney?.nextStepAction || selectedProject.nextStepAction}
                      </p>
                      <div className="text-xs text-slate-400 mt-2 flex items-center gap-2">
                        <span>Assigned to:</span>
                        <span className="px-2 py-0.5 rounded bg-violet-600/20 text-violet-300 font-semibold">
                          {fullJourney?.nextStepOwner || selectedProject.nextStepOwner || "Team"}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Assigned Team Members */}
                  <div>
                    <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <Users className="w-4 h-4 text-violet-400" />
                      Assigned Team & Roles ({selectedProject.members.length})
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {selectedProject.members.map((m, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between"
                        >
                          <div>
                            <div className="text-sm font-semibold text-white">{m.name}</div>
                            <div className="text-xs text-violet-400 font-medium">{m.roleInProject}</div>
                          </div>
                          <a
                            href={`https://wa.me/${m.phone.replace(/\D/g, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition"
                            title="Message on WhatsApp"
                          >
                            <MessageSquare className="w-4 h-4" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Quick Update Form */}
                  <form
                    onSubmit={handlePostUpdate}
                    className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3"
                  >
                    <h4 className="text-xs uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5 text-violet-400" />
                      Post Update to Living Timeline
                    </h4>

                    <div>
                      <textarea
                        required
                        rows={2}
                        value={updateText}
                        onChange={(e) => setUpdateText(e.target.value)}
                        placeholder="E.g. Site survey completed. Measurements sent to CAD team..."
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Status / Sentiment</label>
                        <select
                          value={updateSentiment}
                          onChange={(e) => setUpdateSentiment(e.target.value as any)}
                          className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none"
                        >
                          <option value="POSITIVE">🟢 On Schedule / Success</option>
                          <option value="NEUTRAL">⚪ Regular Update</option>
                          <option value="BLOCKED">🔴 Blocked / Needs Attention</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Updated Progress %</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={updateProgress}
                          onChange={(e) => setUpdateProgress(e.target.value ? Number(e.target.value) : "")}
                          placeholder="0 - 100"
                          className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Next Step Action</label>
                        <input
                          type="text"
                          value={updateNextStep}
                          onChange={(e) => setUpdateNextStep(e.target.value)}
                          placeholder="What needs to happen next?"
                          className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Pass Baton To (Owner)</label>
                        <input
                          type="text"
                          value={updateNextOwner}
                          onChange={(e) => setUpdateNextOwner(e.target.value)}
                          placeholder="Name of next responsible member"
                          className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={notifyNextOwner}
                          onChange={(e) => setNotifyNextOwner(e.target.checked)}
                          className="rounded border-slate-700 text-violet-600 focus:ring-0"
                        />
                        <span>Alert next owner on WhatsApp</span>
                      </label>

                      <button
                        type="submit"
                        disabled={postingUpdate}
                        className="px-4 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition active:scale-95 disabled:opacity-50"
                      >
                        {postingUpdate ? "Posting..." : "Post Update"}
                      </button>
                    </div>
                  </form>

                  {/* Chronological Living Timeline */}
                  <div>
                    <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-violet-400" />
                      Living Journey Audit Trail
                    </h3>

                    <div className="relative pl-6 space-y-6 before:content-[''] before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                      {(fullJourney?.recentUpdates || fullJourney?.updates || selectedProject.recentUpdates || []).map(
                        (up, idx) => (
                          <div key={idx} className="relative group">
                            {/* Dot Indicator */}
                            <span
                              className={`absolute -left-6 top-1 w-2.5 h-2.5 rounded-full border-2 border-[#11141a] ${
                                up.sentiment === "POSITIVE"
                                  ? "bg-emerald-400"
                                  : up.sentiment === "BLOCKED"
                                  ? "bg-rose-400"
                                  : "bg-violet-400"
                              }`}
                            />

                            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                              <div className="flex items-center justify-between text-xs mb-1">
                                <div className="font-semibold text-white flex items-center gap-1.5">
                                  <span>{up.authorName}</span>
                                  {up.authorRole && (
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                                      {up.authorRole}
                                    </span>
                                  )}
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800/80 text-violet-400">
                                    {up.source === "WHATSAPP" ? "WhatsApp 💬" : "Web 🌐"}
                                  </span>
                                </div>
                                <span className="text-slate-500 text-[11px]">
                                  {new Date(up.createdAt).toLocaleDateString("en-IN", {
                                    day: "numeric",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>

                              <p className="text-xs text-slate-300 leading-relaxed">{up.updateText}</p>

                              {up.blockers && (
                                <div className="mt-2 p-2 rounded-lg bg-rose-950/30 border border-rose-500/20 text-xs text-rose-300">
                                  ⚠️ *Blocker:* {up.blockers}
                                </div>
                              )}

                              {up.nextStepSuggested && (
                                <div className="mt-1.5 text-[11px] text-violet-400 font-medium">
                                  🎯 Next: {up.nextStepSuggested}
                                </div>
                              )}
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CREATE NEW PROJECT MODAL                                                 */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-[#11141a] border border-slate-800 rounded-2xl p-6 shadow-2xl my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <FolderKanban className="w-5 h-5 text-violet-400" />
                  Launch New Business Project
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Set deliverables, assign team members, and let WhatsApp AI manage timeline tracking.
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Project Title <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="E.g. Sharma Residency Interior & Lighting"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">
                    Project Code (Optional)
                  </label>
                  <input
                    type="text"
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    placeholder="PRJ-101"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white font-mono uppercase focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Client Name</label>
                  <input
                    type="text"
                    value={formClientName}
                    onChange={(e) => setFormClientName(e.target.value)}
                    placeholder="Mr. Sharma"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Client Phone</label>
                  <input
                    type="text"
                    value={formClientPhone}
                    onChange={(e) => setFormClientPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Budget (₹)</label>
                  <input
                    type="number"
                    value={formBudget}
                    onChange={(e) => setFormBudget(e.target.value)}
                    placeholder="250000"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Target Deadline</label>
                  <input
                    type="date"
                    value={formDeadline}
                    onChange={(e) => setFormDeadline(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Stage</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value="PLANNING">Planning & Setup</option>
                    <option value="IN_PROGRESS">Active Execution</option>
                    <option value="REVIEW">Review & QC</option>
                    <option value="COMPLETED">Delivered</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Health Indicator</label>
                  <select
                    value={formHealth}
                    onChange={(e) => setFormHealth(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500"
                  >
                    <option value="ON_TRACK">🟢 On-Track</option>
                    <option value="AT_RISK">🟡 At-Risk</option>
                    <option value="DELAYED">🔴 Delayed</option>
                  </select>
                </div>
              </div>

              {/* Next Step Initial */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Initial Next Step</label>
                  <input
                    type="text"
                    value={formNextStep}
                    onChange={(e) => setFormNextStep(e.target.value)}
                    placeholder="E.g. Finalize 3D architectural drawings"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Next Step Owner</label>
                  <input
                    type="text"
                    value={formNextOwner}
                    onChange={(e) => setFormNextOwner(e.target.value)}
                    placeholder="E.g. Rahul Designer"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              {/* Team Members Assignment */}
              <div className="pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-violet-400" />
                    Assign Team Members & Designations
                  </label>
                  <button
                    type="button"
                    onClick={handleAddMemberRow}
                    className="text-xs text-violet-400 hover:text-violet-300 font-semibold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Member
                  </button>
                </div>

                <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                  {formMembers.map((m, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-4">
                        <input
                          type="text"
                          placeholder="Member Name"
                          value={m.name}
                          onChange={(e) => handleMemberChange(idx, "name", e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-violet-500"
                        />
                      </div>
                      <div className="col-span-4">
                        <input
                          type="text"
                          placeholder="WhatsApp Phone"
                          value={m.phone}
                          onChange={(e) => handleMemberChange(idx, "phone", e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-violet-500"
                        />
                      </div>
                      <div className="col-span-3">
                        <input
                          type="text"
                          placeholder="Project Role (e.g. Designer)"
                          value={m.roleInProject}
                          onChange={(e) => handleMemberChange(idx, "roleInProject", e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-violet-500"
                        />
                      </div>
                      <div className="col-span-1 text-center">
                        {formMembers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMemberRow(idx)}
                            className="text-slate-500 hover:text-rose-400 p-1"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notification Checkbox */}
              <div className="pt-2">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyMembersOnWhatsApp}
                    onChange={(e) => setNotifyMembersOnWhatsApp(e.target.checked)}
                    className="rounded border-slate-700 text-violet-600 focus:ring-0"
                  />
                  <span>Dispatch WhatsApp welcome & assignment notifications to assigned members now</span>
                </label>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-slate-400 hover:text-white border border-slate-800 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm shadow-lg shadow-violet-600/20 transition active:scale-95 disabled:opacity-50"
                >
                  {creating ? "Launching..." : "Launch Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
