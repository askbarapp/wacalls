import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1",
  {
    variants: {
      variant: {
        default: "bg-brand-500/15 text-brand-300 ring-brand-500/30",
        cyan: "bg-cyan-500/15 text-cyan-200 ring-cyan-500/30",
        violet: "bg-violet-500/15 text-violet-200 ring-violet-500/30",
        amber: "bg-amber-400/15 text-amber-200 ring-amber-400/30",
        rose: "bg-rose-500/15 text-rose-200 ring-rose-500/30",
        slate: "bg-white/10 text-slate-200 ring-white/15",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
