"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Menu, Sparkles, X } from "lucide-react";
import { BrandMark, useBranding } from "@/components/branding-provider";
import { PageMotion } from "@/components/page-motion";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api, apiOrigin, ensureAccessToken, getAccessToken, type Me } from "@/lib/api";
import { GROUP_TONE, NAV, navItemActive, pageMeta, type NavGroup } from "@/lib/nav";
import { cn } from "@/lib/utils";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { branding } = useBranding();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const current = pageMeta(path);

  useEffect(() => {
    api<{ success: true; data: Me }>("/api/v1/auth/me")
      .then(async (r) => {
        setMe(r.data);
        await ensureAccessToken();
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  useEffect(() => {
    if (!me?.hasAvatar) {
      setAvatarUrl(null);
      return;
    }
    const token = getAccessToken();
    let objectUrl = "";
    fetch(`${apiOrigin()}/api/v1/account/avatar`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      credentials: "include",
    })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob) return;
        objectUrl = URL.createObjectURL(blob);
        setAvatarUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [me?.hasAvatar, me?.id]);

  useEffect(() => {
    setOpen(false);
  }, [path]);

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    localStorage.removeItem("wacalls_token");
    router.replace("/login");
  }

  const groups: NavGroup[] = me?.superAdmin
    ? ["Overview", "Calling", "Workspace", "Super admin"]
    : ["Overview", "Calling", "Workspace"];

  const nav = (
    <>
      <div className="flex items-center gap-3 px-5 py-5">
        <BrandMark size={40} />
        <div className="min-w-0">
          <div className="truncate font-semibold leading-none text-white">{branding.brandName}</div>
          <div className="mt-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-300">
            <Sparkles className="h-3 w-3" />
            {me?.organization?.plan?.name ?? "Workspace"}
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group}>
            <div className={cn("px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em]", GROUP_TONE[group].label)}>
              {group}
            </div>
            <div className="space-y-0.5">
              {NAV.filter((item) => item.group === group)
                .filter((item) => !item.superAdmin || me?.superAdmin)
                .map((item) => {
                  const active = navItemActive(item.href, path);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition",
                        active ? GROUP_TONE[item.group].active : "text-slate-300 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <Icon className={cn("h-4 w-4", active ? GROUP_TONE[item.group].icon : "text-slate-400")} />
                      {item.label}
                    </Link>
                  );
                })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 bg-black/20 p-4 text-xs">
        <div className="flex items-center gap-2.5">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-brand-400/40" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-cyan-400 text-[12px] font-semibold text-ink-950">
              {(me?.name || "?").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate font-medium text-white">{me?.name}</div>
            <div className="truncate text-slate-400">{me?.organization?.name ?? me?.email}</div>
          </div>
        </div>
        <div className="mt-2 truncate text-slate-400">{me?.email}</div>
        <div className="mt-1 font-medium text-cyan-300">{me?.role?.replaceAll("_", " ")}</div>
        <button
          onClick={logout}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-3.5 w-3.5" /> Logout
        </button>
      </div>
    </>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen">
        <aside className="hidden w-72 flex-col border-r border-white/10 bg-ink-900/80 backdrop-blur-xl md:flex">{nav}</aside>
        <AnimatePresence>
          {open ? (
            <motion.div
              key="mobile-nav"
              className="fixed inset-0 z-40 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <button className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} aria-label="Close menu" />
              <motion.aside
                initial={{ x: -24 }}
                animate={{ x: 0 }}
                className="relative flex h-full w-72 flex-col border-r border-white/10 bg-ink-900"
              >
                {nav}
              </motion.aside>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/10 bg-ink-950/70 px-4 py-3 backdrop-blur-xl md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setOpen(true)}
                className="rounded-xl bg-white/10 p-2 md:hidden"
                aria-label="Open menu"
              >
                {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
              <current.icon className={cn("hidden h-5 w-5 md:block", GROUP_TONE[current.group].icon)} />
              <div className="min-w-0">
                <div className="truncate font-semibold text-white">{current.label}</div>
                <div className="hidden text-[11px] uppercase tracking-[0.16em] text-slate-400 sm:block">
                  {current.group} · {branding.brandName}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href="/settings"
                    className="hidden max-w-[220px] truncate rounded-full bg-white/10 px-3 py-1.5 text-xs text-slate-300 ring-1 ring-white/10 hover:bg-white/15 md:block"
                  >
                    {me?.email ?? "Account"}
                  </Link>
                </TooltipTrigger>
                <TooltipContent>{me?.superAdmin ? "Open profile" : "Profile and password"}</TooltipContent>
              </Tooltip>
            </div>
          </header>
          <div className="flex-1 overflow-auto p-5 md:p-8">
            <PageMotion key={path}>{children}</PageMotion>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
