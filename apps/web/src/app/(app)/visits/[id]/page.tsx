"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Phone } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { ConnectionBadge } from "@/components/status-badge";

type Channel = { id: string; displayName: string; phoneNumber?: string | null; status: string };
type Agent = { id: string; name: string };
type Department = { id: string; name: string; channelId: string; channel?: Channel };
type Visit = {
  id: string;
  name: string;
  publicKey: string;
  greeting: string;
  buttonLabel: string;
  enabled: boolean;
  chatEnabled: boolean;
  callEnabled: boolean;
  aiEnabled: boolean;
  aiConfigId?: string | null;
  channel?: Channel;
  departments?: Department[];
};
type LiveVisitor = {
  id: string;
  name?: string | null;
  phone?: string | null;
  currentUrl: string;
  currentTitle: string;
  lastSeenAt: string;
  department?: { name: string } | null;
};
type Analytics = { live: number; chats24h: number; calls24h: number; pages: Array<{ url: string; title: string; views: number }> };
type Conversation = {
  id: string;
  name: string;
  phone: string;
  status: string;
  lastMessageAt: string;
  department?: { name: string } | null;
  messages?: Array<{ id: string; sender: string; body: string; createdAt: string }>;
};

export default function WebsiteVisitDeskPage() {
  const { id } = useParams<{ id: string }>();
  const [visit, setVisit] = useState<Visit | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [live, setLive] = useState<LiveVisitor[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [inbox, setInbox] = useState<Conversation[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<Conversation | null>(null);
  const [reply, setReply] = useState("");
  const [deptName, setDeptName] = useState("Support");
  const [deptChannel, setDeptChannel] = useState("");
  const [origin, setOrigin] = useState("");
  const [apiOrigin, setApiOrigin] = useState("");
  const [error, setError] = useState("");

  async function loadVisit() {
    const r = await api<{ success: true; data: Visit }>(`/api/v1/visits/${id}`);
    setVisit(r.data);
    if (!deptChannel && r.data.channel?.id) setDeptChannel(r.data.channel.id);
  }

  async function loadDesk() {
    const [l, a, c] = await Promise.all([
      api<{ success: true; data: LiveVisitor[] }>(`/api/v1/visits/${id}/live`),
      api<{ success: true; data: Analytics }>(`/api/v1/visits/${id}/analytics`),
      api<{ success: true; data: Conversation[] }>(`/api/v1/visits/${id}/conversations`),
    ]);
    setLive(l.data);
    setAnalytics(a.data);
    setInbox(c.data);
  }

  async function openChat(cid: string) {
    setOpenId(cid);
    const r = await api<{ success: true; data: Conversation }>(`/api/v1/visits/${id}/conversations/${cid}`);
    setThread(r.data);
  }

  useEffect(() => {
    setOrigin(window.location.origin);
    setApiOrigin(process.env.NEXT_PUBLIC_API_URL || window.location.origin);
    void loadVisit().catch((err) => setError(err instanceof Error ? err.message : "Could not load"));
    void loadDesk().catch(() => undefined);
    api<{ success: true; data: Channel[] }>("/api/v1/channels").then((r) => setChannels(r.data)).catch(() => undefined);
    api<{ success: true; data: { configs: Agent[] } }>("/api/v1/ai-configs")
      .then((r) => setAgents(r.data.configs ?? []))
      .catch(() => undefined);
    const t = setInterval(() => void loadDesk().catch(() => undefined), 4000);
    return () => clearInterval(t);
  }, [id]);

  useEffect(() => {
    if (!openId) return;
    const t = setInterval(() => void openChat(openId).catch(() => undefined), 2500);
    return () => clearInterval(t);
  }, [openId, id]);

  if (!visit) {
    return <p className="text-sm text-slate-400">{error || "Loading…"}</p>;
  }

  const snippet = `<script src="${origin}/widget.js" data-visit="${visit.publicKey}" data-api="${apiOrigin}"></script>`;

  return (
    <div>
      <PageHeader
        title={visit.name}
        subtitle="Live website visitors, WhatsApp support chat, departments, and AI."
        actions={
          <div className="flex gap-2">
            <Link href={`/visit/${visit.publicKey}`} target="_blank" className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-ink-950">
              Open preview
            </Link>
            <Link href="/visits" className="rounded-lg bg-white/10 px-3 py-1.5 text-sm">
              All websites
            </Link>
          </div>
        }
      />
      {error ? <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-ink-900/70 p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">Live now</div>
          <div className="mt-1 text-3xl font-semibold text-white">{analytics?.live ?? live.length}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-ink-900/70 p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">Chats (24h)</div>
          <div className="mt-1 text-3xl font-semibold text-white">{analytics?.chats24h ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-ink-900/70 p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">Calls (24h)</div>
          <div className="mt-1 text-3xl font-semibold text-white">{analytics?.calls24h ?? 0}</div>
        </div>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section className="rounded-2xl border border-white/10 bg-ink-900/70 p-5">
          <h2 className="mb-3 text-sm font-medium text-white">Who is on the site</h2>
          <ul className="space-y-2 text-sm">
            {live.map((row) => (
              <li key={row.id} className="rounded-xl border border-white/10 px-3 py-2">
                <div className="text-white">{row.name || "Visitor"} {row.phone ? `· ${row.phone}` : ""}</div>
                <div className="truncate text-xs text-slate-500">
                  {row.currentTitle || row.currentUrl || "Unknown page"}
                  {row.department ? ` · ${row.department.name}` : ""}
                </div>
              </li>
            ))}
            {live.length === 0 ? <li className="text-slate-500">No one on the website right now.</li> : null}
          </ul>
          <h3 className="mb-2 mt-5 text-xs uppercase tracking-wider text-slate-500">Pages today</h3>
          <ul className="space-y-1 text-xs text-slate-400">
            {(analytics?.pages ?? []).map((p) => (
              <li key={p.url} className="flex justify-between gap-3">
                <span className="truncate">{p.title || p.url}</span>
                <span className="text-slate-500">{p.views}</span>
              </li>
            ))}
            {!analytics?.pages.length ? <li>No page views yet. Embed the widget to start tracking.</li> : null}
          </ul>
        </section>

        <section className="rounded-2xl border border-white/10 bg-ink-900/70 p-5">
          <h2 className="mb-3 text-sm font-medium text-white">WhatsApp support inbox</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <ul className="max-h-80 space-y-1 overflow-auto text-sm">
              {inbox.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void openChat(c.id)}
                    className={`w-full rounded-xl px-3 py-2 text-left ${openId === c.id ? "bg-brand-500/15 text-white" : "bg-white/5 text-slate-300"}`}
                  >
                    <div className="truncate">{c.name || c.phone}</div>
                    <div className="truncate text-[11px] text-slate-500">
                      {c.department?.name} · {c.messages?.[0]?.body || "No messages"}
                    </div>
                  </button>
                </li>
              ))}
              {inbox.length === 0 ? <li className="text-slate-500">No chats yet.</li> : null}
            </ul>
            <div className="flex min-h-80 flex-col rounded-xl border border-white/10">
              {thread ? (
                <>
                  <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-sm">
                    <div>
                      <div className="text-white">{thread.name}</div>
                      <div className="text-[11px] text-slate-500">{thread.phone} · {thread.department?.name}</div>
                    </div>
                    <Phone className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="flex-1 space-y-2 overflow-auto p-3 text-sm">
                    {(thread.messages ?? []).map((m) => (
                      <div key={m.id} className={`max-w-[90%] rounded-xl px-3 py-2 ${m.sender === "visitor" || m.sender === "whatsapp" ? "ml-auto bg-brand-500/20 text-white" : "bg-white/5 text-slate-200"}`}>
                        <div className="text-[10px] uppercase text-slate-500">{m.sender}</div>
                        {m.body}
                      </div>
                    ))}
                  </div>
                  <form
                    className="flex gap-2 border-t border-white/10 p-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!reply.trim() || !openId) return;
                      try {
                        await api(`/api/v1/visits/${id}/conversations/${openId}/messages`, {
                          method: "POST",
                          body: JSON.stringify({ body: reply }),
                        });
                        setReply("");
                        await openChat(openId);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not send");
                      }
                    }}
                  >
                    <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply on WhatsApp…" />
                    <button className="rounded-lg bg-brand-500 px-3 text-sm font-medium text-ink-950">Send</button>
                  </form>
                </>
              ) : (
                <p className="m-auto text-sm text-slate-500">Select a chat</p>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-ink-900/70 p-5">
          <h2 className="mb-3 text-sm font-medium text-white">Departments / instances</h2>
          <ul className="mb-4 space-y-2">
            {(visit.departments ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm">
                <input
                  className="w-32"
                  defaultValue={d.name}
                  onBlur={async (e) => {
                    const name = e.target.value.trim();
                    if (!name || name === d.name) return;
                    await api(`/api/v1/visits/${id}/departments/${d.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
                    await loadVisit();
                  }}
                />
                <select
                  className="flex-1"
                  value={d.channelId}
                  onChange={async (e) => {
                    await api(`/api/v1/visits/${id}/departments/${d.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ channel_id: e.target.value }),
                    });
                    await loadVisit();
                  }}
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName} · {c.status}
                    </option>
                  ))}
                </select>
                <ConnectionBadge status={d.channel?.status ?? "DISCONNECTED"} />
                <button
                  className="text-xs text-rose-300"
                  onClick={async () => {
                    await api(`/api/v1/visits/${id}/departments/${d.id}`, { method: "DELETE" });
                    await loadVisit();
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <input className="w-36" value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="Department" />
            <select className="flex-1" value={deptChannel} onChange={(e) => setDeptChannel(e.target.value)}>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
            <button
              className="rounded-lg bg-white/10 px-3 py-2 text-sm"
              onClick={async () => {
                await api(`/api/v1/visits/${id}/departments`, {
                  method: "POST",
                  body: JSON.stringify({ name: deptName, channel_id: deptChannel }),
                });
                await loadVisit();
              }}
            >
              Add
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-ink-900/70 p-5">
          <h2 className="mb-3 text-sm font-medium text-white">AI + embed</h2>
          <label className="mb-3 flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={visit.aiEnabled}
              onChange={async (e) => {
                await api(`/api/v1/visits/${id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ ai_enabled: e.target.checked, ai_config_id: visit.aiConfigId || agents[0]?.id || null }),
                });
                await loadVisit();
              }}
            />
            AI chats with website visitors and can answer WhatsApp calls on these instances
          </label>
          <select
            className="mb-4"
            value={visit.aiConfigId ?? ""}
            onChange={async (e) => {
              await api(`/api/v1/visits/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ ai_config_id: e.target.value || null, ai_enabled: visit.aiEnabled }),
              });
              await loadVisit();
            }}
          >
            <option value="">Select AI agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div className="mb-4 flex flex-wrap gap-3 text-sm text-slate-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={visit.chatEnabled}
                onChange={async (e) => {
                  await api(`/api/v1/visits/${id}`, { method: "PATCH", body: JSON.stringify({ chat_enabled: e.target.checked }) });
                  await loadVisit();
                }}
              />
              Chat
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={visit.callEnabled}
                onChange={async (e) => {
                  await api(`/api/v1/visits/${id}`, { method: "PATCH", body: JSON.stringify({ call_enabled: e.target.checked }) });
                  await loadVisit();
                }}
              />
              Call button
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={visit.enabled}
                onChange={async (e) => {
                  await api(`/api/v1/visits/${id}`, { method: "PATCH", body: JSON.stringify({ enabled: e.target.checked }) });
                  await loadVisit();
                }}
              />
              Widget live
            </label>
          </div>
          <p className="mb-2 text-xs text-slate-500">Paste this on the website:</p>
          <pre className="overflow-x-auto rounded-xl bg-black/40 p-3 text-[11px] text-slate-300">{snippet}</pre>
        </section>
      </div>
    </div>
  );
}
