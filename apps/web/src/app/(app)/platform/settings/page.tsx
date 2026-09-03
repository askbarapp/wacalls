"use client";

import { useEffect, useRef, useState } from "react";
import { api, apiUpload } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { BrandMark, useBranding, type PublicBranding } from "@/components/branding-provider";

export default function PlatformSettingsPage() {
  const { branding, reload } = useBranding();
  const logoInput = useRef<HTMLInputElement>(null);
  const faviconInput = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<PublicBranding>(branding);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(branding);
  }, [branding]);

  function flash(ok: string) {
    setError("");
    setMsg(ok);
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/branding", {
        method: "PUT",
        body: JSON.stringify({
          brandName: form.brandName,
          tagline: form.tagline,
          supportEmail: form.supportEmail,
          supportPhone: form.supportPhone,
          website: form.website,
          companyAddress: form.companyAddress,
          copyright: form.copyright,
        }),
      });
      await reload();
      flash("Branding saved. Login, signup, and the sidebar now use this name and logo.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save branding");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAsset(kind: "logo" | "favicon", file: File) {
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.append("file", file);
      await apiUpload(`/api/v1/branding/${kind}`, data);
      await reload();
      flash(kind === "logo" ? "Logo uploaded." : "Favicon uploaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeAsset(kind: "logo" | "favicon") {
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/branding/${kind}`, { method: "DELETE" });
      await reload();
      flash(kind === "logo" ? "Logo removed." : "Favicon removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Branding"
        subtitle="White-label the product for every user account: name, logo, favicon, and support contact."
      />
      {error ? (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {msg ? (
        <div className="mb-4 rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-sm text-brand-200">
          {msg}
        </div>
      ) : null}

      <section className="surface mb-4 p-5">
        <div className="mb-5 flex items-center gap-3">
          <BrandMark size={48} />
          <div>
            <div className="font-medium text-white">{form.brandName || "Brand name"}</div>
            <p className="text-xs text-slate-500">Shown on login, signup, and the left sidebar.</p>
          </div>
        </div>
        <label className="mb-3 block text-sm text-slate-300">
          Brand name
          <input
            className="mt-1 min-h-11"
            value={form.brandName}
            onChange={(e) => setForm({ ...form, brandName: e.target.value })}
            placeholder="Your company name"
          />
        </label>
        <label className="mb-4 block text-sm text-slate-300">
          Tagline
          <input
            className="mt-1 min-h-11"
            value={form.tagline}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
            placeholder="WhatsApp calling for your team"
          />
        </label>
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-ink-950/40 p-4">
            <div className="mb-2 text-sm font-medium text-white">Logo</div>
            <input
              ref={logoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void uploadAsset("logo", file);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => logoInput.current?.click()}
                className="min-h-10 rounded-lg bg-brand-500 px-3 text-sm font-medium text-ink-950"
              >
                Upload logo
              </button>
              {branding.hasLogo ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeAsset("logo")}
                  className="min-h-10 rounded-lg bg-white/10 px-3 text-sm"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-ink-950/40 p-4">
            <div className="mb-2 text-sm font-medium text-white">Favicon</div>
            <input
              ref={faviconInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/x-icon,.ico"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void uploadAsset("favicon", file);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => faviconInput.current?.click()}
                className="min-h-10 rounded-lg bg-brand-500 px-3 text-sm font-medium text-ink-950"
              >
                Upload favicon
              </button>
              {branding.hasFavicon ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeAsset("favicon")}
                  className="min-h-10 rounded-lg bg-white/10 px-3 text-sm"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <label className="mb-4 block text-sm text-slate-300">
          Copyright / footer
          <input
            className="mt-1 min-h-11"
            value={form.copyright}
            onChange={(e) => setForm({ ...form, copyright: e.target.value })}
            placeholder="© 2026 Your Company"
          />
        </label>
      </section>

      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-medium text-white">Support contact</h2>
        <label className="mb-3 block text-sm text-slate-300">
          Support email
          <input
            className="mt-1 min-h-11"
            type="email"
            value={form.supportEmail}
            onChange={(e) => setForm({ ...form, supportEmail: e.target.value })}
            placeholder="support@company.com"
          />
        </label>
        <label className="mb-3 block text-sm text-slate-300">
          Support phone
          <input
            className="mt-1 min-h-11"
            value={form.supportPhone}
            onChange={(e) => setForm({ ...form, supportPhone: e.target.value })}
            placeholder="+91 98765 43210"
          />
        </label>
        <label className="mb-3 block text-sm text-slate-300">
          Website
          <input
            className="mt-1 min-h-11"
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
            placeholder="https://company.com"
          />
        </label>
        <label className="mb-4 block text-sm text-slate-300">
          Company address
          <textarea
            className="mt-1 min-h-24"
            value={form.companyAddress}
            onChange={(e) => setForm({ ...form, companyAddress: e.target.value })}
            placeholder="Office address"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="min-h-11 rounded-lg bg-brand-500 px-4 text-sm font-medium text-ink-950"
        >
          {busy ? "Saving…" : "Save branding"}
        </button>
      </section>
    </div>
  );
}
