"use client";

import { useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Syne } from "next/font/google";
import {
  ArrowRight,
  Bot,
  Megaphone,
  MessageSquare,
  PhoneCall,
  Radio,
  AudioLines,
  Plug,
  Sparkles,
  Users,
} from "lucide-react";
import { BrandMark, useBranding } from "@/components/branding-provider";
import { getAccessToken } from "@/lib/api";

const display = Syne({ subsets: ["latin"], weight: ["600", "700", "800"] });

const STEPS = [
  {
    n: "01",
    title: "Connect",
    body: "Link your WhatsApp number with a quick QR or pairing code. Online in minutes.",
    icon: Plug,
  },
  {
    n: "02",
    title: "Create",
    body: "Build campaigns, scripts, or AI voice agents. Upload contacts and set your flow.",
    icon: Sparkles,
  },
  {
    n: "03",
    title: "Call",
    body: "Dial one-to-one or launch bulk calls. Monitor live, record, and follow up automatically.",
    icon: PhoneCall,
  },
];

const FEATURES = [
  {
    title: "WhatsApp dialer",
    body: "Place and receive calls from the browser with a clean agent workspace.",
    icon: PhoneCall,
  },
  {
    title: "Campaigns",
    body: "Sequential outbound dialing with pacing, retries, and clear contact status.",
    icon: Megaphone,
  },
  {
    title: "AI calling",
    body: "Conversational agents that speak, listen, and follow your knowledge base.",
    icon: Bot,
  },
  {
    title: "Live floor",
    body: "See active calls in real time so supervisors stay in control.",
    icon: Radio,
  },
  {
    title: "Messaging & follow-up",
    body: "Chat after the call and send automatic follow-ups when someone misses you.",
    icon: MessageSquare,
  },
  {
    title: "Recordings & team",
    body: "Keep call audio, share work across agents, and review what happened.",
    icon: AudioLines,
  },
];

export default function LandingPage() {
  const { branding } = useBranding();

  useEffect(() => {
    if (getAccessToken()) {
      window.location.replace("/dashboard");
    }
  }, []);

  const year = new Date().getFullYear();
  const copyright = branding.copyright?.trim() || `© ${year} ${branding.brandName}. All rights reserved.`;

  return (
    <div className="landing-page relative min-h-screen overflow-x-hidden bg-[#e8f3ef] text-slate-900">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 480px at 12% -8%, rgba(16,185,129,0.28), transparent 55%), radial-gradient(720px 420px at 92% 8%, rgba(14,165,233,0.18), transparent 50%), radial-gradient(640px 360px at 50% 100%, rgba(45,212,191,0.16), transparent 55%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%230d9488' fill-opacity='0.06'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
        }}
      />

      <header className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <BrandMark size={40} />
          <span className={`${display.className} text-lg font-bold tracking-tight text-slate-900`}>
            {branding.brandName}
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white/60 hover:text-slate-950"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-700/20 transition hover:bg-emerald-500"
          >
            Get Started
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-5.5rem)] w-full max-w-6xl items-center gap-10 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:pb-20">
        <div>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className={`${display.className} text-5xl font-extrabold leading-[0.95] tracking-tight text-slate-950 sm:text-6xl md:text-7xl`}
          >
            {branding.brandName}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="mt-5 max-w-xl text-xl font-medium leading-snug text-slate-800 sm:text-2xl"
          >
            WhatsApp calling that feels light — dial, campaign, and talk with AI from one place.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16 }}
            className="mt-4 max-w-lg text-base leading-relaxed text-slate-600"
          >
            {branding.tagline || "Connect your number, create your flow, and start calling."}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.24 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center rounded-full border border-slate-300/80 bg-white/70 px-6 py-3 text-sm font-semibold text-slate-800 backdrop-blur transition hover:border-slate-400 hover:bg-white"
            >
              Login
            </Link>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 18 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto w-full max-w-md lg:max-w-none"
          aria-hidden
        >
          <div className="absolute -inset-6 rounded-[2.5rem] bg-gradient-to-br from-emerald-400/30 via-teal-300/20 to-sky-300/25 blur-2xl" />
          <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/55 p-6 shadow-[0_30px_80px_-40px_rgba(6,78,59,0.45)] backdrop-blur-xl sm:p-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Live</span>
              </div>
              <Users className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-8 space-y-4">
              {[
                { label: "Outbound campaign", tone: "Ringing…" },
                { label: "AI voice agent", tone: "In call" },
                { label: "Agent dialer", tone: "Connected" },
              ].map((row, i) => (
                <motion.div
                  key={row.label}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.35 + i * 0.12, duration: 0.4 }}
                  className="flex items-center justify-between rounded-2xl bg-slate-950/[0.04] px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700">
                      <PhoneCall className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{row.label}</div>
                      <div className="text-xs text-slate-500">{row.tone}</div>
                    </div>
                  </div>
                  <motion.span
                    animate={{ opacity: [0.35, 1, 0.35] }}
                    transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.3 }}
                    className="h-2 w-2 rounded-full bg-emerald-500"
                  />
                </motion.div>
              ))}
            </div>
            <div className="mt-8 overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-500 p-4 text-white">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-100">How it flows</div>
              <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
                <span>Connect</span>
                <ArrowRight className="h-3.5 w-3.5 opacity-70" />
                <span>Create</span>
                <ArrowRight className="h-3.5 w-3.5 opacity-70" />
                <span>Call</span>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      <section className="relative z-10 border-t border-emerald-900/5 bg-white/40 py-20 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">How to use</p>
          <h2 className={`${display.className} mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl`}>
            Connect. Create. Call.
          </h2>
          <p className="mt-3 max-w-2xl text-slate-600">
            Three calm steps from a fresh workspace to your first conversation on WhatsApp.
          </p>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.div
                  key={step.n}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.45, delay: i * 0.08 }}
                  className="relative"
                >
                  <div className="text-xs font-bold tracking-[0.2em] text-emerald-600/80">{step.n}</div>
                  <div className="mt-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-700/20">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className={`${display.className} mt-5 text-xl font-bold text-slate-950`}>{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="relative z-10 py-20">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Features</p>
          <h2 className={`${display.className} mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl`}>
            Everything you need after connect
          </h2>
          <p className="mt-3 max-w-2xl text-slate-600">
            From one-click dialing to AI agents, campaigns, live floors, and recordings — built for teams that live on WhatsApp.
          </p>
          <div className="mt-12 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-30px" }}
                  transition={{ duration: 0.4, delay: i * 0.05 }}
                >
                  <Icon className="h-5 w-5 text-emerald-600" />
                  <h3 className="mt-4 text-base font-semibold text-slate-950">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{feature.body}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="relative z-10 px-5 pb-20 sm:px-8">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-slate-950 px-8 py-12 text-white sm:px-12">
          <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className={`${display.className} text-3xl font-bold tracking-tight sm:text-4xl`}>
                Ready when you are
              </h2>
              <p className="mt-3 max-w-md text-slate-300">
                Create your workspace, connect WhatsApp, and place your first call today.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Login
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-emerald-900/10 bg-white/50 py-10 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 sm:flex-row sm:items-start sm:justify-between sm:px-8">
          <div className="flex items-center gap-3">
            <BrandMark size={36} />
            <div>
              <div className={`${display.className} font-bold text-slate-950`}>{branding.brandName}</div>
              {branding.tagline ? <div className="mt-1 max-w-sm text-xs text-slate-500">{branding.tagline}</div> : null}
            </div>
          </div>
          <div className="space-y-1 text-sm text-slate-600">
            {branding.supportEmail ? (
              <a className="block hover:text-emerald-700" href={`mailto:${branding.supportEmail}`}>
                {branding.supportEmail}
              </a>
            ) : null}
            {branding.supportPhone ? <div>{branding.supportPhone}</div> : null}
            {branding.website ? (
              <a className="block hover:text-emerald-700" href={branding.website} target="_blank" rel="noreferrer">
                {branding.website.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
          </div>
        </div>
        <div className="mx-auto mt-8 max-w-6xl px-5 text-xs text-slate-500 sm:px-8">{copyright}</div>
      </footer>
    </div>
  );
}
