import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore, type AuthUser } from "./authStore";

const mockUser: AuthUser = {
  id: "test-123",
  email: "test@example.com",
  first_name: "Test",
  last_name: "User",
  account_type: "developer",
  email_verified: true,
};

describe("authStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      token: null,
      user: null,
      isAuthenticated: false,
    });
  });

  it("starts unauthenticated when no token in localStorage", () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
  });

  it("setAuth stores token and user", () => {
    useAuthStore.getState().setAuth("jwt-token-123", mockUser);

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe("jwt-token-123");
    expect(state.user).toEqual(mockUser);
    expect(localStorage.getItem("token")).toBe("jwt-token-123");
    expect(JSON.parse(localStorage.getItem("user")!)).toEqual(mockUser);
  });

  it("clearAuth removes token and user", () => {
    useAuthStore.getState().setAuth("jwt-token-123", mockUser);
    useAuthStore.getState().clearAuth();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  });

  it("user has correct account_type", () => {
    useAuthStore.getState().setAuth("token", mockUser);
    expect(useAuthStore.getState().user?.account_type).toBe("developer");
  });
});
