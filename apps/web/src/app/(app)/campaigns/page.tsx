"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { ListPagination } from "@/components/list-pagination";
import { emptyMeta, type ListMeta, type PageSize } from "@/lib/csv";

type Campaign = {
  id: string;
  name: string;
  type: string;
  status: string;
  scheduleAt?: string | null;
  rotationLimit?: number;
  channel?: { id: string; displayName: string; status: string };
  campaignChannels?: Array<{
    channel: { id: string; displayName: string; status: string; phoneNumber?: string | null };
  }>;
  contactList?: { id: string; name: string } | null;
  recording?: { id: string; name: string } | null;
  voiceTemplate?: { id: string; name: string } | null;
  messageTemplate?: { id: string; name: string } | null;
  aiConfig?: { id: string; name: string } | null;
  _count?: { campaignContacts: number; calls: number; messages: number };
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [meta, setMeta] = useState<ListMeta>(emptyMeta(25));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(pageNum = page, limit = pageSize) {
    setLoading(true);
    try {
      const res = await api<{ success: true; data: Campaign[]; meta?: ListMeta }>(
        `/api/v1/campaigns?page=${pageNum}&limit=${limit}`,
      );
      setCampaigns(res.data);
      setMeta(res.meta ?? { ...emptyMeta(limit), total: res.data?.length ?? 0, page: pageNum });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [page, pageSize]);

  async function act(id: string, action: "start" | "pause" | "stop", e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError("");
    try {
      await api(`/api/v1/campaigns/${id}/${action}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    }
  }

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle="WhatsApp voice or message campaigns. Tap a campaign to see reporting."
        actions={
          <Link
            href="/campaigns/new"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-violet-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-violet-500/20 hover:bg-violet-400"
          >
            Create campaign
          </Link>
        }
      />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}{" "}
          {error.toLowerCase().includes("connect") ? (
            <Link href="/channels" className="font-medium text-brand-400 underline">
              Open WhatsApp
            </Link>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-3">
        {campaigns.map((c) => {
          const lines = c.campaignChannels?.length
            ? c.campaignChannels.map((row) => row.channel.displayName).join(", ")
            : c.channel?.displayName ?? "channel";
          return (
            <Link
              key={c.id}
              href={`/campaigns/${c.id}`}
              className="surface block p-4 transition hover:-translate-y-0.5 hover:ring-1 hover:ring-violet-400/30"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">{c.name}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    {labelForType(c.type)}
                    {c.contactList ? ` · ${c.contactList.name}` : ""} · {c._count?.campaignContacts ?? 0}{" "}
                    contacts
                    {c.type === "MESSAGE"
                      ? ` · ${c._count?.messages ?? 0} messages`
                      : ` · ${c._count?.calls ?? 0} calls`}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {lines}
                    {c.scheduleAt && c.status === "SCHEDULED"
                      ? ` · scheduled ${new Date(c.scheduleAt).toLocaleString()}`
                      : ""}
                    {c.recording ? ` · ${c.recording.name}` : ""}
                    {c.voiceTemplate ? ` · ${c.voiceTemplate.name}` : ""}
                    {c.messageTemplate ? ` · ${c.messageTemplate.name}` : ""}
                    {c.aiConfig ? ` · ${c.aiConfig.name}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  {c.status === "DRAFT" || c.status === "SCHEDULED" || c.status === "PAUSED" ? (
                    <button
                      className="min-h-10 rounded-lg bg-brand-500/20 px-3 py-1.5 text-brand-400"
                      onClick={(e) => void act(c.id, "start", e)}
                    >
                      Start
                    </button>
                  ) : null}
                  {c.status === "RUNNING" ? (
                    <button
                      className="min-h-10 rounded-lg bg-white/10 px-3 py-1.5"
                      onClick={(e) => void act(c.id, "pause", e)}
                    >
                      Pause
                    </button>
                  ) : null}
                  {c.status === "RUNNING" || c.status === "PAUSED" || c.status === "SCHEDULED" ? (
                    <button
                      className="min-h-10 rounded-lg bg-white/10 px-3 py-1.5"
                      onClick={(e) => void act(c.id, "stop", e)}
                    >
                      Stop
                    </button>
                  ) : null}
                </div>
              </div>
            </Link>
          );
        })}
        {!loading && campaigns.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">
            No campaigns yet.{" "}
            <Link className="text-brand-400 underline" href="/campaigns/new">
              Create one
            </Link>{" "}
            after you add a contact group.
          </div>
        ) : null}
      </div>
      <ListPagination
        meta={meta}
        loading={loading}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </div>
  );
}

function labelForType(type: string) {
  if (type === "RECORDED") return "Voice · recorded";
  if (type === "TTS") return "Voice · text";
  if (type === "AI_VOICE") return "Voice · AI agent";
  if (type === "MESSAGE") return "WhatsApp message";
  if (type === "SEQUENTIAL") return "Voice";
  return type;
}
