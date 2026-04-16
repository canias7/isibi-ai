import { create } from "zustand";

export interface AuthUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  account_type: "user" | "developer";
  email_verified: boolean;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
}

function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validate required fields exist
    if (parsed && typeof parsed.id === "string" && typeof parsed.email === "string") {
      return parsed as AuthUser;
    }
    localStorage.removeItem("user");
    return null;
  } catch {
    localStorage.removeItem("user");
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("token"),
  user: loadUser(),
  isAuthenticated: !!localStorage.getItem("token"),
  setAuth: (token, user) => {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
  },
  clearAuth: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    set({ token: null, user: null, isAuthenticated: false });
  },
}));
