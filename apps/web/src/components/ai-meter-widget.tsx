"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Cpu,
  Gauge,
  Play,
  RefreshCw,
  Sparkles,
  Zap,
} from "lucide-react";

export type AiMeterData = {
  usage: {
    todayCount: number;
    monthCount: number;
    totalCount: number;
    monthlyQuota: number;
    percentUsed: number;
    handoffCount: number;
    openCount: number;
  };
  providers: {
    active: "sarvam" | "gemini" | "none";
    sarvam: {
      configured: boolean;
      model: string;
      name: string;
    };
    gemini: {
      configured: boolean;
      model: string;
      name: string;
    };
  };
  channels: Array<{
    channelId: string;
    displayName: string;
    phoneNumber: string | null;
    whatsappStatus: string;
    hasBotRecord: boolean;
    botEnabled: boolean;
    aiEnabled: boolean;
    agentName: string;
    engineProvider: string;
    statusLabel: string;
  }>;
};

export function AiMeterWidget({
  onRefreshParent,
}: {
  onRefreshParent?: () => void;
}) {
  const [data, setData] = useState<AiMeterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs: number;
    message: string;
    provider: string;
    status: number;
  } | null>(null);
  const [resumeMsg, setResumeMsg] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const fetchMeter = async () => {
    try {
      setLoading(true);
      const res = await api<{ success: true; data: AiMeterData }>("/api/v1/ai/meter");
      setData(res.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchMeter();
  }, []);

  const handleTestKey = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      const res = await api<{
        success: true;
        data: {
          ok: boolean;
          latencyMs: number;
          message: string;
          provider: string;
          status: number;
        };
      }>("/api/v1/ai/meter/test", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setTestResult(res.data);
    } catch (err: any) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        message: err?.message || "Failed to test AI key",
        provider: "unknown",
        status: 500,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleResumeAll = async () => {
    try {
      setResuming(true);
      setResumeMsg(null);
      const res = await api<{
        success: true;
        data: { resumedCount: number; message: string };
      }>("/api/v1/ai/meter/resume-all", {
        method: "POST",
      });
      setResumeMsg(res.data.message);
      await fetchMeter();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      setResumeMsg(err?.message || "Failed to resume conversations");
    } finally {
      setResuming(false);
    }
  };

  const usage = data?.usage;
  const providers = data?.providers;
  const activeChannel = data?.channels?.[0];

  const activeProviderName =
    providers?.active === "sarvam"
      ? "Sarvam AI (105B Indian Languages)"
      : providers?.active === "gemini"
      ? "Google Gemini Flash"
      : "Not Configured";

  return (
    <div className="mb-6 rounded-2xl border border-brand-500/30 bg-gradient-to-br from-ink-950 via-slate-950 to-ink-900 p-5 shadow-2xl backdrop-blur-md">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-brand-500 to-emerald-400 text-ink-950 shadow-lg shadow-brand-500/20">
            <Gauge className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight">
                AI Engine & Key Health Meter
              </h2>
              <span className="rounded-full bg-brand-500/20 px-2.5 py-0.5 text-[10px] font-bold text-brand-300 uppercase tracking-wider border border-brand-500/30">
                Kilometer Gauge
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Live API key monitoring, round-trip latency, and monthly AI response usage meter
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleTestKey()}
            disabled={testing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-500/40 bg-brand-500/10 px-3 py-2 text-xs font-semibold text-brand-200 transition-all hover:bg-brand-500/20 active:scale-95 disabled:opacity-50"
          >
            {testing ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-brand-400" />
                <span>Testing Key...</span>
              </>
            ) : (
              <>
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                <span>Test Connection</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => void fetchMeter()}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 transition-all hover:bg-white/10 active:scale-95 disabled:opacity-50"
            title="Refresh Meter"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-brand-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* Live Test Feedback Banner */}
      {testResult && (
        <div
          className={`mt-4 rounded-xl border p-3 text-xs transition-all ${
            testResult.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/40 bg-rose-500/10 text-rose-200"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
              )}
              <span>
                <b>{testResult.provider.toUpperCase()}</b>: {testResult.message}
              </span>
            </div>
            {testResult.latencyMs > 0 && (
              <span className="rounded bg-black/40 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-300 shrink-0">
                ⚡ {testResult.latencyMs}ms Latency
              </span>
            )}
          </div>
        </div>
      )}

      {/* Resume Message Banner */}
      {resumeMsg && (
        <div className="mt-4 rounded-xl border border-brand-500/40 bg-brand-500/15 p-3 text-xs text-brand-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-brand-400" />
            <span>{resumeMsg}</span>
          </div>
        </div>
      )}

      {/* Metric Cards Grid */}
      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Today's AI Replies */}
        <div className="rounded-xl border border-white/10 bg-black/40 p-3.5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Today&apos;s AI Replies</span>
            <Sparkles className="h-4 w-4 text-brand-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-white">
              {usage?.todayCount ?? 0}
            </span>
            <span className="text-[11px] text-slate-400">sent today</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            Total lifetime: <b>{usage?.totalCount ?? 0}</b> replies
          </p>
        </div>

        {/* Card 2: Monthly Quota Meter ("Kilometer") */}
        <div className="rounded-xl border border-white/10 bg-black/40 p-3.5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Monthly AI Meter</span>
            <Gauge className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-white">
              {usage?.monthCount ?? 0}
            </span>
            <span className="text-[11px] text-slate-400">
              / {(usage?.monthlyQuota ?? 5000).toLocaleString()}
            </span>
          </div>
          {/* Progress Bar ("Kilometer") */}
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-brand-400 to-amber-400 transition-all duration-500"
              style={{ width: `${Math.max(2, usage?.percentUsed ?? 0)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>{usage?.percentUsed ?? 0}% quota used</span>
            <span className="text-emerald-400 font-medium">Quota Available</span>
          </div>
        </div>

        {/* Card 3: AI Provider Key Health */}
        <div className="rounded-xl border border-white/10 bg-black/40 p-3.5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">API Key & Engine</span>
            <Cpu className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-2">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-sm font-bold text-white truncate">
                {activeProviderName}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                🟢 200 OK Active
              </span>
            </div>
          </div>
          <p className="mt-1 text-[10px] text-slate-400 truncate">
            Provider: {providers?.active.toUpperCase()}
          </p>
        </div>

        {/* Card 4: Human Handoff / Silence Lock */}
        <div className="rounded-xl border border-white/10 bg-black/40 p-3.5">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Bot Silence Status</span>
            <Activity className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold tracking-tight ${
                (usage?.handoffCount ?? 0) > 0 ? "text-amber-400" : "text-emerald-400"
              }`}
            >
              {usage?.handoffCount ?? 0}
            </span>
            <span className="text-[11px] text-slate-400">chats paused</span>
          </div>
          {(usage?.handoffCount ?? 0) > 0 ? (
            <button
              type="button"
              onClick={() => void handleResumeAll()}
              disabled={resuming}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500/20 px-2 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/30 active:scale-95 disabled:opacity-50"
            >
              <Play className="h-3 w-3 fill-amber-300" />
              <span>{resuming ? "Resuming..." : "Resume All to AI Bot"}</span>
            </button>
          ) : (
            <p className="mt-2 text-[10px] text-emerald-300 font-medium">
              ✓ All conversations active for AI replies
            </p>
          )}
        </div>
      </div>

      {/* Expandable Diagnostic Drawer */}
      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs text-brand-300 hover:underline flex items-center gap-1"
        >
          <span>{showDetails ? "Hide" : "View"} Channel Diagnostics & ChatBot Health</span>
          <span>{showDetails ? "▲" : "▼"}</span>
        </button>

        {activeChannel && (
          <span className="text-[11px] text-slate-400">
            Line: <b className="text-white">{activeChannel.displayName}</b> ·{" "}
            <span
              className={
                activeChannel.botEnabled ? "text-emerald-400" : "text-rose-400"
              }
            >
              {activeChannel.botEnabled ? "Bot ON" : "Bot OFF"}
            </span>
          </span>
        )}
      </div>

      {showDetails && (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/60 p-4 text-xs space-y-3">
          <h3 className="font-semibold text-white">Why might the AI chatbot not reply?</h3>
          <ul className="list-disc pl-4 space-y-1.5 text-slate-300">
            <li>
              <b>Human Takeover (Auto-Pause):</b> Whenever you or an agent send a WhatsApp message from your phone to a customer, the bot automatically pauses for that chat (HANDOFF mode) so human conversation isn&apos;t interrupted. It auto-resumes after 30 minutes of inactivity or click <b>Resume AI Bot</b> anytime.
            </li>
            <li>
              <b>Chatbot Master Switch:</b> Ensure the Chatbot Master Switch is toggled <b>ON</b> for your WhatsApp line below.
            </li>
            <li>
              <b>AI Knowledge Chat:</b> Ensure AI Knowledge Chat is <b>ON</b> so questions without exact keywords route to Sarvam AI / Gemini.
            </li>
            <li>
              <b>Lead Routing Match:</b> If an incoming text matches a Facebook Ad / Instagram Lead Routing Rule, it routes to the assigned human agent/group rather than the general AI bot.
            </li>
          </ul>

          {data?.channels && data.channels.length > 0 && (
            <div className="mt-3 border-t border-white/10 pt-3">
              <span className="font-semibold text-white">Connected WhatsApp Channels:</span>
              <div className="mt-2 divide-y divide-white/5">
                {data.channels.map((c) => (
                  <div
                    key={c.channelId}
                    className="py-2 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <span className="font-medium text-white">{c.displayName}</span>{" "}
                      <span className="text-slate-400">({c.phoneNumber || "No phone"})</span>
                      <div className="text-[10px] text-slate-400">
                        Agent: {c.agentName} · Engine: {c.engineProvider.toUpperCase()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          c.botEnabled
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-rose-500/20 text-rose-300"
                        }`}
                      >
                        {c.statusLabel}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
