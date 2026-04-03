/** GoFarther AI — API Client */

import * as SecureStore from 'expo-secure-store';

const BASE = 'https://isibi-backend.onrender.com/api/ghost';
const TOKEN_KEY = 'gofurther_token';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function setToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = await getToken();
  const headers: any = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

export async function signup(email: string, name: string, password: string) {
  const data = await apiFetch('/signup', {
    method: 'POST',
    body: JSON.stringify({ email, name, password }),
  });
  if (data.token) await setToken(data.token);
  return data;
}

export async function login(email: string, password: string) {
  const data = await apiFetch('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (data.token) await setToken(data.token);
  return data;
}

export async function logout() {
  await clearToken();
}

export async function getMe() {
  return apiFetch('/me');
}
