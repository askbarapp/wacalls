import { create } from "zustand";

export type Contact = {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
};

type ContactsState = {
  contacts: Contact[];
  add: (c: Omit<Contact, "id" | "createdAt" | "updatedAt">) => void;
  update: (id: string, c: Partial<Omit<Contact, "id" | "createdAt">>) => void;
  remove: (id: string) => void;
  toggleFavorite: (id: string) => void;
  search: (q: string) => Contact[];
};

const STORAGE_KEY = "wacalls:contacts";

const load = (): Contact[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
};

const persist = (contacts: Contact[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
};

export const useContacts = create<ContactsState>((set, get) => ({
  contacts: load(),
  add: (c) => {
    const now = Date.now();
    const contact: Contact = {
      ...c,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const next = [...get().contacts, contact];
    persist(next);
    set({ contacts: next });
  },
  update: (id, data) => {
    const next = get().contacts.map((c) =>
      c.id === id ? { ...c, ...data, updatedAt: Date.now() } : c,
    );
    persist(next);
    set({ contacts: next });
  },
  remove: (id) => {
    const next = get().contacts.filter((c) => c.id !== id);
    persist(next);
    set({ contacts: next });
  },
  toggleFavorite: (id) => {
    const next = get().contacts.map((c) =>
      c.id === id ? { ...c, favorite: !c.favorite, updatedAt: Date.now() } : c,
    );
    persist(next);
    set({ contacts: next });
  },
  search: (q) => {
    const lower = q.toLowerCase();
    return get().contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(lower) ||
        c.phone.includes(lower) ||
        c.email.toLowerCase().includes(lower),
    );
  },
}));
