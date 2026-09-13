"use client";

import { useEffect, useState } from "react";
import { Cpu, CheckCircle2, XCircle, RefreshCw, Key, ShieldCheck, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";

interface UseVelixSettings {
  provider: string;
  configured: boolean;
  maskedApiKey: string;
  baseUrl: string;
  enabled: boolean;
  defaultType: string;
  defaultAspect: string;
  envFallback: boolean;
}

export default function PlatformAiProvidersPage() {
  const [settings, setSettings] = useState<UseVelixSettings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [enabledInput, setEnabledInput] = useState(true);
  const [defaultTypeInput, setDefaultTypeInput] = useState("3d");
  const [defaultAspectInput, setDefaultAspectInput] = useState("1:1");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await api<{ success: true; data: UseVelixSettings }>("/api/v1/creative/providers/usevelix");
      setSettings(res.data);
      setBaseUrlInput(res.data.baseUrl || "https://usevelix.com");
      setEnabledInput(res.data.enabled);
      setDefaultTypeInput(res.data.defaultType || "3d");
      setDefaultAspectInput(res.data.defaultAspect || "1:1");
    } catch (err: any) {
      setError(err?.message || "Failed to load provider settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const payload: any = {
        baseUrl: baseUrlInput.trim() || "https://usevelix.com",
        enabled: enabledInput,
        defaultType: defaultTypeInput,
        defaultAspect: defaultAspectInput,
      };
      if (apiKeyInput.trim()) {
        payload.apiKey = apiKeyInput.trim();
      }

      const res = await api<{ success: true; data: UseVelixSettings }>("/api/v1/creative/providers/usevelix", {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      setSettings(res.data);
      setApiKeyInput("");
      setMsg("UseVelix configuration saved successfully!");
    } catch (err: any) {
      setError(err?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const payload: any = {};
      if (apiKeyInput.trim()) {
        payload.apiKey = apiKeyInput.trim();
      }
      if (baseUrlInput.trim()) {
        payload.baseUrl = baseUrlInput.trim();
      }

      const res = await api<{ success: true; data: { ok: boolean; message: string } }>(
        "/api/v1/creative/providers/usevelix/test",
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );
      setTestResult(res.data);
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err?.message || "Connection test failed",
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="AI Providers"
        subtitle="Manage AI Creative Studio generation and smart-edit providers across WaCall."
      />

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {msg ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {msg}
        </div>
      ) : null}

      {/* Provider Card: UseVelix */}
      <section className="surface rounded-2xl border border-white/10 p-6 shadow-xl">
        <div className="flex flex-col justify-between gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/20 text-violet-400">
              <Cpu className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-white">UseVelix</h3>
                <span className="rounded-full bg-violet-500/20 px-2.5 py-0.5 text-xs font-medium text-violet-300">
                  Primary Creative Provider
                </span>
              </div>
              <p className="text-xs text-white/60">
                Text-to-Image & Smart-Edit engine powering WhatsApp Creative Studio & Festival Autopilot.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {settings?.configured ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Configured
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
                <XCircle className="h-3.5 w-3.5" />
                Key Required
              </span>
            )}

            <label className="flex cursor-pointer items-center gap-2">
              <span className="text-xs text-white/60">Active:</span>
              <input
                type="checkbox"
                checked={enabledInput}
                onChange={(e) => setEnabledInput(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-black/40 text-violet-600 focus:ring-violet-500"
              />
            </label>
          </div>
        </div>

        {/* Configuration Form */}
        <div className="mt-6 space-y-5">
          {/* API Key */}
          <div>
            <label className="mb-1 flex items-center justify-between text-xs font-medium text-white/80">
              <span className="flex items-center gap-1.5">
                <Key className="h-3.5 w-3.5 text-white/50" />
                UseVelix API Key
              </span>
              {settings?.maskedApiKey && (
                <span className="font-mono text-xs text-emerald-400/90">
                  Current: {settings.maskedApiKey}
                </span>
              )}
            </label>
            <input
              type="password"
              placeholder={settings?.configured ? "Enter new API key to change (leave blank to keep current)" : "Paste UseVelix API Key here..."}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white placeholder-white/30 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <p className="mt-1 flex items-center gap-1 text-[11px] text-white/50">
              <ShieldCheck className="h-3 w-3 text-emerald-400" />
              Keys are encrypted and masked. Never logged or exposed in public responses.
            </p>
          </div>

          {/* Base URL & Defaults */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/80">
                API Base URL
              </label>
              <input
                type="text"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                placeholder="https://api.usevelix.com"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-white/80">
                Default Style Type
              </label>
              <select
                value={defaultTypeInput}
                onChange={(e) => setDefaultTypeInput(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              >
                <option value="3d">3D Commercial</option>
                <option value="photorealistic">Photorealistic</option>
                <option value="vector">Vector / Flat Illustration</option>
                <option value="cartoon">Stylized / Cartoon</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-white/80">
                Default Aspect Ratio
              </label>
              <select
                value={defaultAspectInput}
                onChange={(e) => setDefaultAspectInput(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              >
                <option value="1:1">1:1 Square (WhatsApp Feed/Poster)</option>
                <option value="9:16">9:16 Vertical (WhatsApp Status/Story)</option>
                <option value="16:9">16:9 Landscape (Banner)</option>
              </select>
            </div>
          </div>

          {/* Test Connection Results */}
          {testResult && (
            <div
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-xs ${
                testResult.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <button
              type="button"
              disabled={testing || (!settings?.configured && !apiKeyInput)}
              onClick={handleTest}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50"
            >
              {testing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 text-amber-400" />}
              Test Connection
            </button>

            <button
              type="button"
              disabled={saving || loading}
              onClick={handleSave}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-600/30 hover:bg-violet-500 disabled:opacity-50"
            >
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
              Save Configuration
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
