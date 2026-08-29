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
} from "lucide-react";
import { api, type Me } from "@/lib/api";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dialer", label: "Dialer", icon: PhoneCall },
  { href: "/channels", label: "WhatsApp", icon: Phone },
  { href: "/live", label: "Live", icon: Radio },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/history", label: "History", icon: History },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/recordings", label: "Recordings", icon: AudioLines },
  { href: "/agents", label: "Agents", icon: List },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/api-keys", label: "API keys", icon: KeyRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api<{ success: true; data: Me }>("/api/v1/auth/me")
      .then((r) => setMe(r.data))
      .catch(() => router.replace("/login"));
  }, [router]);

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    localStorage.removeItem("wacalls_token");
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-white/10 bg-ink-900/70">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-ink-950">
            <Phone className="h-4 w-4" />
          </div>
          <div>
            <div className="font-semibold leading-none">WaCalls</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">Self-hosted</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map((item) => {
            const active = path === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  active ? "bg-brand-500/15 text-brand-400" : "text-slate-300 hover:bg-white/5"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-4 text-xs text-slate-400">
          <div className="truncate">{me?.name}</div>
          <div className="truncate text-slate-500">{me?.email}</div>
          <div className="mt-1 text-brand-400">{me?.role}</div>
          <button onClick={logout} className="mt-3 flex items-center gap-1 text-slate-400 hover:text-white">
            <LogOut className="h-3.5 w-3.5" /> Logout
          </button>
        </div>
      </aside>
      <div className="flex-1 overflow-auto p-8">{children}</div>
    </div>
  );
}
