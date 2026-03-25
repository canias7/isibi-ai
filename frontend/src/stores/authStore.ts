import { create } from "zustand";

interface AuthState {
  token: string | null;
  user: Record<string, unknown> | null;
  setAuth: (token: string, user: Record<string, unknown>) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("token"),
  user: null,
  setAuth: (token, user) => {
    localStorage.setItem("token", token);
    set({ token, user });
  },
  clearAuth: () => {
    localStorage.removeItem("token");
    set({ token: null, user: null });
  },
}));
