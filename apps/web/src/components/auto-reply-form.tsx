"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Clock, TriangleAlert, X } from "lucide-react";
import { api, getAccessToken } from "@/lib/api";

export const TRIGGERS = [
  { id: "ANSWERED", label: "Call received", hint: "Customer picked up. Send a thank-you with Yes / No (buttons when WhatsApp supports them, otherwise reply text)." },
  { id: "NO_ANSWER", label: "Call unanswered", hint: "The call rang out. Leave a missed-call note and a call-back option." },
  { id: "REJECTED", label: "Call rejected", hint: "Customer declined. Explain why you called and that they can call back." },
  { id: "NOT_CONNECTED", label: "Not connected", hint: "The call couldn't connect. Ask them to reply when free." },
] as const;

export type TriggerId = (typeof TRIGGERS)[number]["id"];

const DEFAULT_BODY: Record<TriggerId, string> = {
  ANSWERED:
    "Hi {{name}}, thanks for taking our call from {{company}}. Are you interested in going ahead? Reply Yes or No.",
  NO_ANSWER:
    "Hi {{name}}, we called from {{company}} but couldn't reach you. Would you like us to call you back? Reply Yes or No.",
  REJECTED:
    "Hi {{name}}, we just tried to call you. The purpose was to share an update and see if this is a good time. You can call us back on this chat whenever you are free.",
  NOT_CONNECTED: "Hi {{name}}, we couldn't connect just now. Reply here and we'll follow up.",
};

const SUGGESTED_TEMPLATE: Record<TriggerId, string> = {
  ANSWERED: "starter-call-answered",
  NO_ANSWER: "starter-call-unanswered",
  REJECTED: "starter-call-rejected",
  NOT_CONNECTED: "",
};

type MsgTemplate = {
  id: string;
  name: string;
  kind?: string;
  body: string;
  header?: string;
  footer?: string;
  buttons?: Array<{ text: string }>;
};

type Campaign = { id: string; name: string };
type Rule = {
  id: string;
  name: string;
  trigger: TriggerId;
  campaignId: string | null;
  body: string;
  hasImage: boolean;
  delaySeconds: number;
  cooldownMinutes: number;
  showTyping: boolean;
  typingSeconds: number;
  enabled: boolean;
  messageTemplateId?: string | null;
};

function apiBase() {
  return process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
}

export function AutoReplyForm({ ruleId, defaultTrigger }: { ruleId?: string; defaultTrigger?: TriggerId }) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<MsgTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<TriggerId>(defaultTrigger ?? "ANSWERED");
  const [campaignId, setCampaignId] = useState("");
  const [body, setBody] = useState(DEFAULT_BODY[defaultTrigger ?? "ANSWERED"]);
  const [delaySeconds, setDelaySeconds] = useState(3);
  const [cooldownMinutes, setCooldownMinutes] = useState(1440);
  const [showTyping, setShowTyping] = useState(true);
  const [typingSeconds, setTypingSeconds] = useState(2);
  const [enabled, setEnabled] = useState(true);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [existingImage, setExistingImage] = useState<string | null>(null);
  const [clearImage, setClearImage] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!ruleId);

  useEffect(() => {
    void api<{ success: true; data: Campaign[] }>("/api/v1/campaigns?limit=100")
      .then((r) => setCampaigns(r.data))
      .catch(() => undefined);
    void api<{ success: true; data: { starter: MsgTemplate[]; custom: MsgTemplate[] } }>("/api/v1/message-templates")
      .then((r) => {
        const next = [...(r.data.starter ?? []), ...(r.data.custom ?? [])];
        setTemplates(next);
        if (!ruleId) {
          const suggested = SUGGESTED_TEMPLATE[defaultTrigger ?? "ANSWERED"];
          if (suggested && next.some((t) => t.id === suggested)) {
            setTemplateId(suggested);
            const found = next.find((t) => t.id === suggested);
            if (found) setBody(found.body);
          }
        }
      })
      .catch(() => undefined);
  }, [defaultTrigger, ruleId]);

  useEffect(() => {
    if (!ruleId) return;
    void (async () => {
      try {
        const r = await api<{ success: true; data: Rule }>(`/api/v1/auto-reply-rules/${ruleId}`);
        const rule = r.data;
        setName(rule.name);
        setTrigger(rule.trigger);
        setCampaignId(rule.campaignId ?? "");
        setBody(rule.body);
        setTemplateId(rule.messageTemplateId ?? "");
        setDelaySeconds(rule.delaySeconds);
        setCooldownMinutes(rule.cooldownMinutes);
        setShowTyping(rule.showTyping);
        setTypingSeconds(rule.typingSeconds);
        setEnabled(rule.enabled);
        if (rule.hasImage) {
          const token = getAccessToken();
          const res = await fetch(`${apiBase()}/api/v1/auto-reply-rules/${ruleId}/image`, {
            headers: token ? { authorization: `Bearer ${token}` } : {},
            credentials: "include",
          });
          if (res.ok) {
            const blob = await res.blob();
            setExistingImage(URL.createObjectURL(blob));
          }
        }
        setLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load rule");
      }
    })();
  }, [ruleId]);

  const previewUrl = imageFile ? URL.createObjectURL(imageFile) : clearImage ? null : existingImage;
  const previewText = useMemo(
    () =>
      body
        .replaceAll("{{name}}", "Priya")
        .replaceAll("{{phone}}", "+91 98765 43210")
        .replaceAll("{{email}}", "priya@example.com")
        .replaceAll("{{company}}", "WaCalls"),
    [body],
  );

  function insertToken(token: string) {
    setBody((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${token}`);
  }

  async function uploadImage(file: File) {
    const token = getAccessToken();
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${apiBase()}/api/v1/auto-reply-rules/image`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: fd,
      credentials: "include",
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { path?: string; mimeType?: string };
      error?: { message?: string };
    };
    if (!res.ok || !json.data?.path) throw new Error(json.error?.message ?? "Image upload failed");
    return json.data;
  }

  async function save() {
    setError("");
    if (!name.trim() || (!body.trim() && !templateId)) {
      setError("Rule name and a message template (or text) are required.");
      return;
    }
    setBusy(true);
    try {
      let imagePath: string | null | undefined;
      let imageMime: string | null | undefined;
      if (imageFile) {
        const uploaded = await uploadImage(imageFile);
        imagePath = uploaded.path ?? null;
        imageMime = uploaded.mimeType ?? null;
      } else if (clearImage) {
        imagePath = null;
        imageMime = null;
      }
      const payload = {
        name: name.trim(),
        trigger,
        campaignId: campaignId || null,
        body: body.trim(),
        messageTemplateId: templateId || null,
        delaySeconds,
        cooldownMinutes,
        showTyping,
        typingSeconds,
        enabled,
        ...(imagePath !== undefined ? { imagePath, imageMime } : {}),
      };
      if (ruleId) {
        await api(`/api/v1/auto-reply-rules/${ruleId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api("/api/v1/auto-reply-rules", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      router.push("/auto-reply");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save rule");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return <p className="text-sm text-slate-500">Loading rule…</p>;
  }

  return (
    <div className="space-y-8">
      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-ink-900/60 p-5">
        <h2 className="text-sm font-semibold text-white">1. Basics</h2>
        <label className="mt-4 block text-xs uppercase tracking-wider text-slate-500">Rule name</label>
        <input
          className="mt-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Missed call follow-up"
        />
        <p className="mt-4 text-xs uppercase tracking-wider text-slate-500">Trigger — when the call is…</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {TRIGGERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTrigger(item.id);
                if (!ruleId && TRIGGERS.some((t) => DEFAULT_BODY[t.id] === body)) setBody(DEFAULT_BODY[item.id]);
                if (!ruleId) {
                  const suggested = SUGGESTED_TEMPLATE[item.id];
                  setTemplateId(suggested);
                  const found = templates.find((t) => t.id === suggested);
                  if (found) setBody(found.body);
                }
              }}
              className={`rounded-xl border px-3 py-3 text-left ${
                trigger === item.id
                  ? "border-brand-500 bg-brand-500/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              <div className="text-sm font-medium text-white">{item.label}</div>
              <div className="mt-1 text-xs text-slate-400">{item.hint}</div>
            </button>
          ))}
        </div>
        <label className="mt-4 block text-xs uppercase tracking-wider text-slate-500">Applies to</label>
        <select className="mt-1" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </section>

      <section className="rounded-2xl border border-white/10 bg-ink-900/60 p-5">
        <h2 className="text-sm font-semibold text-white">2. Message</h2>
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_280px]">
          <div>
            <div className="flex flex-wrap gap-2">
              {["{{name}}", "{{company}}", "{{phone}}", "{{email}}"].map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => insertToken(token)}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-xs text-brand-300"
                >
                  {token}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-xs uppercase tracking-wider text-slate-500">Message template</label>
            <select
              className="mt-1"
              value={templateId}
              onChange={(e) => {
                const id = e.target.value;
                setTemplateId(id);
                const found = templates.find((t) => t.id === id);
                if (found) setBody(found.body);
              }}
            >
              <option value="">Write your own text</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.kind || "TEXT"}
                  {t.buttons?.length ? ` · ${t.buttons.length} button(s)` : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Button templates try WhatsApp Yes/No buttons when the line supports them. On linked WhatsApp the same message also includes “Reply with Yes / No” text so customers can always answer.
            </p>
            <label className="mt-3 block text-xs uppercase tracking-wider text-slate-500">Text</label>
            <textarea className="mt-1 min-h-32" value={body} onChange={(e) => setBody(e.target.value)} />
            <label className="mt-3 block text-xs uppercase tracking-wider text-slate-500">Image (optional)</label>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer rounded-lg border border-dashed border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-200">
                Upload image
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setImageFile(file);
                    setClearImage(false);
                  }}
                />
              </label>
              {previewUrl ? (
                <button
                  type="button"
                  className="text-xs text-rose-300"
                  onClick={() => {
                    setImageFile(null);
                    setClearImage(true);
                  }}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500">Live preview</p>
            <div className="mt-2 rounded-2xl bg-[#0b141a] p-3">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="" className="mb-2 max-h-36 w-full rounded-lg object-cover" />
              ) : null}
              <div className="ml-auto max-w-[90%] rounded-2xl rounded-tr-sm bg-[#005c4b] px-3 py-2 text-sm text-white">
                {previewText || "Your message will appear here."}
                {templates.find((t) => t.id === templateId)?.buttons?.length ? (
                  <div className="mt-2 space-y-1">
                    {templates
                      .find((t) => t.id === templateId)
                      ?.buttons?.map((btn) => (
                        <div
                          key={btn.text}
                          className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-center text-xs"
                        >
                          {btn.text}
                        </div>
                      ))}
                  </div>
                ) : null}
                <div className="mt-1 text-right text-[10px] text-white/60">now ✓✓</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-ink-900/60 p-5">
        <h2 className="text-sm font-semibold text-white">3. Timing & behaviour</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-slate-300">
            Delay before sending (seconds)
            <input
              className="mt-1"
              type="number"
              min={0}
              max={3600}
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(Number(e.target.value))}
            />
          </label>
          <label className="text-sm text-slate-300">
            Cooldown per contact (minutes)
            <input
              className="mt-1"
              type="number"
              min={0}
              max={43200}
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(Number(e.target.value))}
            />
            <span className="mt-1 block text-xs text-slate-500">
              {cooldownMinutes >= 1440
                ? `Won't resend within ${Math.round(cooldownMinutes / 1440)} day${cooldownMinutes >= 2880 ? "s" : ""}.`
                : cooldownMinutes > 0
                  ? `Won't resend within ${cooldownMinutes} minutes.`
                  : "No cooldown."}
            </span>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <Toggle
            label="Show typing…"
            on={showTyping}
            onChange={setShowTyping}
            extra={
              showTyping ? (
                <input
                  className="w-20"
                  type="number"
                  min={0}
                  max={15}
                  value={typingSeconds}
                  onChange={(e) => setTypingSeconds(Number(e.target.value))}
                />
              ) : null
            }
          />
          <Toggle label="Enabled" on={enabled} onChange={setEnabled} />
        </div>
      </section>

      <div className="flex justify-end gap-3">
        <Link href="/auto-reply" className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300">
          Cancel
        </Link>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-950 hover:bg-brand-400"
        >
          {busy ? "Saving…" : ruleId ? "Save rule" : "Create rule"}
        </button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
  extra,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`relative h-6 w-11 rounded-full ${on ? "bg-brand-500" : "bg-white/15"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${on ? "left-5" : "left-0.5"}`} />
      </button>
      <span className="text-sm text-slate-200">{label}</span>
      {extra}
    </div>
  );
}

export const TRIGGER_ICON = {
  ANSWERED: Check,
  NO_ANSWER: Clock,
  REJECTED: X,
  NOT_CONNECTED: TriangleAlert,
};
