/** GoFarther AI — API Client */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE = 'https://isibi-backend.onrender.com/api/ghost';
const TOKEN_KEY = 'gofurther_token';
const INSTALLED_KEY = 'gofurther_installed';
const DEBUG_LOG_KEY = 'auth_debug_log';

/** Append a diagnostic line to the persistent auth debug log. Capped at 50 entries. */
export async function authLog(line: string) {
  try {
    const raw = await AsyncStorage.getItem(DEBUG_LOG_KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    const stamp = new Date().toISOString().slice(11, 19);
    arr.push(`${stamp} ${line}`);
    while (arr.length > 50) arr.shift();
    await AsyncStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(arr));
  } catch {}
}

export async function readAuthLog(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(DEBUG_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearAuthLog() {
  try { await AsyncStorage.removeItem(DEBUG_LOG_KEY); } catch {}
}

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
  // Sentinel check
  let sentinel: string | null = null;
  try { sentinel = await SecureStore.getItemAsync('gofurther_logged_out'); } catch {}
  if (sentinel) {
    authLog(`getToken: sentinel=SET → refusing token`);
    try { await SecureStore.deleteItemAsync(TOKEN_KEY); } catch {}
    try {
      const { setActiveUserId } = await import('./storage');
      await setActiveUserId(null);
    } catch {}
    return null;
  }

  const tok = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!tok) { authLog(`getToken: no token in SecureStore`); return null; }

  if (tok === 'LOGGED_OUT') {
    authLog(`getToken: token=LOGGED_OUT marker → refusing`);
    try { await SecureStore.deleteItemAsync(TOKEN_KEY); } catch {}
    return null;
  }

  const uid = userIdFromJwt(tok);
  const exp = expFromJwt(tok);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!uid || (exp !== null && exp < nowSec)) {
    authLog(`getToken: JWT invalid/expired uid=${uid} exp=${exp}`);
    try { await SecureStore.deleteItemAsync(TOKEN_KEY); } catch {}
    try {
      const { setActiveUserId } = await import('./storage');
      await setActiveUserId(null);
    } catch {}
    return null;
  }

  try {
    const stored = await AsyncStorage.getItem('active_user_id');
    if (!stored || stored !== uid) {
      authLog(`getToken: uid mismatch sub=${uid.slice(0,8)} stored=${stored ? stored.slice(0,8) : 'null'} → refusing`);
      try { await SecureStore.deleteItemAsync(TOKEN_KEY); } catch {}
      return null;
    }
  } catch {}

  authLog(`getToken: OK uid=${uid.slice(0,8)}`);

  // Keep the storage namespace in sync with the token holder (covers upgrade
  // from the pre-multi-account build where active_user_id didn't exist yet).
  try {
    const { setActiveUserId } = await import('./storage');
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const current = await AsyncStorage.getItem('active_user_id');
    if (current !== uid) {
      await setActiveUserId(uid);
    }
  } catch {}
  return tok;
}

async function setToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/** Decode a JWT payload without verifying the signature. */
function jwtPayload(token: string): any | null {
  try {
    const mid = token.split('.')[1];
    if (!mid) return null;
    const b64 = mid.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Decode the `sub` (user_id) claim out of a JWT without verifying the signature. */
function userIdFromJwt(token: string): string | null {
  const payload = jwtPayload(token);
  return payload && typeof payload.sub === 'string' ? payload.sub : null;
}

/** Decode the `exp` claim (epoch seconds) out of a JWT. */
function expFromJwt(token: string): number | null {
  const payload = jwtPayload(token);
  return payload && typeof payload.exp === 'number' ? payload.exp : null;
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
  await authLog(`acceptNewSession: uid=${userId ? userId.slice(0,8) : 'null'}`);
  if (userId) {
    try {
      const { setActiveUserId } = await import('./storage');
      await setActiveUserId(userId);
    } catch {}
  }
  await setToken(token);
  try { await SecureStore.deleteItemAsync('gofurther_logged_out'); } catch {}
  try { await AsyncStorage.removeItem('force_logout'); } catch {}
  await authLog('acceptNewSession: done');
}

export async function clearToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = await getToken();
  const headers: any = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Attach the active workspace id so connector lookups land in the
  // right workspace. Lazy-require workspaces.ts to avoid circular
  // imports with storage.ts. On pre-workspace installs this is a noop.
  try {
    const { getActiveWorkspaceIdSync, getActiveWorkspaceId } = require('./workspaces');
    let wsId: string | null = getActiveWorkspaceIdSync?.() ?? null;
    if (!wsId && typeof getActiveWorkspaceId === 'function') {
      wsId = await getActiveWorkspaceId();
    }
    if (wsId) headers['X-Workspace-Id'] = wsId;
  } catch {}

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

    // Email not verified — backend returns 403 with detail.requires_verification.
    // Return that to the UI so it can switch to the verify-email screen.
    if (res.status === 403 && data?.detail?.requires_verification) {
      return { requires_verification: true, email: data.detail.email };
    }

    if (!res.ok) {
      if (res.status === 401) {
        await clearToken();
        throw new Error('Session expired. Please log in again.');
      }
      throw new Error(typeof data.detail === 'string' ? data.detail : (data.detail?.message || `HTTP ${res.status}`));
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
  await authLog('logout: START');
  try { await SecureStore.setItemAsync(TOKEN_KEY, 'LOGGED_OUT'); await authLog('logout: wrote LOGGED_OUT marker'); } catch (e: any) { await authLog(`logout: marker ERR ${e?.message}`); }
  try { await SecureStore.deleteItemAsync(TOKEN_KEY); await authLog('logout: deleted token'); } catch (e: any) { await authLog(`logout: delete ERR ${e?.message}`); }
  try { await SecureStore.setItemAsync('gofurther_logged_out', String(Date.now())); await authLog('logout: wrote sentinel'); } catch (e: any) { await authLog(`logout: sentinel ERR ${e?.message}`); }
  try {
    const { setActiveUserId } = await import('./storage');
    await setActiveUserId(null);
    await authLog('logout: cleared active_user_id');
  } catch (e: any) { await authLog(`logout: clear uid ERR ${e?.message}`); }
  try { await AsyncStorage.setItem('force_logout', String(Date.now())); await authLog('logout: wrote force_logout'); } catch (e: any) { await authLog(`logout: force_logout ERR ${e?.message}`); }

  // Verify what's actually in storage right now
  try {
    const t = await SecureStore.getItemAsync(TOKEN_KEY);
    const s = await SecureStore.getItemAsync('gofurther_logged_out');
    const u = await AsyncStorage.getItem('active_user_id');
    await authLog(`logout: VERIFY token=${t ? (t === 'LOGGED_OUT' ? 'marker' : 'PRESENT!') : 'null'} sentinel=${s ? 'set' : 'null'} uid=${u || 'null'}`);
  } catch {}

  await new Promise(resolve => setTimeout(resolve, 200));
  revokeAllSessions().catch(() => {});
  await authLog('logout: DONE');
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

export async function startOAuth(appId: string): Promise<{ authorize_url: string; state: string }> {
  return apiFetch(`${CONNECTORS}/${encodeURIComponent(appId)}/oauth/start`, { method: 'POST' });
}

export async function connectorAction(appId: string, action: string, params: Record<string, any> = {}) {
  return apiFetch(`${CONNECTORS}/${encodeURIComponent(appId)}/action`, {
    method: 'POST',
    body: JSON.stringify({ action, params }),
  });
}

// ─── Push Notifications ────────────────────────────────────────────────

const PUSH = '/push';

export interface NotificationPrefs {
  enabled: boolean;
  plan_done: boolean;
  urgent_email: boolean;
  /** Firehose mode — push for EVERY incoming email, not just urgent. */
  notify_all_incoming: boolean;
  digest: boolean;
  quiet_start_min: number | null;
  quiet_end_min: number | null;
  timezone_name: string;
}

/** Register a fresh Expo push token with the backend so it can fan
 *  out notifications to this device. Called on app launch after
 *  expo-notifications returns a token, and again whenever the token
 *  rotates (Expo handles rotation for us). */
export async function registerDevicePushToken(
  deviceToken: string,
  meta: { platform?: string; device_name?: string; app_version?: string } = {},
): Promise<{ status: string }> {
  return apiFetch(`${PUSH}/register-device`, {
    method: 'POST',
    body: JSON.stringify({ device_token: deviceToken, ...meta }),
  });
}

/** Tell the backend to stop sending push notifications to this
 *  device. Called on logout so the next user who signs in on this
 *  phone doesn't get the previous account's notifications. */
export async function unregisterDevicePushToken(deviceToken: string): Promise<{ status: string }> {
  return apiFetch(`${PUSH}/unregister-device`, {
    method: 'POST',
    body: JSON.stringify({ device_token: deviceToken }),
  });
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  return apiFetch(`${PUSH}/prefs`);
}

export async function updateNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  return apiFetch(`${PUSH}/prefs`, {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

/** Ask the backend to send a test push to every device this user has
 *  registered. Used by the Settings screen's "Test notification" button. */
export async function sendTestPush(): Promise<{ sent: number; failed: number; tokens_tried: number }> {
  return apiFetch(`${PUSH}/test`, { method: 'POST' });
}

// ─── Morning Digest ────────────────────────────────────────────────────

const DIGEST = '/digest';

export interface DigestConfig {
  id?: string;
  user_id?: string;
  workspace_id: string;
  enabled: boolean;
  /** Minutes-from-midnight for the digest time. 480 = 08:00. */
  time_min: number;
  /** IANA timezone name, e.g. "America/New_York". */
  timezone_name: string;
  /** 7-char string of Y/- — day-of-week filter starting Monday. */
  days_of_week: string;
  inbox_summary: boolean;
  calendar_today: boolean;
  saved_notes: boolean;
  finance: boolean;
  spreadsheet_workbook: string | null;
  spreadsheet_column: string | null;
  custom_prompt: string | null;
  push_enabled: boolean;
  email_enabled: boolean;
  email_recipient: string | null;
  last_fired_at: string | null;
}

export async function getDigestConfig(): Promise<DigestConfig> {
  return apiFetch(`${DIGEST}/config`);
}

export async function updateDigestConfig(patch: Partial<DigestConfig>): Promise<DigestConfig> {
  return apiFetch(`${DIGEST}/config`, {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

/** Run the digest right now — used by the "Preview digest" button
 *  in Settings so users can see what their morning brief will look
 *  like without waiting for tomorrow. */
export async function runDigestNow(): Promise<{ headline: string; body_html: string; raw_sources: string[] }> {
  return apiFetch(`${DIGEST}/run-now`, { method: 'POST' });
}

// ─── Proactive Agents ─────────────────────────────────────────────────

const AGENTS = '/agents';

/** A trigger that wakes a proactive agent up. The shape varies by
 *  `kind` — only the fields relevant to that kind need to be set. */
export interface ServerAgentTrigger {
  kind: 'email_from' | 'email_keyword' | 'schedule';
  // email_from
  from_email?: string;
  // email_keyword
  subject_keyword?: string;
  // email_*
  app_id?: string;
  // Email-trigger actions. v1 supports only "auto_reply".
  actions?: string[];
  // schedule
  time_min?: number;        // minutes from midnight, e.g. 540 = 09:00
  days_of_week?: string;    // 7-char "YYYYY--" mask, Mon=index 0
  timezone_name?: string;   // IANA tz, e.g. "America/New_York"
}

export interface ServerAgent {
  id?: string;              // server uuid (only present after a sync)
  client_id: string;        // local agent id (stable across syncs)
  workspace_id?: string;
  name: string;
  role?: string;
  instructions?: string;
  triggers?: ServerAgentTrigger[];
  enabled?: boolean;
}

export async function listServerAgents(): Promise<ServerAgent[]> {
  const data = await apiFetch(`${AGENTS}`);
  return data.agents || [];
}

export async function upsertServerAgent(agent: ServerAgent): Promise<ServerAgent> {
  return apiFetch(`${AGENTS}`, {
    method: 'POST',
    body: JSON.stringify(agent),
  });
}

export async function deleteServerAgent(clientId: string): Promise<{ ok: boolean }> {
  return apiFetch(`${AGENTS}/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
}

export interface PrebuiltAgent {
  id: string;
  name: string;
  role: string;
  icon: string;
  color: string;
  description: string;
  requires: string[];
}

export async function listPrebuiltAgents(): Promise<PrebuiltAgent[]> {
  const data = await apiFetch(`${AGENTS}/prebuilt`);
  return data.agents || [];
}

export async function activatePrebuiltAgent(templateId: string): Promise<ServerAgent> {
  const data = await apiFetch(`${AGENTS}/prebuilt/${encodeURIComponent(templateId)}/activate`, {
    method: 'POST',
  });
  return data.agent;
}

/** Mirror the user's saved-contacts list (their relationship table —
 *  "my boss", "my mom", etc) to the backend so the agent trigger
 *  extractor can resolve labels to email addresses. */
export async function syncSavedContactsToServer(
  contacts: { label: string; name?: string; email?: string; phone?: string }[],
): Promise<{ ok: boolean; count: number }> {
  return apiFetch(`${AGENTS}/contacts/sync`, {
    method: 'POST',
    body: JSON.stringify({ contacts }),
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
