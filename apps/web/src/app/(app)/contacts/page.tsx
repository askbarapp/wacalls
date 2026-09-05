"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Plus, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { ListPagination } from "@/components/list-pagination";
import { emptyMeta, type ListMeta, type PageSize } from "@/lib/csv";
import {
  CONTACT_SAMPLE_CSV,
  contactSampleSpreadsheet,
  downloadBlob,
  parseContactText,
  type ParsedContact,
} from "@/lib/parse-contacts";

type Contact = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  company?: string | null;
  doNotCall: boolean;
  whatsappOn?: boolean | null;
  whatsappCheckedAt?: string | null;
};

type ContactList = {
  id: string;
  name: string;
  description?: string | null;
  _count?: { members: number };
  members?: Array<{ contact: Contact }>;
};

const emptyForm = { name: "", phone: "", email: "", company: "" };

export default function ContactsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">Loading contacts…</div>}>
      <ContactsInner />
    </Suspense>
  );
}

function WhatsAppMark({ contact }: { contact: Contact }) {
  if (contact.whatsappOn === true) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400">
        <CheckCircle2 className="h-4 w-4" aria-hidden />
        Valid
      </span>
    );
  }
  if (contact.whatsappOn === false) {
    return <span className="text-sm text-slate-500">Not on WhatsApp</span>;
  }
  return <span className="text-sm text-slate-600">—</span>;
}

function ContactsInner() {
  const router = useRouter();
  const search = useSearchParams();
  const groupId = search.get("group") || "";
  const [lists, setLists] = useState<ContactList[]>([]);
  const [openGroup, setOpenGroup] = useState<ContactList | null>(null);
  const [listName, setListName] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<ParsedContact[] | null>(null);
  const [addMode, setAddMode] = useState<"manual" | "paste" | "file">("manual");
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [savingList, setSavingList] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [memoryEdit, setMemoryEdit] = useState<{
    phone: string;
    name: string;
    summary: string;
    factsText: string;
    lastIntent: string;
  } | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [meta, setMeta] = useState<ListMeta>(emptyMeta(25));
  const [membersLoading, setMembersLoading] = useState(false);

  const members = openGroup?.members ?? [];
  const memberIds = useMemo(() => members.map((m) => m.contact.id), [members]);
  const allSelected = memberIds.length > 0 && memberIds.every((id) => selected.has(id));
  const someSelected = memberIds.some((id) => selected.has(id));

  async function loadLists() {
    const contactLists = await api<{ success: true; data: ContactList[] }>("/api/v1/contact-lists");
    setLists(contactLists.data);
    return contactLists.data;
  }

  async function loadGroup(id: string, pageNum = page, limit = pageSize) {
    setMembersLoading(true);
    try {
      const detail = await api<{ success: true; data: ContactList; meta?: ListMeta }>(
        `/api/v1/contact-lists/${id}?page=${pageNum}&limit=${limit}`,
      );
      setOpenGroup(detail.data);
      setMeta(detail.meta ?? { ...emptyMeta(limit), total: detail.data.members?.length ?? 0, page: pageNum });
      if ((detail.data._count?.members ?? detail.data.members?.length ?? 0) === 0) setShowAdd(true);
      return detail.data;
    } finally {
      setMembersLoading(false);
    }
  }

  useEffect(() => {
    void loadLists().catch((err) => setError(err instanceof Error ? err.message : "Could not load groups"));
  }, []);

  useEffect(() => {
    if (groupId) {
      void loadGroup(groupId, page, pageSize).catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load group"),
      );
      return;
    }
    if (lists.length > 0) {
      router.replace(`/contacts?group=${lists[0].id}`);
      return;
    }
    setOpenGroup(null);
  }, [groupId, lists, router, page, pageSize]);

  useEffect(() => {
    setSelected(new Set());
    setPreview(null);
    setPaste("");
    setForm(emptyForm);
    setShowAdd(false);
    setPage(1);
  }, [groupId]);

  function open(id: string) {
    router.replace(`/contacts?group=${id}`);
  }

  async function createList(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    setNotice("");
    const name = listName.trim();
    if (!name) {
      setError("Enter a group name, e.g. College or Math department.");
      return;
    }
    setSavingList(true);
    try {
      const created = await api<{ success: true; data: ContactList }>("/api/v1/contact-lists", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setListName("");
      setCreatingGroup(false);
      setNotice(`Group “${created.data.name}” created. Add numbers, then verify WhatsApp.`);
      await loadLists();
      open(created.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create group");
    } finally {
      setSavingList(false);
    }
  }

  async function renameList(list: ContactList, name?: string) {
    const next = (name ?? editName).trim();
    if (!next) {
      setError("Enter a group name.");
      return;
    }
    setError("");
    setNotice("");
    try {
      await api(`/api/v1/contact-lists/${list.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: next }),
      });
      setEditingId("");
      setEditName("");
      setNotice(`Group renamed to “${next}”.`);
      await loadLists();
      if (openGroup?.id === list.id) await loadGroup(list.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename group");
    }
  }

  async function deleteList(list: ContactList) {
    if (!window.confirm(`Delete group “${list.name}”? People stay saved; only this group is removed.`)) return;
    setError("");
    try {
      await api(`/api/v1/contact-lists/${list.id}`, { method: "DELETE" });
      setNotice("Group deleted.");
      const remaining = await loadLists();
      if (openGroup?.id === list.id) {
        if (remaining[0]) open(remaining[0].id);
        else router.replace("/contacts");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete group");
    }
  }

  async function addManual(e?: React.FormEvent) {
    e?.preventDefault();
    if (!openGroup) return;
    setError("");
    setNotice("");
    if (!form.name.trim() || !form.phone.trim()) {
      setError("Name and phone are required.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/v1/contacts", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || undefined,
          company: form.company.trim() || undefined,
          listId: openGroup.id,
        }),
      });
      setForm(emptyForm);
      setNotice("Contact added. Select it and tap Verify WhatsApp.");
      await Promise.all([loadGroup(openGroup.id), loadLists()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add contact");
    } finally {
      setBusy(false);
    }
  }

  async function importRows(rows: ParsedContact[]) {
    if (!openGroup) return;
    if (!rows.length) {
      setError("No valid contacts found. Need a name and phone on each line.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api<{ success: true; data: { imported: number; failed: Array<{ phone: string; reason: string }> } }>(
        "/api/v1/contacts/bulk",
        { method: "POST", body: JSON.stringify({ listId: openGroup.id, rows }) },
      );
      const fail = res.data.failed?.length
        ? ` ${res.data.failed.length} skipped (${res.data.failed[0]?.reason}).`
        : "";
      setNotice(`${res.data.imported} contacts added to ${openGroup.name}.${fail} Select them and verify WhatsApp.`);
      setPreview(null);
      setPaste("");
      setShowAdd(false);
      await Promise.all([loadGroup(openGroup.id), loadLists()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import contacts");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(contactId: string) {
    if (!openGroup) return;
    setError("");
    try {
      await api(`/api/v1/contact-lists/${openGroup.id}/members/${contactId}`, { method: "DELETE" });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(contactId);
        return next;
      });
      await Promise.all([loadGroup(openGroup.id), loadLists()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove from group");
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(memberIds));
  }

  async function verifySelected() {
    if (!selected.size) {
      setError("Select one or more numbers, then tap Verify WhatsApp.");
      return;
    }
    setError("");
    setNotice("");
    setVerifying(true);
    try {
      const res = await api<{ success: true; data: { checked: number; onWhatsApp: number } }>("/api/v1/contacts/verify", {
        method: "POST",
        body: JSON.stringify({ contact_ids: [...selected] }),
      });
      setNotice(
        `${res.data.onWhatsApp} of ${res.data.checked} selected numbers are on WhatsApp. Green Valid marks are saved.`,
      );
      if (openGroup) await loadGroup(openGroup.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify WhatsApp numbers");
    } finally {
      setVerifying(false);
    }
  }

  async function onFile(file: File) {
    setError("");
    if (/\.xlsx$/i.test(file.name)) {
      setError("Upload the CSV or Excel sample (.csv / .xls). From Excel: File → Save As → CSV.");
      return;
    }
    const text = await file.text();
    const rows = parseContactText(text);
    if (!rows.length) {
      setError("Could not read contacts from that file. Use the sample CSV/Excel format.");
      return;
    }
    setPreview(rows);
    setAddMode("file");
  }

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Organize contacts into groups and verify WhatsApp numbers."
        actions={
          creatingGroup ? (
            <form onSubmit={createList} className="flex flex-col gap-2 sm:flex-row">
              <input
                className="min-h-11 w-56"
                placeholder="Group name"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                autoFocus
              />
              <button
                type="submit"
                disabled={savingList}
                className="min-h-11 rounded-lg bg-brand-500 px-4 text-sm font-medium text-ink-950 hover:bg-brand-400"
              >
                {savingList ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                className="min-h-11 rounded-lg bg-white/10 px-4 text-sm"
                onClick={() => {
                  setCreatingGroup(false);
                  setListName("");
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreatingGroup(true)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-500 px-4 text-sm font-medium text-ink-950 hover:bg-brand-400"
            >
              <Plus className="h-4 w-4" />
              New Group
            </button>
          )
        }
      />
      {error ? (
        <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}{" "}
          {error.toLowerCase().includes("whatsapp") ? (
            <Link href="/channels" className="font-medium text-brand-400 underline">
              Open WhatsApp
            </Link>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-6 rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-sm text-brand-200">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-white/10 bg-ink-900/70 p-3">
          <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Groups</div>
          <div className="space-y-1">
            {lists.map((l) => {
              const active = openGroup?.id === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => open(l.id)}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm ${
                    active ? "bg-brand-500/15 text-white" : "text-slate-300 hover:bg-white/5"
                  }`}
                >
                  <Users className={`h-4 w-4 shrink-0 ${active ? "text-brand-400" : "text-slate-500"}`} />
                  <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      active ? "bg-brand-500/25 text-brand-300" : "bg-white/10 text-slate-400"
                    }`}
                  >
                    {l._count?.members ?? 0}
                  </span>
                </button>
              );
            })}
            {lists.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-slate-500">
                No groups yet. Tap New Group to start, then add numbers and verify WhatsApp.
              </p>
            ) : null}
          </div>
        </aside>

        <section className="rounded-2xl border border-white/10 bg-ink-900/70">
          {!openGroup ? (
            <div className="p-10 text-center text-sm text-slate-500">
              Create a group on the left, add phone numbers, then select and verify WhatsApp.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div className="min-w-0">
                  {editingId === openGroup.id ? (
                    <form
                      className="flex flex-col gap-2 sm:flex-row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void renameList(openGroup);
                      }}
                    >
                      <input
                        className="min-h-11"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                      />
                      <button type="submit" className="min-h-11 rounded-lg bg-brand-500 px-4 text-sm font-medium text-ink-950">
                        Save
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded-lg bg-white/10 px-4 text-sm"
                        onClick={() => {
                          setEditingId("");
                          setEditName("");
                        }}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="text-left text-lg font-medium text-white hover:text-brand-300"
                        onClick={() => {
                          setEditingId(openGroup.id);
                          setEditName(openGroup.name);
                        }}
                        title="Rename group"
                      >
                        {openGroup.name}
                      </button>
                      <p className="text-xs text-slate-500">
                        {meta.total} contact{meta.total === 1 ? "" : "s"}
                        {someSelected ? ` · ${selected.size} selected` : ""}
                      </p>
                    </>
                  )}
                </div>
                {editingId === openGroup.id ? null : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={verifying}
                      onClick={() => void verifySelected()}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white hover:bg-white/10"
                    >
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      {verifying ? "Verifying…" : "Verify WhatsApp"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAdd((v) => !v);
                        setPreview(null);
                      }}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-brand-500 px-3 text-sm font-medium text-ink-950 hover:bg-brand-400"
                    >
                      <Plus className="h-4 w-4" />
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteList(openGroup)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-200"
                      aria-label="Delete group"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              {showAdd ? (
                <div className="border-b border-white/10 px-5 py-4">
                  <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl bg-ink-800 p-1">
                    {(
                      [
                        ["manual", "Manual"],
                        ["paste", "Copy-paste"],
                        ["file", "CSV / Excel"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setAddMode(id);
                          setPreview(null);
                        }}
                        className={`min-h-10 rounded-lg text-sm font-medium ${
                          addMode === id ? "bg-brand-500 text-ink-950" : "text-slate-300"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {addMode === "manual" ? (
                    <form onSubmit={addManual} className="grid gap-2 sm:grid-cols-2">
                      <input
                        className="min-h-11"
                        placeholder="Name"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                      <input
                        className="min-h-11"
                        placeholder="Phone (e.g. 9876543210)"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        inputMode="tel"
                      />
                      <input
                        className="min-h-11"
                        placeholder="Email (optional)"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                      />
                      <input
                        className="min-h-11"
                        placeholder="Company / department (optional)"
                        value={form.company}
                        onChange={(e) => setForm({ ...form, company: e.target.value })}
                      />
                      <button
                        type="submit"
                        disabled={busy}
                        className="min-h-11 rounded-lg bg-brand-500 font-medium text-ink-950 hover:bg-brand-400 sm:col-span-2"
                      >
                        {busy ? "Adding…" : "Add to group"}
                      </button>
                    </form>
                  ) : null}

                  {addMode === "paste" ? (
                    <div>
                      <p className="mb-2 text-xs text-slate-500">
                        One person per line: <span className="text-slate-300">Rahul Sharma, 9876543210</span> or just a
                        phone number.
                      </p>
                      <textarea
                        className="min-h-28"
                        placeholder={"Rahul Sharma, 9876543210\nAnita Verma 9876543211"}
                        value={paste}
                        onChange={(e) => setPaste(e.target.value)}
                      />
                      <button
                        type="button"
                        disabled={busy || !paste.trim()}
                        onClick={() => {
                          const rows = parseContactText(paste);
                          setPreview(rows);
                          if (!rows.length) setError("No phones found in the pasted text.");
                        }}
                        className="mt-3 min-h-11 w-full rounded-lg bg-brand-500 font-medium text-ink-950 hover:bg-brand-400"
                      >
                        Preview paste
                      </button>
                    </div>
                  ) : null}

                  {addMode === "file" ? (
                    <div>
                      <p className="mb-3 text-xs text-slate-500">
                        Download a dummy sample, fill names and phones, then upload it here.
                      </p>
                      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          className="min-h-11 rounded-lg bg-white/10 px-4 text-sm"
                          onClick={() =>
                            downloadBlob("contacts-sample.csv", `\uFEFF${CONTACT_SAMPLE_CSV}`, "text/csv;charset=utf-8")
                          }
                        >
                          Download CSV sample
                        </button>
                        <button
                          type="button"
                          className="min-h-11 rounded-lg bg-white/10 px-4 text-sm"
                          onClick={() =>
                            downloadBlob("contacts-sample.xls", contactSampleSpreadsheet(), "application/vnd.ms-excel")
                          }
                        >
                          Download Excel sample
                        </button>
                      </div>
                      <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-brand-500/20 px-4 text-sm text-brand-400">
                        Upload filled file
                        <input
                          type="file"
                          accept=".csv,.txt,.tsv,.xls,text/csv,application/vnd.ms-excel"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) void onFile(file);
                          }}
                        />
                      </label>
                    </div>
                  ) : null}

                  {preview ? (
                    <div className="mt-4 rounded-xl border border-white/10 bg-ink-800 p-4 text-sm">
                      <p className="text-white">
                        {preview.length} contacts ready for {openGroup.name}
                      </p>
                      <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-slate-400">
                        {preview.slice(0, 20).map((r, i) => (
                          <li key={`${r.phone}-${i}`}>
                            {r.name} · {r.phone}
                          </li>
                        ))}
                        {preview.length > 20 ? <li>…and {preview.length - 20} more</li> : null}
                      </ul>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void importRows(preview)}
                          className="min-h-11 rounded-lg bg-brand-500 px-4 font-medium text-ink-950"
                        >
                          {busy ? "Adding…" : `Add ${preview.length} to group`}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreview(null)}
                          className="min-h-11 rounded-lg bg-white/10 px-4"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      <th className="w-12 px-4 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-500"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected && !allSelected;
                          }}
                          onChange={toggleAll}
                          disabled={members.length === 0}
                          aria-label="Select all"
                        />
                      </th>
                      <th className="px-2 py-3">Name</th>
                      <th className="px-2 py-3">Phone</th>
                      <th className="px-2 py-3">WhatsApp</th>
                      <th className="w-12 px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.contact.id} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-brand-500"
                            checked={selected.has(m.contact.id)}
                            onChange={() => toggleOne(m.contact.id)}
                            aria-label={`Select ${m.contact.name}`}
                          />
                        </td>
                        <td className="px-2 py-3 font-medium text-white">{m.contact.name}</td>
                        <td className="px-2 py-3 text-slate-300">{m.contact.phone}</td>
                        <td className="px-2 py-3">
                          <WhatsAppMark contact={m.contact} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={async () => {
                                setError("");
                                try {
                                  const res = await api<{
                                    success: true;
                                    data: { summary?: string | null; facts?: string[]; lastIntent?: string | null };
                                  }>(`/api/v1/ai/memories/${encodeURIComponent(m.contact.phone)}`).catch(() => null);
                                  setMemoryEdit({
                                    phone: m.contact.phone,
                                    name: m.contact.name,
                                    summary: res?.data?.summary || "",
                                    factsText: (res?.data?.facts || []).join("\n"),
                                    lastIntent: res?.data?.lastIntent || "",
                                  });
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : "Could not load memory");
                                }
                              }}
                              className="rounded-lg px-2 py-1 text-xs text-brand-300 hover:bg-white/10"
                            >
                              Memory
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeMember(m.contact.id)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-500/15 hover:text-rose-200"
                              aria-label={`Remove ${m.contact.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {members.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                          This group is empty. Tap Add, enter numbers, then select them and Verify WhatsApp.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-white/10 px-4 py-2">
                <ListPagination
                  meta={meta}
                  loading={membersLoading}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                />
              </div>
            </>
          )}
        </section>
      </div>

      {memoryEdit ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-ink-900 p-5 shadow-xl">
            <h3 className="text-base font-medium text-white">Caller memory · {memoryEdit.name}</h3>
            <p className="mb-3 text-xs text-slate-500">{memoryEdit.phone}</p>
            <textarea
              className="mb-2 min-h-20 w-full"
              placeholder="Summary"
              value={memoryEdit.summary}
              onChange={(e) => setMemoryEdit({ ...memoryEdit, summary: e.target.value })}
            />
            <textarea
              className="mb-2 min-h-16 w-full"
              placeholder="Facts (one per line)"
              value={memoryEdit.factsText}
              onChange={(e) => setMemoryEdit({ ...memoryEdit, factsText: e.target.value })}
            />
            <input
              className="mb-4 w-full"
              placeholder="Last intent (optional)"
              value={memoryEdit.lastIntent}
              onChange={(e) => setMemoryEdit({ ...memoryEdit, lastIntent: e.target.value })}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={memoryBusy}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm text-ink-950"
                onClick={async () => {
                  setMemoryBusy(true);
                  setError("");
                  try {
                    await api(`/api/v1/ai/memories/${encodeURIComponent(memoryEdit.phone)}`, {
                      method: "PUT",
                      body: JSON.stringify({
                        summary: memoryEdit.summary.trim() || null,
                        facts: memoryEdit.factsText
                          .split("\n")
                          .map((l) => l.trim())
                          .filter(Boolean),
                        lastIntent: memoryEdit.lastIntent.trim() || null,
                      }),
                    });
                    setNotice(`Memory saved for ${memoryEdit.name}.`);
                    setMemoryEdit(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not save memory");
                  } finally {
                    setMemoryBusy(false);
                  }
                }}
              >
                {memoryBusy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="rounded-lg bg-white/10 px-4 py-2 text-sm"
                onClick={() => setMemoryEdit(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ml-auto rounded-lg bg-rose-500/15 px-4 py-2 text-sm text-rose-200"
                onClick={async () => {
                  setMemoryBusy(true);
                  try {
                    await api(`/api/v1/ai/memories/${encodeURIComponent(memoryEdit.phone)}`, { method: "DELETE" });
                    setNotice("Memory cleared.");
                    setMemoryEdit(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not delete memory");
                  } finally {
                    setMemoryBusy(false);
                  }
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
