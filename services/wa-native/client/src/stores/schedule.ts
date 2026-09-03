import { create } from "zustand";

export type ScheduledCall = {
  id: string;
  contactId: string;
  contactName: string;
  phone: string;
  scheduledAt: number;
  duration: number;
  notes: string;
  status: "pending" | "completed" | "cancelled";
  createdAt: number;
};

type ScheduleState = {
  calls: ScheduledCall[];
  add: (c: Omit<ScheduledCall, "id" | "createdAt">) => void;
  update: (id: string, data: Partial<Omit<ScheduledCall, "id" | "createdAt">>) => void;
  remove: (id: string) => void;
  getByDate: (date: string) => ScheduledCall[];
  getUpcoming: () => ScheduledCall[];
};

const STORAGE_KEY = "wacalls:schedule";

const load = (): ScheduledCall[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
};

const persist = (calls: ScheduledCall[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(calls));
};

export const useSchedule = create<ScheduleState>((set, get) => ({
  calls: load(),
  add: (c) => {
    const call: ScheduledCall = {
      ...c,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    const next = [...get().calls, call];
    persist(next);
    set({ calls: next });
  },
  update: (id, data) => {
    const next = get().calls.map((c) => (c.id === id ? { ...c, ...data } : c));
    persist(next);
    set({ calls: next });
  },
  remove: (id) => {
    const next = get().calls.filter((c) => c.id !== id);
    persist(next);
    set({ calls: next });
  },
  getByDate: (date) => {
    const day = new Date(date).toDateString();
    return get().calls.filter((c) => new Date(c.scheduledAt).toDateString() === day);
  },
  getUpcoming: () => {
    const now = Date.now();
    return get()
      .calls.filter((c) => c.status === "pending" && c.scheduledAt >= now)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
  },
}));
