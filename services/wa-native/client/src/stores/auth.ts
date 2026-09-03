import { create } from "zustand";

interface User {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

const TOKEN_KEY = "wacalls.token";

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem(TOKEN_KEY),
  isLoading: false,

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "login failed" }));
        throw new Error(err.error);
      }
      const { user, token } = await res.json();
      localStorage.setItem(TOKEN_KEY, token);
      set({ user, token, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },

  register: async (email, password, name) => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "register failed" }));
        throw new Error(err.error);
      }
      const { user, token } = await res.json();
      localStorage.setItem(TOKEN_KEY, token);
      set({ user, token, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ user: null, token: null });
  },

  checkAuth: async () => {
    const token = get().token;
    if (!token) return;
    set({ isLoading: true });
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        localStorage.removeItem(TOKEN_KEY);
        set({ user: null, token: null, isLoading: false });
        return;
      }
      const user = await res.json();
      set({ user, isLoading: false });
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      set({ user: null, token: null, isLoading: false });
    }
  },
}));

export const getAuthToken = (): string | null => localStorage.getItem(TOKEN_KEY);
