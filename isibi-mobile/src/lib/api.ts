import * as SecureStore from "expo-secure-store";

export const API_BASE = "https://isibi-backend.onrender.com";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description?: string;
  spec?: any;
  created_at?: string;
  updated_at?: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: any;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync("auth_token");
}

export async function saveToken(token: string) {
  await SecureStore.setItemAsync("auth_token", token);
}

export async function clearToken() {
  await SecureStore.deleteItemAsync("auth_token");
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }
  // DELETE returns 204 with no body
  if (res.status === 204) return null;
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, turnstile_token: "mobile" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Login failed" }));
    throw new Error(err.detail ?? "Login failed");
  }
  const data = await res.json();
  if (data.access_token) await saveToken(data.access_token);
  return data;
}

export async function logout() {
  await clearToken();
}

// ── Projects (user's apps) ───────────────────────────────────────────────────

export async function getMyProjects(): Promise<Project[]> {
  return apiFetch("/api/projects");
}

export async function getProjectSpec(projectId: string): Promise<any> {
  return apiFetch(`/api/projects/${projectId}`);
}

// ── App Data (for the connected app) ─────────────────────────────────────────

export async function listRecords(projectId: string, table: string) {
  return apiFetch(`/api/apps/${projectId}/data/${table}`);
}

export async function createRecord(projectId: string, table: string, data: any) {
  return apiFetch(`/api/apps/${projectId}/data/${table}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateRecord(projectId: string, table: string, id: string, data: any) {
  return apiFetch(`/api/apps/${projectId}/data/${table}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteRecord(projectId: string, table: string, id: string) {
  return apiFetch(`/api/apps/${projectId}/data/${table}/${id}`, {
    method: "DELETE",
  });
}

export async function countRecords(projectId: string, table: string): Promise<number> {
  const data = await listRecords(projectId, table);
  return Array.isArray(data) ? data.length : (data?.rows?.length ?? 0);
}

// ── Scheduled Commands ───────────────────────────────────────────────────────

export async function createScheduledCommand(projectId: string, data: {
  command: string;
  schedule_type: string;
  schedule_time: string;
  schedule_day?: string;
  timezone?: string;
}) {
  return apiFetch(`/api/apps/${projectId}/scheduled-commands`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function listScheduledCommands(projectId: string) {
  return apiFetch(`/api/apps/${projectId}/scheduled-commands`);
}

export async function deleteScheduledCommand(projectId: string, commandId: string) {
  return apiFetch(`/api/apps/${projectId}/scheduled-commands/${commandId}`, {
    method: "DELETE",
  });
}

// ── AI Voice Command ──────────────────────────────────────────────────────────

export async function aiCommand(
  projectId: string,
  text: string
): Promise<{ message: string; action?: string; data?: any[] }> {
  return apiFetch(`/api/apps/${projectId}/ai/command`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

// ── App Schema ───────────────────────────────────────────────────────────────

export async function getAppSchema(projectId: string) {
  return apiFetch(`/api/apps/${projectId}/schema`);
}
