"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { BrandMark, useBranding } from "@/components/branding-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const { branding } = useBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api<{ success: true; data: { accessToken: string } }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, remember }),
      });
      localStorage.setItem("wacalls_token", res.data.accessToken);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-10 h-80 w-80 rounded-full bg-cyan-400/15 blur-3xl" />
      <motion.form
        onSubmit={onSubmit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="surface relative w-full max-w-md p-8 ring-1 ring-white/10"
      >
        <div className="mb-8 flex items-center gap-3">
          <BrandMark size={48} />
          <div>
            <h1 className="text-2xl font-semibold text-white">{branding.brandName}</h1>
            <p className="text-sm text-slate-300">{branding.tagline}</p>
          </div>
        </div>
        <label className="mb-4 block">
          Email
          <input className="mt-1.5" type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="mb-4 block">
          Password
          <input
            className="mt-1.5"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <label className="mb-6 flex items-center gap-2 text-sm font-normal text-slate-300">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Stay signed in on this device
        </label>
        {error ? <p className="mb-4 rounded-xl bg-rose-500/15 px-3 py-2 text-sm text-rose-200">{error}</p> : null}
        <Button type="submit" disabled={loading} className="w-full" size="lg">
          {loading ? "Signing in…" : "Sign in"}
        </Button>
        <p className="mt-6 text-center text-sm text-slate-300">
          New here?{" "}
          <a href="/signup" className="font-medium text-cyan-300 hover:text-cyan-200">
            Create an account
          </a>
        </p>
        {branding.supportEmail || branding.supportPhone || branding.website ? (
          <p className="mt-4 text-center text-xs text-slate-400">
            {branding.supportEmail ? (
              <a className="text-emerald-300" href={`mailto:${branding.supportEmail}`}>
                {branding.supportEmail}
              </a>
            ) : null}
            {branding.supportEmail && branding.supportPhone ? " · " : null}
            {branding.supportPhone ? branding.supportPhone : null}
            {(branding.supportEmail || branding.supportPhone) && branding.website ? " · " : null}
            {branding.website ? (
              <a className="text-cyan-300" href={branding.website} target="_blank" rel="noreferrer">
                {branding.website.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
          </p>
        ) : null}
        {branding.copyright ? <p className="mt-3 text-center text-xs text-slate-500">{branding.copyright}</p> : null}
      </motion.form>
    </main>
  );
}
