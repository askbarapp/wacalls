"use client";

import type { LucideIcon } from "lucide-react";
import { FadeItem } from "@/components/page-motion";
import { cn } from "@/lib/utils";

const TONES = {
  emerald: { ring: "ring-emerald-400/30", wash: "from-emerald-500/30 via-emerald-500/5 to-transparent", icon: "bg-emerald-400/20 text-emerald-200" },
  cyan: { ring: "ring-cyan-400/30", wash: "from-cyan-500/30 via-cyan-500/5 to-transparent", icon: "bg-cyan-400/20 text-cyan-200" },
  violet: { ring: "ring-violet-400/30", wash: "from-violet-500/30 via-violet-500/5 to-transparent", icon: "bg-violet-400/20 text-violet-200" },
  amber: { ring: "ring-amber-400/30", wash: "from-amber-500/30 via-amber-500/5 to-transparent", icon: "bg-amber-400/20 text-amber-200" },
  rose: { ring: "ring-rose-400/30", wash: "from-rose-500/30 via-rose-500/5 to-transparent", icon: "bg-rose-400/20 text-rose-200" },
  sky: { ring: "ring-sky-400/30", wash: "from-sky-500/30 via-sky-500/5 to-transparent", icon: "bg-sky-400/20 text-sky-200" },
} as const;

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "emerald",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
}) {
  const t = TONES[tone];
  return (
    <FadeItem>
      <div className={cn("surface relative overflow-hidden p-5 ring-1", t.ring)}>
        <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", t.wash)} />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-200">{label}</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-white">{value}</div>
            {hint ? <div className="mt-1 text-xs text-slate-300">{hint}</div> : null}
          </div>
          <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", t.icon)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </div>
    </FadeItem>
  );
}
