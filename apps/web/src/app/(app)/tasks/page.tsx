"use client";

import { useEffect, useState, useCallback } from "react";
import {
  AlertCircle,
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  Loader2,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
import { api } from "@/lib/api";

interface TaskReminder {
  id: string;
  reminderAt: string;
  status: "PENDING" | "SENT" | "CANCELLED" | "SNOOZED";
  recipientPhone?: string | null;
  sentAt?: string | null;
}

interface BusinessTask {
  id: string;
  title: string;
  description?: string | null;
  dueAt: string;
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW";
  status: "TODO" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "CANCELLED" | "OVERDUE";
  source: "WHATSAPP" | "EMAIL" | "CALL" | "MANUAL" | "AI" | "SYSTEM";
  sourceReference?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  assignedTo?: string | null;
  assignedPhone?: string | null;
  recurrence: "NEVER" | "DAILY" | "WEEKLY" | "MONTHLY";
  recurrenceRule?: string | null;
  completedAt?: string | null;
  createdAt: string;
  reminders?: TaskReminder[];
  channel?: { id: string; displayName: string; phoneNumber: string; ownerPhone: string } | null;
}

interface TaskStats {
  todayCount: number;
  upcomingCount: number;
  overdueCount: number;
  completedCount: number;
}

export default function TasksPage() {
  const [stats, setStats] = useState<TaskStats>({
    todayCount: 0,
    upcomingCount: 0,
    overdueCount: 0,
    completedCount: 0,
  });
  const [tasks, setTasks] = useState<BusinessTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [activeTab, setActiveTab] = useState<"today" | "upcoming" | "overdue" | "completed" | "recurring" | "all">("today");
  const [selectedPriority, setSelectedPriority] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);

  // Modals & Actions
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [snoozeTaskId, setSnoozeTaskId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Form State
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formDueDate, setFormDueDate] = useState("");
  const [formDueTime, setFormDueTime] = useState("18:00");
  const [formPriority, setFormPriority] = useState<"URGENT" | "HIGH" | "MEDIUM" | "LOW">("MEDIUM");
  const [formContactName, setFormContactName] = useState("");
  const [formContactPhone, setFormContactPhone] = useState("");
  const [formRecurrence, setFormRecurrence] = useState<"NEVER" | "DAILY" | "WEEKLY" | "MONTHLY">("NEVER");
  const [formRemindAtDue, setFormRemindAtDue] = useState(true);
  const [formRemind15Min, setFormRemind15Min] = useState(false);
  const [formRemind1Hour, setFormRemind1Hour] = useState(true);
  const [formRemind1Day, setFormRemind1Day] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api<{ success: boolean; data: TaskStats }>("/api/v1/tasks/stats");
      if (res?.success && res.data) {
        setStats(res.data);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        tab: activeTab,
        page: page.toString(),
        pageSize: "30",
      });
      if (selectedPriority !== "ALL") params.append("priority", selectedPriority);
      if (searchQuery.trim()) params.append("search", searchQuery.trim());

      const res = await api<{
        success: boolean;
        data: { tasks: BusinessTask[]; total: number; page: number; pageSize: number };
      }>(`/api/v1/tasks?${params.toString()}`);

      if (res?.success && res.data) {
        setTasks(res.data.tasks || []);
        setTotal(res.data.total || 0);
      }
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab, selectedPriority, searchQuery, page]);

  useEffect(() => {
    fetchStats();
    fetchTasks();
  }, [fetchStats, fetchTasks]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchStats();
    fetchTasks();
  };

  const handleMarkComplete = async (taskId: string) => {
    try {
      setActionLoading(taskId);
      const res = await api<{ success: boolean }>(`/api/v1/tasks/${taskId}/complete`, {
        method: "POST",
      });
      if (res?.success) {
        setBannerMsg({ type: "success", text: "Task marked as completed! Pending reminders cleared." });
        fetchStats();
        fetchTasks();
      }
    } catch (err: any) {
      setBannerMsg({ type: "error", text: err?.message || "Failed to update task" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSnooze = async (taskId: string, options: { minutes?: number; tomorrow?: boolean }) => {
    try {
      setActionLoading(taskId);
      const res = await api<{ success: boolean }>(`/api/v1/tasks/${taskId}/snooze`, {
        method: "POST",
        body: JSON.stringify(options),
      });
      if (res?.success) {
        setBannerMsg({
          type: "success",
          text: options.tomorrow ? "Task shifted to tomorrow morning (9:00 AM)!" : `Task snoozed by ${options.minutes} minutes!`,
        });
        setSnoozeTaskId(null);
        fetchStats();
        fetchTasks();
      }
    } catch (err: any) {
      setBannerMsg({ type: "error", text: err?.message || "Failed to snooze task" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
      setActionLoading(taskId);
      const res = await api<{ success: boolean }>(`/api/v1/tasks/${taskId}`, {
        method: "DELETE",
      });
      if (res?.success) {
        setBannerMsg({ type: "success", text: "Task deleted successfully." });
        fetchStats();
        fetchTasks();
      }
    } catch (err: any) {
      setBannerMsg({ type: "error", text: err?.message || "Failed to delete task" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkShiftTomorrow = async () => {
    if (!confirm("Shift all pending tasks for today to tomorrow 9:00 AM?")) return;
    try {
      setShiftLoading(true);
      const res = await api<{ success: boolean; data: { shiftedCount: number } }>("/api/v1/tasks/shift-tomorrow", {
        method: "POST",
      });
      if (res?.success) {
        setBannerMsg({
          type: "success",
          text: `Shifted today's pending tasks to tomorrow morning!`,
        });
        fetchStats();
        fetchTasks();
      }
    } catch (err: any) {
      setBannerMsg({ type: "error", text: err?.message || "Failed to shift tasks" });
    } finally {
      setShiftLoading(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      alert("Please enter a task title.");
      return;
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const dateVal = formDueDate || todayIso;
    const timeVal = formDueTime || "18:00";
    const combinedIso = `${dateVal}T${timeVal}:00.000Z`;

    const reminderOffsets: number[] = [];
    if (formRemindAtDue) reminderOffsets.push(0);
    if (formRemind15Min) reminderOffsets.push(15);
    if (formRemind1Hour) reminderOffsets.push(60);
    if (formRemind1Day) reminderOffsets.push(1440);

    try {
      setActionLoading("create");
      const res = await api<{ success: boolean }>("/api/v1/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: formTitle.trim(),
          description: formDescription.trim() || undefined,
          dueAt: combinedIso,
          priority: formPriority,
          contactName: formContactName.trim() || undefined,
          contactPhone: formContactPhone.trim() || undefined,
          recurrence: formRecurrence,
          reminderOffsets: reminderOffsets.length > 0 ? reminderOffsets : [0],
        }),
      });

      if (res?.success) {
        setBannerMsg({ type: "success", text: "New task and WhatsApp reminders created successfully!" });
        setIsCreateModalOpen(false);
        setFormTitle("");
        setFormDescription("");
        setFormDueDate("");
        setFormContactName("");
        setFormContactPhone("");
        fetchStats();
        fetchTasks();
      }
    } catch (err: any) {
      setBannerMsg({ type: "error", text: err?.message || "Failed to create task" });
    } finally {
      setActionLoading(null);
    }
  };

  const priorityBadge = (p: string) => {
    switch (p) {
      case "URGENT":
        return "bg-rose-500/20 text-rose-300 border-rose-500/40";
      case "HIGH":
        return "bg-amber-500/20 text-amber-300 border-amber-500/40";
      case "MEDIUM":
        return "bg-sky-500/20 text-sky-300 border-sky-500/40";
      default:
        return "bg-slate-500/20 text-slate-300 border-slate-500/40";
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Banner */}
      {bannerMsg && (
        <div
          className={`flex items-center justify-between px-4 py-3 rounded-2xl border shadow-lg transition-all duration-300 ${
            bannerMsg.type === "success"
              ? "bg-emerald-950/80 border-emerald-500/40 text-emerald-200"
              : "bg-rose-950/80 border-rose-500/40 text-rose-200"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {bannerMsg.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <span className="text-sm font-medium">{bannerMsg.text}</span>
          </div>
          <button
            onClick={() => setBannerMsg(null)}
            className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Tasks &amp; Reminders
            </h1>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              WhatsApp Sync Active
            </span>
          </div>
          <p className="text-sm text-slate-300 mt-1">
            Create tasks from Web or WhatsApp voice/text. AI tracks deadlines and sends interactive WhatsApp alerts with 1-tap actions.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 shadow-sm transition"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin text-emerald-400" : ""}`} />
          </button>

          <button
            onClick={handleBulkShiftTomorrow}
            disabled={shiftLoading}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 text-xs font-semibold shadow-sm transition"
            title="Shift remaining today tasks to tomorrow morning"
          >
            {shiftLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
            Shift Today to Tomorrow
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-sm font-bold shadow-lg shadow-emerald-500/20 transition"
          >
            <Plus className="w-4 h-4" />
            Add Task
          </button>
        </div>
      </div>

      {/* Stats Counter Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div
          onClick={() => setActiveTab("today")}
          className={`cursor-pointer p-4 rounded-2xl border transition-all ${
            activeTab === "today"
              ? "bg-emerald-500/10 border-emerald-500/50 shadow-lg ring-1 ring-emerald-500/40"
              : "bg-black/40 border-white/10 hover:border-white/20 shadow-sm backdrop-blur-md"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-300">
            <span>Due Today</span>
            <Clock className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{stats.todayCount}</span>
            <span className="text-xs text-slate-400">tasks</span>
          </div>
        </div>

        <div
          onClick={() => setActiveTab("overdue")}
          className={`cursor-pointer p-4 rounded-2xl border transition-all ${
            activeTab === "overdue"
              ? "bg-rose-500/10 border-rose-500/50 shadow-lg ring-1 ring-rose-500/40"
              : "bg-black/40 border-white/10 hover:border-white/20 shadow-sm backdrop-blur-md"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-300">
            <span>Overdue</span>
            <AlertCircle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-rose-400">{stats.overdueCount}</span>
            <span className="text-xs text-slate-400">pending</span>
          </div>
        </div>

        <div
          onClick={() => setActiveTab("upcoming")}
          className={`cursor-pointer p-4 rounded-2xl border transition-all ${
            activeTab === "upcoming"
              ? "bg-sky-500/10 border-sky-500/50 shadow-lg ring-1 ring-sky-500/40"
              : "bg-black/40 border-white/10 hover:border-white/20 shadow-sm backdrop-blur-md"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-300">
            <span>Upcoming</span>
            <Calendar className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-sky-300">{stats.upcomingCount}</span>
            <span className="text-xs text-slate-400">scheduled</span>
          </div>
        </div>

        <div
          onClick={() => setActiveTab("completed")}
          className={`cursor-pointer p-4 rounded-2xl border transition-all ${
            activeTab === "completed"
              ? "bg-white/10 border-white/30 shadow-lg ring-1 ring-white/20"
              : "bg-black/40 border-white/10 hover:border-white/20 shadow-sm backdrop-blur-md"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-300">
            <span>Completed</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{stats.completedCount}</span>
            <span className="text-xs text-slate-400">done</span>
          </div>
        </div>
      </div>

      {/* Tabs & Search Filter Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-black/40 p-3 rounded-2xl border border-white/10 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {(
            [
              { id: "today", label: "Today" },
              { id: "upcoming", label: "Upcoming" },
              { id: "overdue", label: "Overdue" },
              { id: "completed", label: "Completed" },
              { id: "recurring", label: "Recurring" },
              { id: "all", label: "All Tasks" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setPage(1);
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                activeTab === tab.id
                  ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                  : "text-slate-300 hover:text-white hover:bg-white/5"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          {/* Priority Filter */}
          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className="px-3 py-2 rounded-xl border border-white/15 bg-ink-800 text-xs text-white focus:border-emerald-500 focus:outline-none"
          >
            <option value="ALL" className="bg-[#0b1320] text-white">All Priorities</option>
            <option value="URGENT" className="bg-[#0b1320] text-rose-300">🚨 Urgent</option>
            <option value="HIGH" className="bg-[#0b1320] text-amber-300">⚡ High</option>
            <option value="MEDIUM" className="bg-[#0b1320] text-sky-300">📌 Medium</option>
            <option value="LOW" className="bg-[#0b1320] text-slate-300">☕ Low</option>
          </select>

          {/* Search Input */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search tasks, clients..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-white/15 bg-ink-800 text-xs text-white placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Task Cards List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-16 bg-black/40 rounded-2xl border border-white/10 backdrop-blur-md text-slate-300 shadow-sm">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-3" />
          <p className="text-sm font-medium">Loading tasks &amp; reminders...</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 bg-black/40 rounded-2xl border border-white/10 backdrop-blur-md shadow-sm text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mb-4">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h3 className="text-base font-semibold text-white">No tasks found</h3>
          <p className="text-xs text-slate-400 max-w-sm mt-1">
            {activeTab === "today"
              ? "You have no pending tasks scheduled for today. Create a task or send a voice/text message to the WhatsApp Commander bot!"
              : "No tasks match your current filter."}
          </p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="mt-5 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold shadow-md shadow-emerald-500/20 transition"
          >
            <Plus className="w-4 h-4" />
            Create Task
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const isCompleted = task.status === "COMPLETED";
            const dueObj = new Date(task.dueAt);
            const isOverdue = !isCompleted && dueObj.getTime() < Date.now();

            return (
              <div
                key={task.id}
                className={`p-4 rounded-2xl border transition-all backdrop-blur-md ${
                  isCompleted
                    ? "bg-black/25 border-white/5 opacity-60"
                    : isOverdue
                      ? "bg-rose-950/20 border-rose-500/40 hover:border-rose-500/60 shadow-md"
                      : "bg-black/40 border-white/10 hover:border-white/20 shadow-sm"
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Left: Task Info */}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider border ${priorityBadge(
                          task.priority,
                        )}`}
                      >
                        {task.priority}
                      </span>

                      {task.recurrence && task.recurrence !== "NEVER" && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          <Repeat className="w-3 h-3" />
                          {task.recurrence}
                        </span>
                      )}

                      <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-white/10 text-slate-300">
                        {task.source === "WHATSAPP" ? "WhatsApp Bot" : task.source === "EMAIL" ? "Email AI" : "Manual"}
                      </span>

                      <span
                        className={`text-xs font-semibold flex items-center gap-1 ${
                          isOverdue ? "text-rose-400" : "text-emerald-400"
                        }`}
                      >
                        <Clock className="w-3.5 h-3.5" />
                        {dueObj.toLocaleString("en-IN", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {isOverdue && " (Overdue)"}
                      </span>
                    </div>

                    <h4
                      className={`text-base font-semibold ${
                        isCompleted ? "line-through text-slate-500" : "text-white"
                      }`}
                    >
                      {task.title}
                    </h4>

                    {task.description && (
                      <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">{task.description}</p>
                    )}

                    {/* Contact details & Reminders */}
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-slate-400">
                      {task.contactName && (
                        <div className="flex items-center gap-1.5 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10 text-slate-200">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-semibold text-white">{task.contactName}</span>
                          {task.contactPhone && (
                            <a
                              href={`tel:${task.contactPhone}`}
                              className="text-emerald-400 hover:underline flex items-center gap-0.5 ml-1 font-medium"
                            >
                              <Phone className="w-3 h-3" />
                              {task.contactPhone}
                            </a>
                          )}
                        </div>
                      )}

                      {task.reminders && task.reminders.length > 0 && (
                        <div className="flex items-center gap-1.5 text-[11px] text-amber-300">
                          <Bell className="w-3.5 h-3.5 text-amber-400" />
                          <span>
                            {task.reminders.filter((r) => r.status === "PENDING").length} WhatsApp reminder alert(s) scheduled
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {!isCompleted && (
                      <>
                        <button
                          onClick={() => handleMarkComplete(task.id)}
                          disabled={actionLoading === task.id}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold transition"
                        >
                          {actionLoading === task.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          )}
                          Done
                        </button>

                        <div className="relative">
                          <button
                            onClick={() => setSnoozeTaskId(snoozeTaskId === task.id ? null : task.id)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 text-xs font-semibold transition"
                          >
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            Snooze
                          </button>

                          {/* Snooze Dropdown */}
                          {snoozeTaskId === task.id && (
                            <div className="absolute right-0 mt-1.5 w-48 bg-[#0c1424] rounded-2xl shadow-2xl border border-white/15 py-2 z-20 backdrop-blur-xl">
                              <button
                                onClick={() => handleSnooze(task.id, { minutes: 30 })}
                                className="w-full text-left px-3.5 py-2 text-xs text-slate-200 hover:bg-white/10 font-medium"
                              >
                                ⏰ 30 Minutes
                              </button>
                              <button
                                onClick={() => handleSnooze(task.id, { minutes: 60 })}
                                className="w-full text-left px-3.5 py-2 text-xs text-slate-200 hover:bg-white/10 font-medium"
                              >
                                ⏰ 1 Hour
                              </button>
                              <button
                                onClick={() => handleSnooze(task.id, { tomorrow: true })}
                                className="w-full text-left px-3.5 py-2 text-xs text-slate-200 hover:bg-white/10 font-medium"
                              >
                                🌙 Tomorrow 9:00 AM
                              </button>
                            </div>
                          )}
                        </div>

                        {task.contactPhone && (
                          <a
                            href={`tel:${task.contactPhone}`}
                            className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-emerald-500/20 text-emerald-400 transition"
                            title="Call Contact"
                          >
                            <PhoneCall className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </>
                    )}

                    <button
                      onClick={() => handleDelete(task.id)}
                      disabled={actionLoading === task.id}
                      className="p-2 rounded-xl border border-white/10 bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition"
                      title="Delete Task"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Task Modal (Crystal Clear Dark Theme) */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#0c1424] rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-white/15 text-white animate-in fade-in zoom-in-95 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div>
                <h3 className="text-lg font-bold text-white">Create New Task</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Set deadlines and automated WhatsApp reminder alerts
                </p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="mt-4 space-y-4">
              {/* Task Title (Hindi / English naturally supported) */}
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                  Task Title <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Call Rahul for invoice follow-up / कल GST फाइल करना है"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-white/15 bg-ink-800 text-sm text-white placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                  Description / Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Add any specific context or action checklist..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-white/15 bg-ink-800 text-sm text-white placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {/* Due Date & Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-white/15 bg-ink-800 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Due Time
                  </label>
                  <input
                    type="time"
                    value={formDueTime}
                    onChange={(e) => setFormDueTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-white/15 bg-ink-800 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Priority & Recurrence */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Priority
                  </label>
                  <select
                    value={formPriority}
                    onChange={(e) => setFormPriority(e.target.value as any)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-white/15 bg-ink-800 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="LOW" className="bg-[#0c1424] text-slate-200">☕ Low</option>
                    <option value="MEDIUM" className="bg-[#0c1424] text-sky-300">📌 Medium</option>
                    <option value="HIGH" className="bg-[#0c1424] text-amber-300">⚡ High</option>
                    <option value="URGENT" className="bg-[#0c1424] text-rose-300">🚨 Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Recurrence
                  </label>
                  <select
                    value={formRecurrence}
                    onChange={(e) => setFormRecurrence(e.target.value as any)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-white/15 bg-ink-800 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="NEVER" className="bg-[#0c1424] text-slate-200">One Time</option>
                    <option value="DAILY" className="bg-[#0c1424] text-slate-200">Daily</option>
                    <option value="WEEKLY" className="bg-[#0c1424] text-slate-200">Weekly</option>
                    <option value="MONTHLY" className="bg-[#0c1424] text-slate-200">Monthly</option>
                  </select>
                </div>
              </div>

              {/* Contact Attachment */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Client / Contact Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Rahul Sharma"
                    value={formContactName}
                    onChange={(e) => setFormContactName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-white/15 bg-ink-800 text-sm text-white placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Contact Phone Number
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. +919876543210"
                    value={formContactPhone}
                    onChange={(e) => setFormContactPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-white/15 bg-ink-800 text-sm text-white placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Reminder Alerts Checkboxes */}
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-2">
                  WhatsApp Alert Timing
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={formRemindAtDue}
                      onChange={(e) => setFormRemindAtDue(e.target.checked)}
                      className="rounded accent-emerald-500 w-4 h-4 cursor-pointer"
                    />
                    <span className="font-medium text-slate-200">At due time</span>
                  </label>
                  <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={formRemind15Min}
                      onChange={(e) => setFormRemind15Min(e.target.checked)}
                      className="rounded accent-emerald-500 w-4 h-4 cursor-pointer"
                    />
                    <span className="font-medium text-slate-200">15 min before</span>
                  </label>
                  <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={formRemind1Hour}
                      onChange={(e) => setFormRemind1Hour(e.target.checked)}
                      className="rounded accent-emerald-500 w-4 h-4 cursor-pointer"
                    />
                    <span className="font-medium text-slate-200">1 hour before</span>
                  </label>
                  <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={formRemind1Day}
                      onChange={(e) => setFormRemind1Day(e.target.checked)}
                      className="rounded accent-emerald-500 w-4 h-4 cursor-pointer"
                    />
                    <span className="font-medium text-slate-200">1 day before</span>
                  </label>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-white/15 text-xs font-semibold text-slate-300 hover:bg-white/5 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === "create"}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 transition"
                >
                  {actionLoading === "create" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
