"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { BrandMark, useBranding } from "@/components/branding-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

type Plan = {
  id: string;
  name: string;
  slug: string;
  description: string;
  maxChannels: number;
  maxAgents: number;
  maxKnowledgeBases?: number;
  maxAiAgents?: number;
  maxMessagesPerDay: number;
  maxCallsPerDay: number;
  allowCloudApi: boolean;
  allowSdk: boolean;
  priceMonthly: number;
};

const PLAN_TONE = ["ring-emerald-400/30", "ring-cyan-400/30", "ring-violet-400/30"];

export default function SignupPage() {
  const { branding } = useBranding();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ success: true; data: Plan[] }>("/api/v1/plans")
      .then((r) => setPlans(r.data ?? []))
      .catch(() => undefined);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api<{ success: true; data: { accessToken: string } }>("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password, organizationName }),
      });
      localStorage.setItem("wacalls_token", res.data.accessToken);
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 overflow-hidden p-6 lg:flex-row lg:items-center">
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      <div className="pointer-events-none absolute left-0 top-0 h-72 w-72 rounded-full bg-violet-500/15 blur-3xl" />
      <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="relative flex-1">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark size={48} />
          <div>
            <h1 className="text-2xl font-semibold text-white">Create your {branding.brandName} account</h1>
            <p className="text-sm text-slate-300">{branding.tagline}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {plans.map((p, i) => (
            <div key={p.id} className={`surface p-4 ring-1 ${PLAN_TONE[i % PLAN_TONE.length]}`}>
              <div className="font-medium text-white">{p.name}</div>
              <div className="mt-1 text-sm font-semibold text-brand-400">
                {p.priceMonthly === 0 ? "Free trial" : `₹${(p.priceMonthly / 100).toFixed(0)}/mo`}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">{p.description}</p>
              <ul className="mt-3 space-y-1 text-xs text-slate-400">
                <li>{p.maxChannels} channel{p.maxChannels === 1 ? "" : "s"}</li>
                <li>{p.maxKnowledgeBases ?? 1} knowledge base{(p.maxKnowledgeBases ?? 1) === 1 ? "" : "s"}</li>
                <li>{p.maxAiAgents ?? 1} AI agent{(p.maxAiAgents ?? 1) === 1 ? "" : "s"}</li>
                <li>{p.maxCallsPerDay} calls / day</li>
                <li>{p.maxMessagesPerDay} messages / day</li>
                {p.allowCloudApi ? <li>Cloud API</li> : null}
                {p.allowSdk ? <li>Calling SDK</li> : null}
              </ul>
            </div>
          ))}
        </div>
      </motion.div>
      <motion.form
        onSubmit={onSubmit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="surface relative w-full max-w-md p-8 ring-1 ring-white/10"
      >
        <label className="mb-4 block">
          Your name
          <input className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </label>
        <label className="mb-4 block">
          Workspace name
          <input
            className="mt-1.5"
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            required
            minLength={2}
            placeholder="Acme Sales"
          />
        </label>
        <label className="mb-4 block">
          Email
          <input className="mt-1.5" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="mb-6 block">
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
        {error ? <p className="mb-4 rounded-xl bg-rose-500/15 px-3 py-2 text-sm text-rose-200">{error}</p> : null}
        <Button type="submit" disabled={loading} className="w-full" size="lg">
          {loading ? "Creating account…" : "Create account"}
        </Button>
        <p className="mt-6 text-center text-sm text-slate-300">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-cyan-300 hover:text-cyan-200">
            Sign in
          </Link>
        </p>
        {branding.supportEmail || branding.supportPhone ? (
          <p className="mt-4 text-center text-xs text-slate-400">
            {branding.supportEmail ? (
              <a className="text-emerald-300" href={`mailto:${branding.supportEmail}`}>
                {branding.supportEmail}
              </a>
            ) : null}
            {branding.supportEmail && branding.supportPhone ? " · " : null}
            {branding.supportPhone ? branding.supportPhone : null}
          </p>
        ) : null}
        {branding.copyright ? <p className="mt-3 text-center text-xs text-slate-500">{branding.copyright}</p> : null}
      </motion.form>
    </main>
  );
}
