"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const light = theme === "light";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={light ? "Dark mode" : "Light mode"}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg border transition",
        light
          ? "border-slate-200 bg-white text-amber-500 hover:bg-slate-50"
          : "border-white/10 bg-white/10 text-amber-300 hover:bg-white/15",
        className,
      )}
    >
      {light ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}
