"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { formatCallDuration, callResultLabel } from "@/lib/call-log";
import { CallTranscriptButton } from "@/components/call-transcript";
import { CallRecordingActions } from "@/components/call-recording-actions";

type Report = {
  contacts: number;
  messages: { total: number; sent: number; failed: number; queued: number };
  calls: { total: number; connected: number; unanswered: number; failed: number; inProgress: number };
};

type Campaign = {
  id: string;
  name: string;
  type: string;
  status: string;
  scheduleAt?: string | null;
  messageBody?: string | null;
  contactList?: { id: string; name: string } | null;
  recording?: { name: string } | null;
  voiceTemplate?: { name: string } | null;
  messageTemplate?: { name: string } | null;
  aiConfig?: { name: string } | null;
};

type MessageRow = {
  id: string;
  phone: string;
  body: string;
  status: string;
  error?: string | null;
  createdAt: string;
  contact?: { name: string } | null;
};

type ContactRow = {
  id: string;
  status: string;
  attempts: number;
  contact: { id: string; name: string; phone: string };
  lastCall: {
    id: string;
    status: string;
    outcome?: string | null;
    durationMs?: number | null;
    answeredAt?: string | null;
    hasRecording: boolean;
    hasTranscript?: boolean;
  } | null;
};

export default function CampaignReportPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const res = await api<{
      success: true;
      data: {
        campaign: Campaign;
        report: Report;
        messages: MessageRow[];
        contacts: ContactRow[];
      };
    }>(`/api/v1/campaigns/${id}`);
    setCampaign(res.data.campaign);
    setReport(res.data.report);
    setMessages(res.data.messages);
    setContacts(res.data.contacts);
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(action: "start" | "pause" | "stop") {
    setError("");
    try {
      await api(`/api/v1/campaigns/${id}/${action}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    }
  }

  if (!campaign || !report) {
    return (
      <div>
        <PageHeader title="Campaign" subtitle="Loading report…" />
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      </div>
    );
  }

  const isMessage = campaign.type === "MESSAGE";

  return (
    <div>
      <PageHeader
        title={campaign.name}
        subtitle={`${labelForType(campaign.type)}${campaign.contactList ? ` · ${campaign.contactList.name}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/campaigns" className="min-h-10 rounded-lg bg-white/10 px-3 py-2 text-sm">
              All campaigns
            </Link>
            {campaign.status === "DRAFT" || campaign.status === "SCHEDULED" || campaign.status === "PAUSED" ? (
              <button
                className="min-h-10 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-ink-950"
                onClick={() => void act("start")}
              >
                Start
              </button>
            ) : null}
            {campaign.status === "RUNNING" ? (
              <button className="min-h-10 rounded-lg bg-white/10 px-3 py-2 text-sm" onClick={() => void act("pause")}>
                Pause
              </button>
            ) : null}
            {campaign.status === "RUNNING" || campaign.status === "PAUSED" || campaign.status === "SCHEDULED" ? (
              <button className="min-h-10 rounded-lg bg-white/10 px-3 py-2 text-sm" onClick={() => void act("stop")}>
                Stop
              </button>
            ) : null}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={campaign.status} />
        {campaign.scheduleAt ? (
          <span className="text-xs text-slate-500">
            Scheduled {new Date(campaign.scheduleAt).toLocaleString()}
          </span>
        ) : null}
        {campaign.recording ? <span className="text-xs text-slate-500">{campaign.recording.name}</span> : null}
        {campaign.voiceTemplate ? <span className="text-xs text-slate-500">{campaign.voiceTemplate.name}</span> : null}
        {campaign.messageTemplate ? (
          <span className="text-xs text-slate-500">{campaign.messageTemplate.name}</span>
        ) : null}
        {campaign.aiConfig ? <span className="text-xs text-slate-500">{campaign.aiConfig.name}</span> : null}
      </div>
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Contacts" value={report.contacts} />
        {isMessage ? (
          <>
            <Stat label="Messages sent" value={report.messages.sent} />
            <Stat label="Failed" value={report.messages.failed} />
            <Stat label="Queued" value={report.messages.queued} />
          </>
        ) : (
          <>
            <Stat label="Calls placed" value={report.calls.total} />
            <Stat label="Connected" value={report.calls.connected} />
            <Stat label="Unanswered" value={report.calls.unanswered} />
            <Stat label="Failed" value={report.calls.failed} />
          </>
        )}
      </div>

      {isMessage ? (
        <section>
          <h2 className="mb-3 text-sm font-medium text-white">Messages</h2>
          <ul className="space-y-2">
            {messages.map((m) => (
              <li key={m.id} className="rounded-xl border border-white/10 bg-ink-900/80 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-white">{m.contact?.name || m.phone}</span>
                  <StatusBadge status={m.status} />
                </div>
                <p className="mt-1 text-xs text-slate-400">{m.body}</p>
                {m.error ? <p className="mt-1 text-xs text-rose-300">{m.error}</p> : null}
              </li>
            ))}
            {messages.length === 0 ? (
              <li className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">
                No messages yet. They appear here after the campaign starts.
              </li>
            ) : null}
          </ul>
        </section>
      ) : (
        <section>
          <h2 className="mb-3 text-sm font-medium text-white">Calls</h2>
          <ul className="space-y-2">
            {contacts.map((row) => {
              const call = row.lastCall;
              const connected = Boolean(call?.answeredAt);
              return (
                <li key={row.id} className="rounded-xl border border-white/10 bg-ink-900/80 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-white">{row.contact.name}</p>
                      <p className="text-xs text-slate-500">{row.contact.phone}</p>
                    </div>
                    <StatusBadge status={call?.status || row.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {call ? callResultLabel(call) : row.status} · {row.attempts} attempt
                    {row.attempts === 1 ? "" : "s"}
                    {call?.durationMs ? ` · ${formatCallDuration(call.durationMs)}` : ""}
                    {connected ? " · connected" : ""}
                  </p>
                  {call?.hasRecording || call?.hasTranscript ? (
                    <div className="mt-3 space-y-2">
                      {call.hasRecording ? <CallRecordingActions callId={call.id} /> : null}
                      <CallTranscriptButton callId={call.id} hasTranscript={call.hasTranscript} />
                    </div>
                  ) : connected ? (
                    <p className="mt-2 text-xs text-slate-500">Connected — recording is still saving.</p>
                  ) : null}
                </li>
              );
            })}
            {contacts.length === 0 ? (
              <li className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">
                Contacts for this campaign will show here with call results.
              </li>
            ) : null}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-ink-900/70 p-4">
      <div className="text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  );
}

function labelForType(type: string) {
  if (type === "RECORDED") return "WhatsApp voice · recorded";
  if (type === "TTS") return "WhatsApp voice · text";
  if (type === "AI_VOICE") return "WhatsApp voice · AI agent";
  if (type === "MESSAGE") return "WhatsApp message";
  return type;
}
