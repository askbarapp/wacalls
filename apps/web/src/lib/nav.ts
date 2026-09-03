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
  Bot,
  MessageSquare,
  Code2,
  Shield,
  Globe,
  Reply,
  UserCog,
  CreditCard,
  Receipt,
  Palette,
  type LucideIcon,
} from "lucide-react";

export type NavGroup = "Overview" | "Calling" | "Workspace" | "Super admin";

export const NAV: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  superAdmin?: boolean;
}> = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
  { href: "/dialer", label: "Dialer", icon: PhoneCall, group: "Calling" },
  { href: "/visits", label: "Website Visit", icon: Globe, group: "Calling" },
  { href: "/channels", label: "WhatsApp", icon: Phone, group: "Calling" },
  { href: "/live", label: "Live", icon: Radio, group: "Calling" },
  { href: "/messages", label: "Messages", icon: MessageSquare, group: "Workspace" },
  { href: "/auto-reply", label: "Call follow-up", icon: Reply, group: "Workspace" },
  { href: "/contacts", label: "Contacts", icon: Users, group: "Workspace" },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, group: "Workspace" },
  { href: "/ai-calling", label: "AI calling", icon: Bot, group: "Workspace" },
  { href: "/history", label: "Call log", icon: History, group: "Workspace" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, group: "Workspace" },
  { href: "/recordings", label: "Recordings", icon: AudioLines, group: "Workspace" },
  { href: "/agents", label: "Team", icon: List, group: "Workspace" },
  { href: "/webhooks", label: "Webhooks", icon: Webhook, group: "Workspace" },
  { href: "/api-keys", label: "API keys", icon: KeyRound, group: "Workspace" },
  { href: "/developers", label: "Developers", icon: Code2, group: "Workspace" },
  { href: "/settings", label: "Profile", icon: Settings, group: "Workspace" },
  { href: "/platform", label: "Overview", icon: Shield, group: "Super admin", superAdmin: true },
  { href: "/platform/users", label: "Users", icon: UserCog, group: "Super admin", superAdmin: true },
  { href: "/platform/plans", label: "Plans", icon: CreditCard, group: "Super admin", superAdmin: true },
  { href: "/platform/billing", label: "Billing", icon: Receipt, group: "Super admin", superAdmin: true },
  { href: "/platform/settings", label: "Branding", icon: Palette, group: "Super admin", superAdmin: true },
];

export const GROUP_TONE: Record<NavGroup, { label: string; active: string; icon: string; bar: string }> = {
  Overview: {
    label: "text-emerald-300",
    active: "bg-emerald-500/15 text-emerald-200 shadow-[inset_3px_0_0_0] shadow-emerald-400",
    icon: "text-emerald-400",
    bar: "from-emerald-400 to-cyan-400",
  },
  Calling: {
    label: "text-cyan-300",
    active: "bg-cyan-500/15 text-cyan-100 shadow-[inset_3px_0_0_0] shadow-cyan-400",
    icon: "text-cyan-400",
    bar: "from-cyan-400 to-sky-400",
  },
  Workspace: {
    label: "text-violet-300",
    active: "bg-violet-500/15 text-violet-100 shadow-[inset_3px_0_0_0] shadow-violet-400",
    icon: "text-violet-400",
    bar: "from-violet-400 to-fuchsia-400",
  },
  "Super admin": {
    label: "text-rose-300",
    active: "bg-rose-500/15 text-rose-100 shadow-[inset_3px_0_0_0] shadow-rose-400",
    icon: "text-rose-400",
    bar: "from-rose-400 to-pink-400",
  },
};

export function pageMeta(path: string) {
  const exact = NAV.find((item) => item.href === path);
  if (exact) return exact;
  const hit = NAV.filter((item) => item.href !== "/" && path.startsWith(`${item.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return hit ?? { href: path, label: "Workspace", icon: LayoutDashboard, group: "Overview" as NavGroup };
}

export function navItemActive(href: string, path: string) {
  if (href === "/") return path === "/";
  if (path === href) return true;
  if (!path.startsWith(`${href}/`)) return false;
  return !NAV.some(
    (other) =>
      other.href !== href &&
      other.href.startsWith(`${href}/`) &&
      (path === other.href || path.startsWith(`${other.href}/`)),
  );
}
