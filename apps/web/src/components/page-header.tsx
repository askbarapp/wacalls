"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

export function PageHeader({
  title,
  subtitle,
  actions,
  tone = "from-brand-400 to-cyan-400",
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 56, opacity: 1 }}
          className={`mb-3 h-1 rounded-full bg-gradient-to-r ${tone}`}
        />
        <h1 className="text-3xl font-semibold tracking-tight text-white">{title}</h1>
        {subtitle ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-300">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
