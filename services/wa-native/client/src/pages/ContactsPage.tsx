import { useState } from "react";
import { PlusCircle, Search, Star, Trash2, Edit2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useContacts, type Contact } from "@/stores/contacts";
import { useI18n } from "@/lib/i18n";

export const ContactsPage = () => {
  const contacts = useContacts((s) => s.contacts);
  const add = useContacts((s) => s.add);
  const update = useContacts((s) => s.update);
  const remove = useContacts((s) => s.remove);
  const toggleFavorite = useContacts((s) => s.toggleFavorite);
  const t = useI18n((s) => s.t);

  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });

  const filtered = contacts
    .filter((c) => {
      const q = query.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.email.toLowerCase().includes(q);
    })
    .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || b.createdAt - a.createdAt);

  const resetForm = () => {
    setForm({ name: "", phone: "", email: "", notes: "" });
    setShowForm(false);
    setEditId(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;
    if (editId) {
      update(editId, { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(), notes: form.notes.trim() });
    } else {
      add({ name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(), notes: form.notes.trim(), favorite: false });
    }
    resetForm();
  };

  const startEdit = (c: Contact) => {
    setForm({ name: c.name, phone: c.phone, email: c.email, notes: c.notes });
    setEditId(c.id);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t("contacts")}</h2>
          <p className="text-sm text-muted-foreground">{contacts.length} {t("contacts").toLowerCase()}</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <PlusCircle className="mr-2 h-4 w-4" />
          {t("new_contact")}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{editId ? t("edit_contact") : t("new_contact")}</h3>
                <Button type="button" variant="ghost" size="icon" onClick={resetForm}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  placeholder={`${t("name")} *`}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  required
                />
                <input
                  placeholder={`${t("phone")} *`}
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  required
                />
                <input
                  placeholder={t("email")}
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                />
                <input
                  placeholder={t("notes")}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm">
                  {editId ? t("save") : t("add")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder={t("search_contacts")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {contacts.length === 0 ? t("no_contacts") : t("no_results")}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-center gap-3 p-3">
                <button
                  onClick={() => toggleFavorite(c.id)}
                  className="shrink-0"
                  aria-label={c.favorite ? t("unfavorite") : t("favorite")}
                >
                  <Star
                    className={`h-5 w-5 ${c.favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.phone}</p>
                  {c.email && <p className="truncate text-xs text-muted-foreground">{c.email}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(c)}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(c.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
