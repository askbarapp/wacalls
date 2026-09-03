import { create } from "zustand";

export type CallNote = {
  callId: string;
  contactName: string;
  phone: string;
  duration: number;
  rating: number;
  notes: string;
  tags: string[];
  createdAt: number;
};

type NotesState = {
  notes: CallNote[];
  add: (n: Omit<CallNote, "createdAt">) => void;
  update: (callId: string, data: Partial<Omit<CallNote, "callId" | "createdAt">>) => void;
  remove: (callId: string) => void;
  getByCall: (callId: string) => CallNote | undefined;
};

const STORAGE_KEY = "wacalls:notes";

const load = (): CallNote[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
};

const persist = (notes: CallNote[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
};

export const useNotes = create<NotesState>((set, get) => ({
  notes: load(),
  add: (n) => {
    const note: CallNote = { ...n, createdAt: Date.now() };
    const next = [...get().notes, note];
    persist(next);
    set({ notes: next });
  },
  update: (callId, data) => {
    const next = get().notes.map((n) => (n.callId === callId ? { ...n, ...data } : n));
    persist(next);
    set({ notes: next });
  },
  remove: (callId) => {
    const next = get().notes.filter((n) => n.callId !== callId);
    persist(next);
    set({ notes: next });
  },
  getByCall: (callId) => get().notes.find((n) => n.callId === callId),
}));
