"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import { api } from "@/lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
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
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-ink-900/80 p-8 shadow-2xl backdrop-blur"
      >
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500 text-ink-950">
            <Phone className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">WaCalls</h1>
            <p className="text-sm text-slate-400">WhatsApp Web Calling & Sequential Dialer</p>
          </div>
        </div>
        <label className="mb-4 block text-sm">
          Email
          <input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="mb-4 block text-sm">
          Password
          <input
            className="mt-1"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <label className="mb-6 flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" />
          Remember session
        </label>
        {error ? <p className="mb-4 text-sm text-rose-400">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-500 py-2.5 font-medium text-ink-950 hover:bg-brand-400"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <p className="mt-6 text-center text-xs text-slate-500">
          Unofficial WhatsApp Web linking. Not the Meta Cloud API.
        </p>
      </form>
    </main>
  );
}
