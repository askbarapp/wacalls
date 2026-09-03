import { useState } from "react";
import { PlusCircle, CalendarDays, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSchedule, type ScheduledCall } from "@/stores/schedule";
import { useContacts } from "@/stores/contacts";
import { useI18n } from "@/lib/i18n";

export const SchedulePage = () => {
  const scheduled = useSchedule((s) => s.calls);
  const add = useSchedule((s) => s.add);
  const update = useSchedule((s) => s.update);
  const remove = useSchedule((s) => s.remove);
  const contacts = useContacts((s) => s.contacts);
  const t = useI18n((s) => s.t);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    contactId: "",
    scheduledDate: "",
    scheduledTime: "",
    duration: "5",
    notes: "",
  });

  const selectedContact = contacts.find((c) => c.id === form.contactId);

  const pending = scheduled
    .filter((c) => c.status === "pending")
    .sort((a, b) => a.scheduledAt - b.scheduledAt);
  const past = scheduled.filter((c) => c.status !== "pending").sort((a, b) => b.scheduledAt - a.scheduledAt);

  const resetForm = () => {
    setForm({ contactId: "", scheduledDate: "", scheduledTime: "", duration: "5", notes: "" });
    setShowForm(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.contactId || !form.scheduledDate || !form.scheduledTime) return;
    const dt = new Date(`${form.scheduledDate}T${form.scheduledTime}`);
    add({
      contactId: form.contactId,
      contactName: selectedContact?.name || "",
      phone: selectedContact?.phone || "",
      scheduledAt: dt.getTime(),
      duration: Number(form.duration) || 5,
      notes: form.notes.trim(),
      status: "pending",
    });
    resetForm();
  };

  const formatWhen = (ts: number) => {
    const d = new Date(ts);
    const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${date} ${time}`;
  };

  const statusVariant = (s: ScheduledCall["status"]) => {
    if (s === "pending") return "default";
    if (s === "completed") return "success";
    return "muted";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t("schedule")}</h2>
          <p className="text-sm text-muted-foreground">
            {pending.length} {t("upcoming")}
          </p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <PlusCircle className="mr-2 h-4 w-4" />
          {t("new_scheduled")}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{t("new_scheduled")}</h3>
                <Button type="button" variant="ghost" size="icon" onClick={resetForm}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <select
                  value={form.contactId}
                  onChange={(e) => setForm((f) => ({ ...f, contactId: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  required
                >
                  <option value="">{t("select_contact")}</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={form.scheduledDate}
                  onChange={(e) => setForm((f) => ({ ...f, scheduledDate: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  required
                />
                <input
                  type="time"
                  value={form.scheduledTime}
                  onChange={(e) => setForm((f) => ({ ...f, scheduledTime: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  required
                />
                <input
                  type="number"
                  placeholder={t("duration_min")}
                  value={form.duration}
                  onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                  min="1"
                  max="120"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                />
              </div>
              <input
                placeholder={t("notes")}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              />
              <div className="flex justify-end">
                <Button type="submit" size="sm">{t("schedule")}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">{t("upcoming")}</h3>
          {pending.map((sc) => (
            <Card key={sc.id}>
              <CardContent className="flex items-center gap-3 p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <CalendarDays className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{sc.contactName || sc.phone}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatWhen(sc.scheduledAt)} · {sc.duration}min
                  </p>
                  {sc.notes && <p className="mt-0.5 truncate text-xs text-muted-foreground italic">{sc.notes}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => update(sc.id, { status: "completed" })}
                    aria-label={t("mark_complete")}
                  >
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => update(sc.id, { status: "cancelled" })}
                    aria-label={t("cancel_schedule")}
                  >
                    <X className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">{t("past")}</h3>
          {past.map((sc) => (
            <Card key={sc.id} className="opacity-70">
              <CardContent className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{sc.contactName || sc.phone}</p>
                  <p className="text-xs text-muted-foreground">{formatWhen(sc.scheduledAt)}</p>
                </div>
                <Badge variant={statusVariant(sc.status)}>{t(sc.status)}</Badge>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(sc.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {scheduled.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">{t("no_schedule")}</div>
      )}
    </div>
  );
};
