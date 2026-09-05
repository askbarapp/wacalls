"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Clock, Megaphone, Sparkles, Upload, Volume2, X } from "lucide-react";
import { api, getAccessToken } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { TemplateKindBadge } from "@/components/message-template-form";

type Channel = {
  id: string;
  displayName: string;
  status: string;
  phoneNumber?: string | null;
  provider?: string;
};
type List = { id: string; name: string; _count?: { members: number }; verifiedCount?: number };
type Recording = { id: string; name: string };
type Agent = { id: string; name: string; provider?: string | null; knowledgeBase?: { name: string } | null };
type MsgTemplate = { id: string; name: string; body: string; kind?: string };
type Lang = { code: string; label: string };

const DEFAULT_SCRIPT =
  "Hello {{name}}, this is a reminder about your appointment. Please call us back if you need to reschedule.";

const VARS = [
  { token: "{{name}}", label: "name" },
  { token: "{{phone}}", label: "phone" },
  { token: "{{email}}", label: "email" },
] as const;

function paceFromInstructions(text: string) {
  const t = text.toLowerCase();
  if (/\bslow|calm|gently\b/.test(t)) return 0.85;
  if (/\bfast|quick|upbeat\b/.test(t)) return 1.15;
  return 1;
}

function speakerLabel(id: string) {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export default function NewCampaignPage() {
  const router = useRouter();
  const scriptRef = useRef<HTMLTextAreaElement>(null);
  const [kind, setKind] = useState<"voice" | "message" | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [starters, setStarters] = useState<MsgTemplate[]>([]);
  const [customTemplates, setCustomTemplates] = useState<MsgTemplate[]>([]);
  const [languages, setLanguages] = useState<Lang[]>([]);
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [sarvam, setSarvam] = useState({ configured: false });
  const [gemini, setGemini] = useState({ configured: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [form, setForm] = useState({
    name: "",
    contactListId: "",
    channelId: "",
    voiceType: "TTS" as "RECORDED" | "TTS" | "AI_VOICE",
    recordingId: "",
    aiConfigId: "",
    ttsBody: DEFAULT_SCRIPT,
    ttsLanguage: "hi-IN",
    ttsSpeaker: "shubh",
    ttsInstructions: "Warm and friendly, speak slowly with a calm tone",
    delayBetweenCallsSec: 5,
    ringTimeoutSec: 60,
    batchSize: 0,
    sleepAfterBatchSec: 0,
    maxCallDurationSec: 0,
    messageTemplateId: "",
    messageBody: "",
    schedule: false,
    scheduleAt: "",
  });

  useEffect(() => {
    void Promise.all([
      api<{ success: true; data: Channel[] }>("/api/v1/channels"),
      api<{ success: true; data: List[] }>("/api/v1/contact-lists"),
      api<{ success: true; data: Recording[] }>("/api/v1/recordings"),
      api<{ success: true; data: { configs: Agent[] } }>("/api/v1/ai-configs"),
      api<{ success: true; data: { starter: MsgTemplate[]; custom: MsgTemplate[] } }>(
        "/api/v1/message-templates",
      ),
      api<{ success: true; data: { languages: Lang[]; speakers: string[] } }>("/api/v1/voice-templates/options"),
      api<{ success: true; data: { configured: boolean; envFallback?: boolean } }>("/api/v1/ai/sarvam").catch(() => ({
        data: { configured: false, envFallback: false },
      })),
      api<{ success: true; data: { configured: boolean; envFallback?: boolean } }>("/api/v1/ai/gemini").catch(() => ({
        data: { configured: false, envFallback: false },
      })),
    ])
      .then(([ch, l, rec, ai, msg, opts, key, gemKey]) => {
        setChannels(ch.data);
        setLists(l.data);
        setRecordings(rec.data);
        setAgents(ai.data.configs ?? []);
        setStarters(msg.data.starter ?? []);
        setCustomTemplates(msg.data.custom ?? []);
        setLanguages(opts.data.languages ?? []);
        setSpeakers(opts.data.speakers ?? []);
        setSarvam({ configured: Boolean(key.data.configured || key.data.envFallback) });
        setGemini({ configured: Boolean(gemKey.data.configured || gemKey.data.envFallback) });
        const web = ch.data.filter((x) => x.provider !== "CLOUD");
        const connected = web.find((x) => x.status === "CONNECTED") ?? web[0] ?? ch.data[0];
        setForm((f) => ({
          ...f,
          channelId: f.channelId || connected?.id || "",
          contactListId: f.contactListId || l.data[0]?.id || "",
          recordingId: rec.data[0]?.id || "",
          aiConfigId: ai.data.configs?.[0]?.id || "",
          ttsSpeaker: opts.data.speakers?.[0] || "shubh",
          ttsLanguage: opts.data.languages?.[0]?.code || "hi-IN",
          messageTemplateId: msg.data.starter?.[0]?.id || msg.data.custom?.[0]?.id || "",
        }));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  const selectedAiAgent = agents.find((a) => a.id === form.aiConfigId);
  const selectedAiProvider =
    (selectedAiAgent?.provider || "sarvam").toLowerCase() === "gemini" ? "gemini" : "sarvam";
  const aiKeyReady = selectedAiProvider === "gemini" ? gemini.configured : sarvam.configured;

  const voiceDevices = useMemo(
    () => channels.filter((c) => c.provider !== "CLOUD"),
    [channels],
  );
  const selectedGroup = lists.find((l) => l.id === form.contactListId);
  const allTemplates = [...starters, ...customTemplates];
  const selectedTemplate = allTemplates.find((t) => t.id === form.messageTemplateId);
  const unverified =
    selectedGroup && typeof selectedGroup.verifiedCount === "number" && (selectedGroup._count?.members ?? 0) > 0
      ? Math.max(0, (selectedGroup._count?.members ?? 0) - selectedGroup.verifiedCount)
      : 0;

  function insertVar(token: string) {
    const el = scriptRef.current;
    if (!el) {
      setForm((f) => ({ ...f, ttsBody: f.ttsBody + token }));
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = form.ttsBody.slice(0, start) + token + form.ttsBody.slice(end);
    setForm((f) => ({ ...f, ttsBody: next }));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function previewTts() {
    if (!form.ttsBody.trim()) {
      setError("Type a script before generating a preview.");
      return;
    }
    setError("");
    setPreviewing(true);
    try {
      const token = getAccessToken();
      const base = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
      const res = await fetch(`${base}/api/v1/voice-templates/preview`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          body: form.ttsBody,
          language: form.ttsLanguage,
          speaker: form.ttsSpeaker,
          pace: paceFromInstructions(form.ttsInstructions),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string }; message?: string };
        throw new Error(json.error?.message ?? json.message ?? "Preview failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate preview");
    } finally {
      setPreviewing(false);
    }
  }

  async function submitVoice() {
    setError("");
    if (!form.name.trim()) {
      setError("Enter a campaign name.");
      return;
    }
    if (!form.contactListId) {
      setError("Create a contact group first, then pick it here.");
      return;
    }
    if (!form.channelId) {
      setError("Connect a WhatsApp Web line first.");
      return;
    }
    if (form.voiceType === "TTS" && !form.ttsBody.trim()) {
      setError("Type a voice script.");
      return;
    }
    if (form.voiceType === "RECORDED" && !form.recordingId) {
      setError("Upload a recording first.");
      return;
    }
    if (form.voiceType === "AI_VOICE" && !form.aiConfigId) {
      setError("Create an AI agent on AI calling first.");
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        contactListId: form.contactListId,
        channelIds: [form.channelId],
        rotationLimit: 1,
        type: form.voiceType,
        sendNow: false,
        delayBetweenCallsSec: form.delayBetweenCallsSec,
        ringTimeoutSec: form.ringTimeoutSec,
        batchSize: form.batchSize,
        sleepAfterBatchSec: form.sleepAfterBatchSec,
      };
      if (form.voiceType === "AI_VOICE") {
        payload.aiConfigId = form.aiConfigId;
        if (form.maxCallDurationSec > 0) payload.maxCallDurationSec = form.maxCallDurationSec;
      }
      if (form.voiceType === "RECORDED") payload.recordingId = form.recordingId;
      if (form.voiceType === "TTS") {
        payload.ttsBody = form.ttsBody.trim();
        payload.ttsLanguage = form.ttsLanguage;
        payload.ttsSpeaker = form.ttsSpeaker;
        payload.ttsPace = paceFromInstructions(form.ttsInstructions);
      }
      const created = await api<{ success: true; data: { id: string } }>("/api/v1/campaigns", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      router.push(`/campaigns/${created.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create campaign");
    } finally {
      setBusy(false);
    }
  }

  async function submitMessage() {
    setError("");
    if (!form.name.trim()) {
      setError("Enter a campaign name.");
      return;
    }
    if (!form.contactListId) {
      setError("Create a contact group first, then pick it here.");
      return;
    }
    if (!form.messageTemplateId && !form.messageBody.trim()) {
      setError("Pick a message template or write a message.");
      return;
    }
    if (form.schedule && !form.scheduleAt) {
      setError("Pick a schedule time, or turn scheduling off to send now.");
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        contactListId: form.contactListId,
        channelIds: form.channelId ? [form.channelId] : channels.map((c) => c.id),
        type: "MESSAGE",
        sendNow: !form.schedule,
      };
      if (form.schedule && form.scheduleAt) payload.scheduleAt = new Date(form.scheduleAt).toISOString();
      if (form.messageTemplateId) payload.messageTemplateId = form.messageTemplateId;
      if (form.messageBody.trim()) payload.messageBody = form.messageBody.trim();
      const created = await api<{ success: true; data: { id: string } }>("/api/v1/campaigns", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      router.push(`/campaigns/${created.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create campaign");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Campaigns"
        subtitle="WhatsApp voice or message campaigns."
        actions={
          <Link href="/campaigns" className="text-sm text-slate-400 hover:text-white">
            Back
          </Link>
        }
      />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}{" "}
          {error.toLowerCase().includes("connect") || error.toLowerCase().includes("whatsapp web") ? (
            <Link href="/channels" className="font-medium text-brand-400 underline">
              Open WhatsApp
            </Link>
          ) : null}
          {error.toLowerCase().includes("group") || error.toLowerCase().includes("contacts") ? (
            <Link href="/contacts" className="font-medium text-brand-400 underline">
              Open Contacts
            </Link>
          ) : null}
          {error.toLowerCase().includes("sarvam") || error.toLowerCase().includes("gemini") ? (
            <Link href="/ai-calling" className="font-medium text-brand-400 underline">
              AI calling → API keys
            </Link>
          ) : null}
        </div>
      ) : null}

      {!kind ? (
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => setKind("voice")}
            className="min-h-[5.5rem] rounded-2xl border border-white/10 bg-ink-900/80 p-5 text-left hover:border-brand-400/50"
          >
            <div className="text-base font-medium text-white">WhatsApp voice campaign</div>
            <p className="mt-1 text-sm text-slate-400">
              Call a contact group with spoken text, an uploaded recording, or an AI agent.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setKind("message")}
            className="min-h-[5.5rem] rounded-2xl border border-white/10 bg-ink-900/80 p-5 text-left hover:border-brand-400/50"
          >
            <div className="text-base font-medium text-white">WhatsApp message campaign</div>
            <p className="mt-1 text-sm text-slate-400">Send a template message to a contact group.</p>
          </button>
        </div>
      ) : kind === "voice" ? (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-ink-900/80 shadow-xl shadow-black/20">
          <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500/15 text-brand-400">
                <Megaphone className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-white">New Campaign</h2>
                <p className="text-sm text-slate-400">Device, audience and voice</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setKind(null)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-5 px-5 py-5">
            <label className="block text-sm text-slate-300">
              Campaign name
              <input
                className="mt-1 min-h-11"
                placeholder="e.g. College follow-up"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-slate-300">
                Device
                <select
                  className="mt-1 min-h-11"
                  value={form.channelId}
                  onChange={(e) => setForm({ ...form, channelId: e.target.value })}
                >
                  {voiceDevices.length === 0 ? <option value="">No WhatsApp Web line</option> : null}
                  {voiceDevices.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.displayName}
                      {ch.phoneNumber ? ` · ${ch.phoneNumber}` : ""}
                      {ch.status === "CONNECTED" ? "" : " (disconnected)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-300">
                Contact group
                <select
                  className="mt-1 min-h-11"
                  value={form.contactListId}
                  onChange={(e) => setForm({ ...form, contactListId: e.target.value })}
                >
                  {lists.length === 0 ? <option value="">No groups yet</option> : null}
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {typeof l._count?.members === "number" ? ` · ${l._count.members}` : ""}
                      {typeof l.verifiedCount === "number" ? ` · ${l.verifiedCount} WhatsApp` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {lists.length === 0 ? (
              <p className="text-xs text-slate-500">
                Create a group and verify numbers on{" "}
                <Link className="text-brand-400 underline" href="/contacts">
                  Contacts
                </Link>
                .
              </p>
            ) : unverified > 0 ? (
              <p className="text-xs text-amber-300/90">
                {unverified} number{unverified === 1 ? "" : "s"} in this group are not WhatsApp-verified. Verify them on{" "}
                <Link className="underline" href={`/contacts?group=${form.contactListId}`}>
                  Contacts
                </Link>{" "}
                before starting. Numbers marked not on WhatsApp are skipped.
              </p>
            ) : null}

            <div>
              <div className="mb-2 text-sm text-slate-300">Voice type</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    {
                      type: "TTS" as const,
                      icon: Volume2,
                      title: "Text to Speech",
                      desc: "Type a script and we synthesize the voice.",
                    },
                    {
                      type: "RECORDED" as const,
                      icon: Upload,
                      title: "Audio Upload",
                      desc: "Play a pre-recorded audio message.",
                    },
                    {
                      type: "AI_VOICE" as const,
                      icon: Bot,
                      title: "AI Agent",
                      desc: "A conversational AI handles the call.",
                    },
                  ] as const
                ).map((opt) => {
                  const Icon = opt.icon;
                  const on = form.voiceType === opt.type;
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => setForm({ ...form, voiceType: opt.type })}
                      className={`rounded-xl border p-3 text-left ${
                        on ? "border-brand-400 bg-brand-500/10" : "border-white/10 bg-ink-950/40 hover:border-white/20"
                      }`}
                    >
                      <Icon className={`mb-2 h-4 w-4 ${on ? "text-brand-400" : "text-slate-500"}`} />
                      <div className="text-sm font-medium text-white">{opt.title}</div>
                      <p className="mt-1 text-xs text-slate-400">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {form.voiceType === "TTS" ? (
              <div className="space-y-3">
                {!sarvam.configured ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    A Sarvam AI API key is required for voice generation. Add yours in{" "}
                    <Link className="font-medium underline" href="/ai-calling">
                      AI calling → Sarvam API
                    </Link>
                    .
                  </div>
                ) : null}
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-slate-300">Text script</span>
                    <div className="flex flex-wrap gap-1">
                      {VARS.map((v) => (
                        <button
                          key={v.token}
                          type="button"
                          onClick={() => insertVar(v.token)}
                          className="rounded-md bg-white/10 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/15"
                        >
                          Insert {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    ref={scriptRef}
                    className="min-h-32"
                    placeholder={DEFAULT_SCRIPT}
                    value={form.ttsBody}
                    onChange={(e) => setForm({ ...form, ttsBody: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Variables are personalized per contact. Hindi and other Indian languages are supported.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-slate-300">
                    Voice
                    <select
                      className="mt-1 min-h-11"
                      value={form.ttsSpeaker}
                      onChange={(e) => setForm({ ...form, ttsSpeaker: e.target.value })}
                    >
                      {speakers.map((s) => (
                        <option key={s} value={s}>
                          {speakerLabel(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm text-slate-300">
                    Language
                    <select
                      className="mt-1 min-h-11"
                      value={form.ttsLanguage}
                      onChange={(e) => setForm({ ...form, ttsLanguage: e.target.value })}
                    >
                      {languages.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block text-sm text-slate-300">
                  Voice instructions
                  <input
                    className="mt-1 min-h-11"
                    value={form.ttsInstructions}
                    onChange={(e) => setForm({ ...form, ttsInstructions: e.target.value })}
                    placeholder="Warm and friendly, speak slowly with a calm tone"
                  />
                </label>
                <button
                  type="button"
                  disabled={previewing || !sarvam.configured}
                  onClick={() => void previewTts()}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white hover:bg-white/10"
                >
                  <Sparkles className="h-4 w-4 text-brand-400" />
                  {previewing ? "Generating…" : "Generate preview"}
                </button>
              </div>
            ) : null}

            {form.voiceType === "RECORDED" ? (
              <label className="block text-sm text-slate-300">
                Uploaded recording
                <select
                  className="mt-1 min-h-11"
                  value={form.recordingId}
                  onChange={(e) => setForm({ ...form, recordingId: e.target.value })}
                >
                  {recordings.length === 0 ? <option value="">Upload one on Recordings first</option> : null}
                  {recordings.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <Link href="/recordings" className="mt-2 inline-block text-xs text-brand-300">
                  Open Recordings
                </Link>
              </label>
            ) : null}

            {form.voiceType === "AI_VOICE" ? (
              <div className="space-y-3">
                {!aiKeyReady ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    {selectedAiProvider === "gemini"
                      ? "A Google Gemini API key is required for this agent. Add yours in "
                      : "A Sarvam AI API key is required for this agent. Add yours in "}
                    <Link className="font-medium underline" href="/ai-calling">
                      AI calling → API keys
                    </Link>
                    .
                  </div>
                ) : null}
                <label className="block text-sm text-slate-300">
                  AI agent
                  <select
                    className="mt-1 min-h-11"
                    value={form.aiConfigId}
                    onChange={(e) => setForm({ ...form, aiConfigId: e.target.value })}
                  >
                    {agents.length === 0 ? <option value="">Create an agent on AI calling first</option> : null}
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {(a.provider || "sarvam") === "gemini" ? " · Gemini" : " · Sarvam"}
                        {a.knowledgeBase ? ` · ${a.knowledgeBase.name}` : " · no knowledge base"}
                      </option>
                    ))}
                  </select>
                </label>
                <Link
                  href={form.aiConfigId ? `/ai-calling?test=${form.aiConfigId}` : "/ai-calling"}
                  className="mt-2 inline-block text-xs text-brand-300"
                >
                  {form.aiConfigId ? "Test this agent first" : "Create and test an AI agent"}
                </Link>
                <label className="mt-3 block text-sm text-slate-300">
                  Call duration override (optional)
                  <select
                    className="mt-1 min-h-11"
                    value={form.maxCallDurationSec}
                    onChange={(e) => setForm({ ...form, maxCallDurationSec: Number(e.target.value) || 0 })}
                  >
                    <option value={0}>Use agent default</option>
                    {[60, 90, 120, 180, 240, 300].map((sec) => (
                      <option key={sec} value={sec}>
                        {sec / 60} min
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-slate-500">
                    Overrides this campaign only. Leave on agent default unless you need a shorter/longer talk time.
                  </span>
                </label>
              </div>
            ) : null}

            <div className="rounded-xl border border-white/10 bg-ink-950/40 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                <Clock className="h-4 w-4 text-slate-400" />
                Call pacing
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-slate-400">
                  Delay between calls (sec)
                  <input
                    className="mt-1 min-h-11"
                    type="number"
                    min={0}
                    max={300}
                    value={form.delayBetweenCallsSec}
                    onChange={(e) => setForm({ ...form, delayBetweenCallsSec: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Ring timeout (sec)
                  <input
                    className="mt-1 min-h-11"
                    type="number"
                    min={5}
                    max={180}
                    value={form.ringTimeoutSec}
                    onChange={(e) => setForm({ ...form, ringTimeoutSec: Number(e.target.value) || 60 })}
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Batch size (0 = off)
                  <input
                    className="mt-1 min-h-11"
                    type="number"
                    min={0}
                    max={500}
                    value={form.batchSize}
                    onChange={(e) => setForm({ ...form, batchSize: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Sleep after batch (sec)
                  <input
                    className="mt-1 min-h-11"
                    type="number"
                    min={0}
                    max={3600}
                    value={form.sleepAfterBatchSec}
                    onChange={(e) => setForm({ ...form, sleepAfterBatchSec: Number(e.target.value) || 0 })}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-4">
            <Link
              href="/campaigns"
              className="inline-flex min-h-11 items-center rounded-lg border border-white/15 px-4 text-sm text-slate-200 hover:bg-white/5"
            >
              Cancel
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitVoice()}
              className="min-h-11 rounded-lg bg-brand-500 px-5 text-sm font-medium text-ink-950 hover:bg-brand-400"
            >
              {busy ? "Saving…" : "Create"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <button type="button" onClick={() => setKind(null)} className="text-sm text-slate-400 hover:text-white">
            ← Voice or message
          </button>
          <label className="block text-sm text-slate-300">
            Campaign name
            <input
              className="mt-1 min-h-11"
              placeholder="e.g. College follow-up"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="block text-sm text-slate-300">
            Contact group
            <select
              className="mt-1 min-h-11"
              value={form.contactListId}
              onChange={(e) => setForm({ ...form, contactListId: e.target.value })}
            >
              {lists.length === 0 ? <option value="">No groups yet</option> : null}
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {typeof l._count?.members === "number" ? ` · ${l._count.members}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div>
            <div className="mb-2 text-sm text-slate-300">Message template</div>
            <div className="grid gap-2">
              {allTemplates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setForm({ ...form, messageTemplateId: t.id, messageBody: "" })}
                  className={`rounded-xl border p-3 text-left ${
                    form.messageTemplateId === t.id
                      ? "border-brand-400 bg-brand-500/15"
                      : "border-white/10 bg-ink-950/40"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    {t.name}
                    <TemplateKindBadge kind={t.kind || "TEXT"} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-400">{t.body}</p>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setForm({ ...form, messageTemplateId: "", messageBody: form.messageBody })}
                className={`rounded-xl border p-3 text-left ${
                  !form.messageTemplateId ? "border-brand-400 bg-brand-500/15" : "border-white/10 bg-ink-950/40"
                }`}
              >
                <div className="text-sm font-medium text-white">Write your own</div>
              </button>
            </div>
            {selectedTemplate && form.messageTemplateId ? (
              <p className="mt-2 rounded-lg bg-ink-950/50 p-3 text-xs text-slate-400">{selectedTemplate.body}</p>
            ) : null}
            {!form.messageTemplateId ? (
              <textarea
                className="mt-2 min-h-28"
                placeholder="Type the WhatsApp message"
                value={form.messageBody}
                onChange={(e) => setForm({ ...form, messageBody: e.target.value })}
              />
            ) : null}
          </div>
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-white/10 bg-ink-950/40 px-3 py-2 text-sm text-white">
            <input
              type="checkbox"
              checked={form.schedule}
              onChange={(e) => setForm({ ...form, schedule: e.target.checked })}
            />
            Schedule send
          </label>
          {form.schedule ? (
            <label className="block text-sm text-slate-300">
              Send at
              <input
                className="mt-1 min-h-11"
                type="datetime-local"
                value={form.scheduleAt}
                onChange={(e) => setForm({ ...form, scheduleAt: e.target.value })}
              />
            </label>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitMessage()}
            className="min-h-12 w-full rounded-xl bg-brand-500 px-5 py-3 font-medium text-ink-950 hover:bg-brand-400"
          >
            {busy ? "Saving…" : form.schedule ? "Schedule campaign" : "Send campaign"}
          </button>
        </div>
      )}
    </div>
  );
}
