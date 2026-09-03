import { useState } from "react";
import { Loader2, Plus, Trash2, Phone, Users, CalendarDays, StickyNote, Mic, Webhook, Landmark } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { setActiveSession, useSessions } from "@/stores/sessions";
import { createSession, deleteSession } from "@/services/sessions";
import { useI18n } from "@/lib/i18n";
import type { SessionInfo, SessionState } from "@/types/session";

export type PageId = "calls" | "contacts" | "schedule" | "notes" | "recordings" | "webhooks" | "sip";

const dotClass: Record<SessionState, string> = {
  open: "bg-primary",
  qr: "bg-amber-500",
  connecting: "bg-muted-foreground/50",
  logged_out: "bg-destructive",
};

const navItems: { id: PageId; icon: typeof Phone; labelKey: string }[] = [
  { id: "calls", icon: Phone, labelKey: "calls_nav" },
  { id: "contacts", icon: Users, labelKey: "contacts_nav" },
  { id: "recordings", icon: Mic, labelKey: "recordings_nav" },
  { id: "webhooks", icon: Webhook, labelKey: "webhooks_nav" },
  { id: "sip", icon: Landmark, labelKey: "sip_nav" },
  { id: "schedule", icon: CalendarDays, labelKey: "schedule_nav" },
  { id: "notes", icon: StickyNote, labelKey: "notes_nav" },
];

export const Sidebar = ({
  onNavigate,
  activePage,
  onSetPage,
}: {
  onNavigate?: () => void;
  activePage?: PageId;
  onSetPage?: (p: PageId) => void;
}) => {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const t = useI18n((s) => s.t);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<SessionInfo | null>(null);

  const onNew = async () => {
    setCreating(true);
    try {
      const { id } = await createSession("WhatsApp");
      setActiveSession(id);
      onNavigate?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteSession(id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const nav = (p: PageId) => {
    onSetPage?.(p);
    onNavigate?.();
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="space-y-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => nav(item.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm",
              activePage === item.id ? "bg-accent text-accent-foreground font-medium" : "hover:bg-muted text-muted-foreground",
            )}
          >
            <item.icon className="h-4 w-4" />
            {t(item.labelKey as any)}
          </button>
        ))}
      </div>

      <div className="my-1 h-px bg-border" />

      <p className="px-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("accounts")}
      </p>
      <div className="flex-1 space-y-1 overflow-y-auto">
        {sessions.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              setActiveSession(s.id);
              onNavigate?.();
            }}
            className={cn(
              "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm",
              s.id === activeId ? "bg-accent text-accent-foreground" : "hover:bg-muted",
            )}
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", dotClass[s.state])} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.name}</p>
              {s.jid && <p className="truncate text-xs text-muted-foreground">{s.jid.split("@")[0]}</p>}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setToDelete(s);
              }}
              className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              aria-label={`Delete ${s.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {sessions.length === 0 && <p className="px-2 text-sm text-muted-foreground">No accounts yet.</p>}
      </div>
      <Button variant="outline" className="w-full" onClick={onNew} disabled={creating}>
        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {t("new_session")}
      </Button>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete account?"
        description={toDelete ? `${toDelete.name} will be logged out and removed.` : undefined}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (toDelete) void remove(toDelete.id);
        }}
      />
    </div>
  );
};
