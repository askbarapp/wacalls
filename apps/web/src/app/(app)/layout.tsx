"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  History,
  LayoutDashboard,
  Phone,
  PhoneCall,
  Radio,
  Settings,
  Users,
  List,
  Megaphone,
  KeyRound,
  Webhook,
  AudioLines,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { api, type Me } from "@/lib/api";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
  { href: "/dialer", label: "Dialer", icon: PhoneCall, group: "Calling" },
  { href: "/channels", label: "WhatsApp", icon: Phone, group: "Calling" },
  { href: "/live", label: "Live", icon: Radio, group: "Calling" },
  { href: "/contacts", label: "Contacts", icon: Users, group: "Workspace" },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, group: "Workspace" },
  { href: "/history", label: "History", icon: History, group: "Workspace" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, group: "Workspace" },
  { href: "/recordings", label: "Recordings", icon: AudioLines, group: "Workspace" },
  { href: "/agents", label: "Agents", icon: List, group: "Admin" },
  { href: "/webhooks", label: "Webhooks", icon: Webhook, group: "Admin" },
  { href: "/api-keys", label: "API keys", icon: KeyRound, group: "Admin" },
  { href: "/settings", label: "Settings", icon: Settings, group: "Admin" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api<{ success: true; data: Me }>("/api/v1/auth/me")
      .then((r) => setMe(r.data))
      .catch(() => router.replace("/login"));
  }, [router]);

  useEffect(() => {
    setOpen(false);
  }, [path]);

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    localStorage.removeItem("wacalls_token");
    router.replace("/login");
  }

  const groups = ["Overview", "Calling", "Workspace", "Admin"];

  const nav = (
    <>
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-ink-950 shadow-lg shadow-brand-500/20">
          <Phone className="h-4 w-4" />
        </div>
        <div>
          <div className="font-semibold leading-none">WaCalls</div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">Self-hosted</div>
        </div>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group}>
            <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">{group}</div>
            <div className="space-y-0.5">
              {NAV.filter((item) => item.group === group).map((item) => {
                const active = path === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                      active
                        ? "bg-brand-500/15 text-brand-400 shadow-[inset_2px_0_0_0] shadow-brand-400"
                        : "text-slate-300 hover:bg-white/5"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4 text-xs text-slate-400">
        <div className="truncate font-medium text-slate-200">{me?.name}</div>
        <div className="truncate text-slate-500">{me?.email}</div>
        <div className="mt-1 text-brand-400">{me?.role?.replaceAll("_", " ")}</div>
        <button onClick={logout} className="mt-3 flex items-center gap-1 text-slate-400 hover:text-white">
          <LogOut className="h-3.5 w-3.5" /> Logout
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 flex-col border-r border-white/10 bg-ink-900/80 backdrop-blur md:flex">{nav}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-label="Close menu" />
          <aside className="relative flex h-full w-64 flex-col border-r border-white/10 bg-ink-900">{nav}</aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-white/10 bg-ink-900/40 px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} className="rounded-lg bg-white/10 p-2" aria-label="Open menu">
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <span className="font-medium">WaCalls</span>
        </header>
        <div className="flex-1 overflow-auto p-5 md:p-8">{children}</div>
      </div>
    </div>
  );
}
