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
  const tok = await SecureStore.getItemAsync(TOKEN_KEY);
  // Keep the storage namespace in sync with the token holder. This covers:
  //   1) Cold starts after an upgrade from the pre-multi-account build
  //      (no `active_user_id` yet → derive from JWT and migrate).
  //   2) Any edge case where the two drifted apart.
  if (tok) {
    try {
      const { setActiveUserId } = await import('./storage');
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      const current = await AsyncStorage.getItem('active_user_id');
      const uid = userIdFromJwt(tok);
      if (uid && current !== uid) {
        await setActiveUserId(uid);
      }
    } catch {}
  }
  return tok;
}

async function setToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/** Decode the `sub` (user_id) claim out of a JWT without verifying the signature. */
function userIdFromJwt(token: string): string | null {
  try {
    const mid = token.split('.')[1];
    if (!mid) return null;
    // Base64-url → base64
    const b64 = mid.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    // atob exists in RN Hermes
    const json = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Install a newly-minted JWT and switch the local storage namespace to
 * this user's scope. Every subsequent save/load in storage.ts will read
 * and write from `u_<userId>_*` keys, so two accounts on the same device
 * each keep their own chats, agents, contacts, etc. — nothing is deleted
 * when switching, just re-scoped.
 */
async function acceptNewSession(token: string) {
  const userId = userIdFromJwt(token);
  if (userId) {
    try {
      const { setActiveUserId } = await import('./storage');
      await setActiveUserId(userId);
    } catch {}
  }
  await setToken(token);
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
  // Intentionally do NOT install the token here. The backend returns an
  // "unverified" token for compatibility, but until the user enters the
  // emailed code via verifyEmail() we must not grant access — otherwise
  // someone could sign up with a typo'd address and use the account.
  return data;
}

/**
 * Finish the signup flow by exchanging the email verification code for a
 * real access token. Called from the verify screen shown after signup().
 */
export async function verifyEmail(email: string, code: string) {
  const data = await apiFetch('/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });
  if (data.token) await acceptNewSession(data.token);
  return data;
}

/** Ask the backend to re-send the email verification code. */
export async function resendVerification(email: string) {
  return apiFetch('/resend', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function login(email: string, password: string, challengeId?: string, challengeAnswer?: string) {
  const body: any = { email, password };
  if (challengeId && challengeAnswer) {
    body.challenge_id = challengeId;
    body.challenge_answer = challengeAnswer;
  }

  // Use raw fetch to handle challenge responses (428) without throwing
  const token = await getToken();
  const headers: any = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(`${BASE}/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json();

    // Challenge required — return challenge data for the UI
    if ((res.status === 428 || res.status === 401) && data.requires_challenge) {
      return data;
    }

    if (!res.ok) {
      if (res.status === 401) {
        await clearToken();
        throw new Error('Session expired. Please log in again.');
      }
      throw new Error(data.detail || `HTTP ${res.status}`);
    }

    // If 2FA is required, return the temp_token for the 2FA step
    if (data.requires_2fa) return data;
    if (data.token) await acceptNewSession(data.token);
    return data;
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('Server is taking a moment. Please try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function login2FA(tempToken: string, code: string) {
  const data = await apiFetch('/2fa/login', {
    method: 'POST',
    body: JSON.stringify({ temp_token: tempToken, code }),
  });
  if (data.token) await acceptNewSession(data.token);
  return data;
}

export async function socialLogin(email: string, name: string, provider: 'apple' | 'google', token: string) {
  // Try the social-login endpoint first
  try {
    const data = await apiFetch('/social-login', {
      method: 'POST',
      body: JSON.stringify({ email, name, provider, social_token: token }),
    });
    if (data.token) await acceptNewSession(data.token);
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
      if (data.token) await acceptNewSession(data.token);
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
  try {
    // Revoke all server sessions so stolen tokens are invalidated
    await revokeAllSessions();
  } catch {
    // Don't block logout if server is unreachable
  }
  await clearToken();
  // Clear the active user pointer so `save`/`load` fall back to unscoped
  // mode until the next login. We intentionally do NOT delete this user's
  // namespaced data — if they log back in on this device, their chats,
  // agents, contacts, etc. should still be there.
  try {
    const { setActiveUserId } = await import('./storage');
    await setActiveUserId(null);
  } catch {
    // Best-effort
  }
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
  return apiFetch(`/usage?period=${encodeURIComponent(period)}`);
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
  return apiFetch(`/chat/sessions/${encodeURIComponent(sessionId)}/messages`);
}

// ─── App Connectors ─────────────────────────────────────────────────────

const CONNECTORS = '/connectors';

export async function getConnectors(): Promise<{ connectors: any[]; categories: string[] }> {
  return apiFetch(CONNECTORS);
}

export async function connectApp(appId: string, credentials: Record<string, string>) {
  return apiFetch(`${CONNECTORS}/${encodeURIComponent(appId)}/connect`, {
    method: 'POST',
    body: JSON.stringify({ credentials }),
  });
}

export async function disconnectApp(appId: string) {
  return apiFetch(`${CONNECTORS}/${encodeURIComponent(appId)}/disconnect`, { method: 'DELETE' });
}

export async function connectorAction(appId: string, action: string, params: Record<string, any> = {}) {
  return apiFetch(`${CONNECTORS}/${encodeURIComponent(appId)}/action`, {
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
  return apiFetch(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

export async function revokeAllSessions(): Promise<{ ok: boolean; revoked: number }> {
  return apiFetch('/sessions', { method: 'DELETE' });
}

// ─── Data Export (GDPR) ───────────────────────────────────────────────

export async function exportMyData() {
  return apiFetch('/export');
}

// ─── Geo-Blocking ────────────────────────────────────────────────────

export async function getGeoSettings(): Promise<{ enabled: boolean; allowed_countries: string[] }> {
  return apiFetch('/geo-settings');
}

export async function updateGeoSettings(enabled: boolean, allowedCountries: string[]) {
  return apiFetch('/geo-settings', {
    method: 'POST',
    body: JSON.stringify({ enabled, allowed_countries: allowedCountries }),
  });
}

// ─── E2E Encryption ──────────────────────────────────────────────────

export async function storeE2EKey(publicKey: string) {
  return apiFetch('/e2e/keys', {
    method: 'POST',
    body: JSON.stringify({ public_key: publicKey }),
  });
}

export async function getE2EKeyFromServer(): Promise<{ public_key: string | null }> {
  return apiFetch('/e2e/keys');
}

// ─── Billing / Subscriptions ─────────────────────────────────────────

export interface PlanInfo {
  id: string;
  name: string;
  price_cents: number | null;
  is_custom: boolean;
}

export interface UsageSnapshot {
  plan: string;
  plan_name: string;
  status: string;
  used_pct_5h: number;
  used_pct_week: number;
  unlimited_5h: boolean;
  unlimited_week: boolean;
  resets_in_seconds_5h: number;
  resets_in_seconds_week: number;
  cancel_at_period_end?: boolean;
  current_period_end?: string | null;
}

export async function getPlans(): Promise<{ plans: PlanInfo[] }> {
  return apiFetch('/billing/plans');
}

export async function getCurrentPlan(): Promise<UsageSnapshot> {
  return apiFetch('/billing/current');
}

export async function createCheckout(plan: string): Promise<{ checkout_url: string; session_id: string }> {
  return apiFetch('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });
}

export async function openBillingPortal(): Promise<{ portal_url: string }> {
  return apiFetch('/billing/portal', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ─── Device Check ────────────────────────────────────────────────────

export async function reportDevice(isRooted: boolean, deviceModel: string, osVersion: string) {
  return apiFetch('/device-check', {
    method: 'POST',
    body: JSON.stringify({ is_rooted: isRooted, device_model: deviceModel, os_version: osVersion }),
  });
}
