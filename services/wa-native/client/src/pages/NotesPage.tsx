import { useState } from "react";
import { StickyNote, Star, Trash2, PlusCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNotes, type CallNote } from "@/stores/callNotes";
import { useI18n } from "@/lib/i18n";

export const NotesPage = () => {
  const notes = useNotes((s) => s.notes);
  const add = useNotes((s) => s.add);
  const update = useNotes((s) => s.update);
  const remove = useNotes((s) => s.remove);
  const t = useI18n((s) => s.t);

  const [showForm, setShowForm] = useState(false);
  const [editCallId, setEditCallId] = useState<string | null>(null);
  const [form, setForm] = useState({
    callId: "",
    contactName: "",
    phone: "",
    duration: "",
    rating: "0",
    notes: "",
    tags: "",
  });

  const sorted = [...notes].sort((a, b) => b.createdAt - a.createdAt);

  const resetForm = () => {
    setForm({ callId: "", contactName: "", phone: "", duration: "", rating: "0", notes: "", tags: "" });
    setShowForm(false);
    setEditCallId(null);
  };

  const startEdit = (n: CallNote) => {
    setForm({
      callId: n.callId,
      contactName: n.contactName,
      phone: n.phone,
      duration: String(n.duration),
      rating: String(n.rating),
      notes: n.notes,
      tags: n.tags.join(", "),
    });
    setEditCallId(n.callId);
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.contactName.trim()) return;
    const data = {
      callId: editCallId || form.callId || crypto.randomUUID(),
      contactName: form.contactName.trim(),
      phone: form.phone.trim(),
      duration: Number(form.duration) || 0,
      rating: Number(form.rating) || 0,
      notes: form.notes.trim(),
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    if (editCallId) {
      update(editCallId, { contactName: data.contactName, phone: data.phone, duration: data.duration, rating: data.rating, notes: data.notes, tags: data.tags });
    } else {
      add(data);
    }
    resetForm();
  };

  const renderStars = (rating: number) =>
    Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        className={`h-4 w-4 cursor-pointer ${i < rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
        onClick={() => setForm((f) => ({ ...f, rating: String(i + 1) }))}
      />
    ));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t("call_notes")}</h2>
          <p className="text-sm text-muted-foreground">{notes.length} {t("notes").toLowerCase()}</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <PlusCircle className="mr-2 h-4 w-4" />
          {t("new_note")}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{editCallId ? t("edit_note") : t("new_note")}</h3>
                <Button type="button" variant="ghost" size="icon" onClick={resetForm}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  placeholder={`${t("name")} *`}
                  value={form.contactName}
                  onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  required
                />
                <input
                  placeholder={t("phone")}
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                />
                <input
                  type="number"
                  placeholder={`${t("duration")} (seg)`}
                  value={form.duration}
                  onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                />
                <div className="flex items-center gap-1">{renderStars(Number(form.rating))}</div>
              </div>
              <textarea
                placeholder={t("call_notes_placeholder")}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              />
              <input
                placeholder={t("tags_placeholder")}
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              />
              <div className="flex justify-end">
                <Button type="submit" size="sm">{t("save")}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {sorted.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t("no_notes")}</div>
      ) : (
        <div className="space-y-2">
          {sorted.map((n) => (
            <Card key={n.callId}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{n.contactName}</p>
                      {n.rating > 0 && (
                        <span className="flex items-center gap-0.5">
                          {Array.from({ length: n.rating }, (_, i) => (
                            <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                          ))}
                        </span>
                      )}
                    </div>
                    {n.phone && <p className="text-xs text-muted-foreground">{n.phone}</p>}
                    {n.notes && <p className="mt-1 text-sm">{n.notes}</p>}
                    {n.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {n.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(n.createdAt).toLocaleDateString()}
                      {n.duration > 0 && ` · ${Math.floor(n.duration / 60)}:${String(n.duration % 60).padStart(2, "0")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(n)}>
                      <StickyNote className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(n.callId)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
