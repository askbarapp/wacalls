"use client";

import { useState } from "react";
import { Image as ImageIcon, List, MousePointerClick, Type } from "lucide-react";
import { api, apiUpload, getAccessToken } from "@/lib/api";

export const TEMPLATE_KINDS = [
  { id: "TEXT", label: "Text", hint: "Plain WhatsApp message" },
  { id: "SIMPLE", label: "Simple", hint: "Title, message, and footer" },
  { id: "MEDIA", label: "Media", hint: "Image plus caption" },
  { id: "BUTTON", label: "Button", hint: "Reply, website, or call buttons" },
  { id: "LIST", label: "List", hint: "Menu of options" },
] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number]["id"];

export type TemplateButton = {
  id?: string;
  type: "reply" | "url" | "call";
  text: string;
  url?: string;
  phone?: string;
};

export type TemplateSection = {
  title: string;
  rows: Array<{ id?: string; title: string; description?: string }>;
};

export type MsgTemplate = {
  id: string;
  name: string;
  kind?: TemplateKind | string;
  body: string;
  header?: string;
  footer?: string;
  hasMedia?: boolean;
  buttons?: TemplateButton[];
  listButton?: string;
  sections?: TemplateSection[];
};

type FormState = {
  name: string;
  kind: TemplateKind;
  body: string;
  header: string;
  footer: string;
  mediaPath: string;
  mediaMime: string;
  buttons: TemplateButton[];
  listButton: string;
  sections: TemplateSection[];
};

const emptyForm = (): FormState => ({
  name: "",
  kind: "TEXT",
  body: "",
  header: "",
  footer: "",
  mediaPath: "",
  mediaMime: "",
  buttons: [{ type: "reply", text: "Yes" }, { type: "reply", text: "No" }],
  listButton: "Options",
  sections: [{ title: "Options", rows: [{ title: "Option 1", description: "" }] }],
});

function kindLabel(kind?: string) {
  return TEMPLATE_KINDS.find((k) => k.id === kind)?.label ?? "Text";
}

export function MessageTemplateForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function setKind(kind: TemplateKind) {
    setForm((prev) => ({ ...prev, kind }));
  }

  async function uploadImage(file: File) {
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    const res = await apiUpload<{ success: true; data: { path: string; mimeType: string } }>(
      "/api/v1/message-templates/media",
      fd,
    );
    setForm((prev) => ({ ...prev, mediaPath: res.data.path, mediaMime: res.data.mimeType }));
    setPreview(URL.createObjectURL(file));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/v1/message-templates", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          kind: form.kind,
          body: form.body.trim(),
          header: form.header.trim() || null,
          footer: form.footer.trim() || null,
          mediaPath: form.kind === "MEDIA" || (form.kind === "BUTTON" && form.mediaPath) ? form.mediaPath : null,
          mediaMime: form.mediaMime || null,
          buttons: form.kind === "BUTTON" ? form.buttons.filter((b) => b.text.trim()) : [],
          listButton: form.kind === "LIST" ? form.listButton : null,
          sections: form.kind === "LIST" ? form.sections : [],
        }),
      });
      setForm(emptyForm());
      setPreview(null);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save template");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="mb-6 rounded-2xl border border-white/10 bg-ink-900/70 p-5">
      <div className="mb-3 text-sm font-medium text-white">New WhatsApp template</div>
      {error ? <p className="mb-3 text-sm text-rose-300">{error}</p> : null}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TEMPLATE_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            className={`rounded-xl border px-3 py-2 text-left ${
              form.kind === k.id ? "border-brand-400 bg-brand-500/15" : "border-white/10 bg-ink-950/40"
            }`}
          >
            <div className="flex items-center gap-1.5 text-sm font-medium text-white">
              {k.id === "MEDIA" ? <ImageIcon className="h-3.5 w-3.5" /> : null}
              {k.id === "BUTTON" ? <MousePointerClick className="h-3.5 w-3.5" /> : null}
              {k.id === "LIST" ? <List className="h-3.5 w-3.5" /> : null}
              {k.id === "TEXT" || k.id === "SIMPLE" ? <Type className="h-3.5 w-3.5" /> : null}
              {k.label}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">{k.hint}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-2">
        <input
          className="min-h-11"
          placeholder="Template name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        {form.kind === "SIMPLE" || form.kind === "BUTTON" || form.kind === "LIST" ? (
          <input
            className="min-h-11"
            placeholder="Header / title (optional)"
            value={form.header}
            onChange={(e) => setForm({ ...form, header: e.target.value })}
          />
        ) : null}
        <textarea
          className="min-h-28"
          placeholder="Message body. Use {{name}}, {{company}}, {{phone}}."
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />
        {form.kind === "SIMPLE" || form.kind === "BUTTON" || form.kind === "LIST" ? (
          <input
            className="min-h-11"
            placeholder="Footer (optional)"
            value={form.footer}
            onChange={(e) => setForm({ ...form, footer: e.target.value })}
          />
        ) : null}
        {form.kind === "MEDIA" ? (
          <label className="rounded-xl border border-dashed border-white/15 px-4 py-3 text-sm text-slate-300">
            {preview ? "Replace image" : "Upload image (JPG, PNG, WebP)"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && void uploadImage(e.target.files[0]).catch((err) => setError(err instanceof Error ? err.message : "Upload failed"))}
            />
            {preview ? <img src={preview} alt="" className="mt-3 max-h-40 rounded-lg object-cover" /> : null}
          </label>
        ) : null}
        {form.kind === "BUTTON" ? (
          <div className="space-y-2 rounded-xl border border-white/10 p-3">
            <p className="text-xs text-slate-400">Up to 3 buttons. Reply buttons send a WhatsApp reply; URL and Call work on WhatsApp Web lines.</p>
            {form.buttons.map((btn, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-3">
                <select
                  value={btn.type}
                  onChange={(e) => {
                    const buttons = [...form.buttons];
                    buttons[i] = { ...btn, type: e.target.value as TemplateButton["type"] };
                    setForm({ ...form, buttons });
                  }}
                >
                  <option value="reply">Reply</option>
                  <option value="url">Website</option>
                  <option value="call">Call</option>
                </select>
                <input
                  placeholder="Button text"
                  value={btn.text}
                  onChange={(e) => {
                    const buttons = [...form.buttons];
                    buttons[i] = { ...btn, text: e.target.value };
                    setForm({ ...form, buttons });
                  }}
                />
                {btn.type === "url" ? (
                  <input
                    placeholder="https://"
                    value={btn.url ?? ""}
                    onChange={(e) => {
                      const buttons = [...form.buttons];
                      buttons[i] = { ...btn, url: e.target.value };
                      setForm({ ...form, buttons });
                    }}
                  />
                ) : btn.type === "call" ? (
                  <input
                    placeholder="Phone e.g. 9198xxxxxxxx"
                    value={btn.phone ?? ""}
                    onChange={(e) => {
                      const buttons = [...form.buttons];
                      buttons[i] = { ...btn, phone: e.target.value };
                      setForm({ ...form, buttons });
                    }}
                  />
                ) : (
                  <span className="self-center text-xs text-slate-500">Quick reply</span>
                )}
              </div>
            ))}
            {form.buttons.length < 3 ? (
              <button
                type="button"
                className="text-xs text-brand-400"
                onClick={() => setForm({ ...form, buttons: [...form.buttons, { type: "reply", text: "" }] })}
              >
                Add button
              </button>
            ) : null}
          </div>
        ) : null}
        {form.kind === "LIST" ? (
          <div className="space-y-2 rounded-xl border border-white/10 p-3">
            <input
              placeholder="List button label e.g. View menu"
              value={form.listButton}
              onChange={(e) => setForm({ ...form, listButton: e.target.value })}
            />
            {form.sections[0]?.rows.map((row, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <input
                  placeholder={`Option ${i + 1} title`}
                  value={row.title}
                  onChange={(e) => {
                    const sections = [...form.sections];
                    const rows = [...(sections[0]?.rows ?? [])];
                    rows[i] = { ...row, title: e.target.value };
                    sections[0] = { title: sections[0]?.title || "Options", rows };
                    setForm({ ...form, sections });
                  }}
                />
                <input
                  placeholder="Description (optional)"
                  value={row.description ?? ""}
                  onChange={(e) => {
                    const sections = [...form.sections];
                    const rows = [...(sections[0]?.rows ?? [])];
                    rows[i] = { ...row, description: e.target.value };
                    sections[0] = { title: sections[0]?.title || "Options", rows };
                    setForm({ ...form, sections });
                  }}
                />
              </div>
            ))}
            {(form.sections[0]?.rows.length ?? 0) < 10 ? (
              <button
                type="button"
                className="text-xs text-brand-400"
                onClick={() => {
                  const sections = [...form.sections];
                  const rows = [...(sections[0]?.rows ?? [])];
                  rows.push({ title: "", description: "" });
                  sections[0] = { title: "Options", rows };
                  setForm({ ...form, sections });
                }}
              >
                Add option
              </button>
            ) : null}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-lg bg-brand-500 font-medium text-ink-950 hover:bg-brand-400 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save template"}
        </button>
      </div>
    </form>
  );
}

export function TemplateKindBadge({ kind }: { kind?: string }) {
  return (
    <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
      {kindLabel(kind)}
    </span>
  );
}

export function templateSummary(t: MsgTemplate) {
  if (t.kind === "BUTTON") return `${t.body} · ${(t.buttons ?? []).length} button(s)`;
  if (t.kind === "LIST") return `${t.body} · list`;
  if (t.kind === "MEDIA") return `${t.body} · image`;
  if (t.kind === "SIMPLE") return [t.header, t.body, t.footer].filter(Boolean).join(" · ");
  return t.body;
}

export function templateComposePreview(t: MsgTemplate) {
  if (t.kind === "SIMPLE") return [t.header, t.body, t.footer].filter(Boolean).join("\n\n");
  return t.body;
}

export function isStructuredTemplate(kind?: string) {
  return kind === "MEDIA" || kind === "BUTTON" || kind === "LIST";
}

export function templateMediaUrl(id: string) {
  const token = getAccessToken();
  const base = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/api/v1/message-templates/${id}/media${token ? "" : ""}`;
}
