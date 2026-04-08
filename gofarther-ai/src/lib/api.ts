/** GoFarther AI — API Client */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE = 'https://isibi-backend.onrender.com/api/ghost';
const TOKEN_KEY = 'gofurther_token';
const INSTALLED_KEY = 'gofurther_installed';

/** Clear Keychain token on fresh install (Keychain survives app deletion, AsyncStorage does not) */
export async function clearTokenIfReinstalled() {
  const installed = await AsyncStorage.getItem(INSTALLED_KEY);
  if (!installed) {
    // Check if this is an existing user getting the update (has other AsyncStorage data)
    // vs a true fresh reinstall (AsyncStorage is completely empty)
    const hasExistingData = await AsyncStorage.getItem('onboarding_done');
    if (!hasExistingData) {
      // Fresh install — clear any leftover Keychain token
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
    await AsyncStorage.setItem(INSTALLED_KEY, '1');
  }
}

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers, signal: controller.signal });
    if (res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) {
      // Handle expired token
      if (res.status === 401) {
        await clearToken();
        throw new Error('Session expired. Please log in again.');
      }
      throw new Error(data.detail || `HTTP ${res.status}`);
    }
    return data;
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('Server is taking a moment. Please try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
  // If 2FA is required, return the temp_token for the 2FA step
  if (data.requires_2fa) return data;
  if (data.token) await setToken(data.token);
  return data;
}

export async function login2FA(tempToken: string, code: string) {
  const data = await apiFetch('/2fa/login', {
    method: 'POST',
    body: JSON.stringify({ temp_token: tempToken, code }),
  });
  if (data.token) await setToken(data.token);
  return data;
}

export async function socialLogin(email: string, name: string, provider: 'apple' | 'google', token: string) {
  // Try the social-login endpoint first
  try {
    const data = await apiFetch('/social-login', {
      method: 'POST',
      body: JSON.stringify({ email, name, provider, social_token: token }),
    });
    if (data.token) await setToken(data.token);
    return data;
  } catch (e: any) {
    // If social-login fails (endpoint missing or user doesn't exist), try signup
    // Generate a secure random password for social users (they'll never need it)
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    const hex = Array.from(new Uint8Array(randomBytes)).map(b => b.toString(16).padStart(2, '0')).join('');
    // Ensure password meets strength requirements (uppercase, lowercase, digit, special char)
    const securePw = 'Aa1!' + hex;

    try {
      const data = await apiFetch('/signup', {
        method: 'POST',
        body: JSON.stringify({ email, name, password: securePw }),
      });
      if (data.token) await setToken(data.token);
      return data;
    } catch (signupErr: any) {
      // Account exists but social-login failed — user needs to try email login
      if (signupErr.message?.includes('already')) {
        throw new Error('An account with this email already exists. Try logging in with your email and password.');
      }
      throw signupErr;
    }
  }
}

export async function forgotPassword(email: string) {
  return apiFetch('/forgot', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(email: string, code: string, newPassword: string) {
  return apiFetch('/reset', {
    method: 'POST',
    body: JSON.stringify({ email, code, new_password: newPassword }),
  });
}

export async function logout() {
  await clearToken();
}

export async function getMe() {
  return apiFetch('/me');
}

export async function getSmtpSettings() {
  return apiFetch('/smtp');
}

export async function deleteAccount() {
  return apiFetch('/account', { method: 'DELETE' });
}

export async function getUsage(period: string = '7d'): Promise<{
  total_messages: number; total_tokens_in: number; total_tokens_out: number;
  total_tokens: number; credits_remaining: number; plan: string;
  daily: { date: string; tokens_in: number; tokens_out: number; requests: number }[];
}> {
  return apiFetch(`/usage?period=${period}`);
}

export async function saveSmtpSettings(settings: { smtp_host?: string; smtp_port?: number; smtp_user?: string; smtp_pass?: string; smtp_from?: string }) {
  return apiFetch('/smtp', { method: 'POST', body: JSON.stringify(settings) });
}

export async function detectSmtp(email: string): Promise<{ host: string; port: number; provider: string }> {
  return apiFetch(`/detect-smtp/${encodeURIComponent(email)}`);
}

// ─── Chat Sync ─────────────────────────────────────────────────────────

export interface SyncSession {
  id: string;
  title: string;
  agent_id: string | null;
  pinned: boolean;
  tag?: string;
  created_at: number;
  updated_at: number;
}

export interface SyncMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  timestamp: number;
  reaction?: string | null;
}

export async function syncChat(sessions: SyncSession[], messages: SyncMessage[]) {
  return apiFetch('/chat/sync', {
    method: 'POST',
    body: JSON.stringify({ sessions, messages }),
  });
}

export async function getRemoteSessions(): Promise<{ sessions: SyncSession[] }> {
  return apiFetch('/chat/sessions');
}

export async function getRemoteMessages(sessionId: string): Promise<{ messages: SyncMessage[] }> {
  return apiFetch(`/chat/sessions/${sessionId}/messages`);
}

// ─── App Connectors ─────────────────────────────────────────────────────

const CONNECTORS = '/connectors';

export async function getConnectors(): Promise<{ connectors: any[]; categories: string[] }> {
  return apiFetch(CONNECTORS);
}

export async function connectApp(appId: string, credentials: Record<string, string>) {
  return apiFetch(`${CONNECTORS}/${appId}/connect`, {
    method: 'POST',
    body: JSON.stringify({ credentials }),
  });
}

export async function disconnectApp(appId: string) {
  return apiFetch(`${CONNECTORS}/${appId}/disconnect`, { method: 'DELETE' });
}

export async function connectorAction(appId: string, action: string, params: Record<string, any> = {}) {
  return apiFetch(`${CONNECTORS}/${appId}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, params }),
  });
}

// ─── Two-Factor Authentication ────────────────────────────────────────

export async function setup2FA(): Promise<{ secret: string; qr_url: string }> {
  return apiFetch('/2fa/setup', { method: 'POST' });
}

export async function verify2FA(code: string): Promise<{ message: string }> {
  return apiFetch('/2fa/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function disable2FA(code: string): Promise<{ message: string }> {
  return apiFetch('/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

// ─── Active Sessions ──────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  device_name: string;
  ip_address: string;
  created_at: string;
  last_active: string;
  is_current: boolean;
}

export async function getSessions(): Promise<SessionInfo[]> {
  return apiFetch('/sessions');
}

export async function revokeSession(sessionId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function revokeAllSessions(): Promise<{ ok: boolean; revoked: number }> {
  return apiFetch('/sessions', { method: 'DELETE' });
}

// ─── Data Export (GDPR) ───────────────────────────────────────────────

export async function exportMyData() {
  return apiFetch('/export');
}
