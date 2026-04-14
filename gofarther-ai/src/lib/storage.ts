/** GoFarther AI — Local Storage
 *
 * Multi-account support: every user-specific key is transparently prefixed
 * with `u_<userId>_` so multiple accounts on the same device keep their own
 * chats, agents, contacts, etc. and neither leaks nor clobbers the other.
 *
 * The prefix is applied by `save`/`load`/`remove` based on the currently
 * active user_id (JWT `sub` claim). A small allowlist of truly device-wide
 * keys (theme, language, the active_user_id pointer itself) bypass the
 * scoping.
 *
 * On logout we simply clear the active user pointer — we do NOT delete the
 * data, so when that account logs back in their chats and agents return.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Keys that are device-wide and must NOT be namespaced per user.
const DEVICE_KEYS = new Set<string>([
  'theme_mode',
  'app_language',
  'active_user_id',
  'storage_migrated_v2',
]);

// Keys that are user-scoped but NOT workspace-scoped — they stay
// shared across every workspace the user owns. Billing, nickname,
// and the workspace list itself all live here. Everything else gets
// workspace-prefixed too, INCLUDING connected_apps as of Phase 2:
// the backend now stores connector creds under (user, workspace, app)
// so the cached list of "which apps are connected" must match the
// workspace that's active.
const USER_ONLY_KEYS = new Set<string>([
  'active_workspace_id',
  'workspace_list',
  'ws_migrated_v1',
  'user_nickname',
  'active_user_id',
]);

// Known user-scoped keys — used for the one-time legacy migration below.
// New keys added to this file don't need to be added here, they get
// scoped automatically via save/load. This list is purely for migrating
// pre-multi-account installs where keys were stored unscoped.
const LEGACY_USER_KEYS = [
  'chat_sessions',
  'agents',
  'email_templates',
  'sms_templates',
  'scheduled_tasks',
  'ai_memory',
  'custom_instructions',
  'learned_preferences',
  'saved_contacts',
  'connected_apps',
  'call_recordings',
  'offline_queue',
  'selected_voice',
  'ai_name',
  'user_nickname',
];

// Module-level cache for the active user_id so save/load don't have to
// hit AsyncStorage on every call. `undefined` = not hydrated yet.
let _activeUserId: string | null | undefined = undefined;

async function getActiveUserId(): Promise<string | null> {
  if (_activeUserId !== undefined) return _activeUserId;
  try {
    _activeUserId = await AsyncStorage.getItem('active_user_id');
  } catch {
    _activeUserId = null;
  }
  return _activeUserId;
}

/**
 * Apply a `u_<userId>_w_<workspaceId>_` prefix to a storage key so
 * different accounts — and different workspaces within the same
 * account — get independent namespaces.
 *
 * Scoping levels:
 *  - DEVICE_KEYS               → unchanged (theme, language, active_user_id)
 *  - USER_ONLY_KEYS            → u_<userId>_<key>            (shared across workspaces)
 *  - everything else           → u_<userId>_w_<ws>_<key>     (per-workspace)
 *
 * If no user is active (pre-login or mid-logout), returns null. Callers
 * then fail closed — reads return the fallback, writes become no-ops.
 */
async function scopedKey(key: string): Promise<string | null> {
  if (DEVICE_KEYS.has(key)) return key;
  // Keys that are already fully prefixed (u_..._w_..._foo) pass through
  if (key.startsWith('u_')) return key;
  const uid = await getActiveUserId();
  if (!uid) return null;
  // User-only keys (shared across workspaces) get the user prefix only
  if (USER_ONLY_KEYS.has(key)) return `u_${uid}_${key}`;
  // Everything else gets user + workspace. Workspace id is loaded
  // lazily from AsyncStorage the first time and cached thereafter.
  const ws = await _getActiveWorkspaceIdLazy(uid);
  if (!ws) {
    // No workspace yet (pre-ensureDefaultWorkspace) — fall back to
    // user-only scope so first-launch reads still work and the
    // migration helper in workspaces.ts can find the legacy keys.
    return `u_${uid}_${key}`;
  }
  return `u_${uid}_w_${ws}_${key}`;
}

// Lazy workspace-id cache keyed by user so switching accounts doesn't
// leak the previous account's workspace into the new one.
let _wsCache: { userId: string; workspaceId: string | null } | null = null;

async function _getActiveWorkspaceIdLazy(userId: string): Promise<string | null> {
  if (_wsCache && _wsCache.userId === userId) return _wsCache.workspaceId;
  try {
    const raw = await AsyncStorage.getItem(`u_${userId}_active_workspace_id`);
    _wsCache = { userId, workspaceId: raw };
    return raw;
  } catch {
    _wsCache = { userId, workspaceId: null };
    return null;
  }
}

/** Clear the in-memory workspace cache. Called by workspaces.ts after
 *  setActiveWorkspaceId so subsequent save/load hit the new workspace. */
export function invalidateWorkspaceCache() {
  _wsCache = null;
}

export async function save(key: string, data: any) {
  const k = await scopedKey(key);
  if (k === null) return; // No active user → drop the write
  await AsyncStorage.setItem(k, JSON.stringify(data));
}

export async function load<T>(key: string, fallback: T): Promise<T> {
  const k = await scopedKey(key);
  if (k === null) return fallback; // No active user → return fallback
  const raw = await AsyncStorage.getItem(k);
  return raw ? JSON.parse(raw) : fallback;
}

export async function remove(key: string) {
  const k = await scopedKey(key);
  if (k === null) return;
  await AsyncStorage.removeItem(k);
}

/**
 * Install or clear the active account for the current device.
 *
 * - Pass a user_id after a successful login: subsequent save/load calls
 *   will read and write from that user's namespace.
 * - Pass null on logout: save/load fall back to unscoped keys (which
 *   should not be touched until the next login).
 *
 * The first time a user logs in after upgrading from the pre-multi-account
 * build, we migrate any legacy unscoped keys into their namespace so they
 * don't lose their existing chats/agents.
 */
export async function setActiveUserId(userId: string | null) {
  _activeUserId = userId;
  // Invalidate the workspace cache so the newly-active account doesn't
  // accidentally inherit the previous account's workspace id when it
  // reads its first storage key.
  _wsCache = null;
  try {
    if (userId) {
      await AsyncStorage.setItem('active_user_id', userId);
      await _migrateLegacyKeysIfNeeded(userId);
    } else {
      await AsyncStorage.removeItem('active_user_id');
    }
  } catch {
    // Best-effort — the in-memory cache is still set above
  }
}

async function _migrateLegacyKeysIfNeeded(userId: string) {
  try {
    const alreadyMigrated = await AsyncStorage.getItem('storage_migrated_v2');
    if (alreadyMigrated) return;

    const allKeys = await AsyncStorage.getAllKeys();
    const toMigrate: string[] = [];

    for (const k of allKeys) {
      if (DEVICE_KEYS.has(k)) continue;
      if (k.startsWith('u_')) continue;
      if (LEGACY_USER_KEYS.includes(k) || k.startsWith('chat_')) {
        toMigrate.push(k);
      }
    }

    if (toMigrate.length > 0) {
      const pairs = await AsyncStorage.multiGet(toMigrate);
      const writes: [string, string][] = [];
      for (const [k, v] of pairs) {
        if (v !== null) writes.push([`u_${userId}_${k}`, v]);
      }
      if (writes.length > 0) await AsyncStorage.multiSet(writes);
      await AsyncStorage.multiRemove(toMigrate);
    }

    await AsyncStorage.setItem('storage_migrated_v2', '1');
  } catch {
    // Best-effort — if migration fails the app still works, worst case
    // the upgrading user just starts with empty local caches
  }
}

/**
 * Delete every AsyncStorage key belonging to the currently active user.
 * Used for "delete my data" flows — NOT called on logout (we preserve
 * data across logout/login cycles so accounts can coexist).
 */
export async function clearLocalUserData() {
  try {
    const uid = await getActiveUserId();
    if (!uid) return;
    const allKeys = await AsyncStorage.getAllKeys();
    const prefix = `u_${uid}_`;
    const mine = allKeys.filter(k => k.startsWith(prefix));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    // Best-effort
  }
}

// Agent storage
//
// Agents are now BOTH stored locally (so the chat UI works offline /
// before the first sync) AND synced to the backend (so the proactive
// trigger poller can see them). The local copy is the source of truth
// for chat metadata; the backend copy is the source of truth for
// trigger configuration. saveAgents() pushes every modified agent up
// in the background — failures are logged but don't block the UI.

/** A trigger that wakes a proactive agent up from the backend poller.
 *  The shape varies by `kind` — only the fields relevant to that kind
 *  need to be set. */
export interface AgentTrigger {
  kind: 'email_from' | 'email_keyword' | 'schedule';
  from_email?: string;
  subject_keyword?: string;
  app_id?: string;
  time_min?: number;
  days_of_week?: string;
  timezone_name?: string;
}

export interface Agent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  instructions: string;
  isActive: boolean;
  color: string;
  triggers?: AgentTrigger[];
}

export async function getAgents(): Promise<Agent[]> {
  return load('agents', []);
}

export async function saveAgents(agents: Agent[]) {
  await save('agents', agents);
  // Sync to backend — await so triggers get extracted and written back
  // before the caller re-reads. Takes ~3-5s due to Claude extraction.
  try {
    await syncAgentsToBackend(agents);
  } catch (err) {
    console.warn('[agents] backend sync failed', err);
  }
}

/** Push every local agent to the backend. Used by saveAgents() above
 *  and by the one-time migration on first sync. The backend
 *  auto-extracts triggers from the system prompt — we deliberately
 *  send `triggers: []` so the extraction always runs on the freshest
 *  prompt instead of re-using whatever the client cached. The server's
 *  response includes the extracted triggers, which we write back into
 *  the local agent record so the UI can display them as "Detected
 *  triggers". */
async function syncAgentsToBackend(agents: Agent[]): Promise<void> {
  try {
    const { upsertServerAgent } = await import('./api');
    let mutated = false;
    for (const a of agents) {
      try {
        // Load contacts and pass them inline so the backend can
        // resolve labels like "my boss" in one round-trip
        let inlineContacts: any[] | undefined;
        try {
          const local = await getSavedContacts();
          if (local.length > 0) {
            inlineContacts = local.map(c => ({
              label: c.label, name: c.name, email: c.email, phone: c.phone,
            }));
          }
        } catch {}
        const resp = await upsertServerAgent({
          client_id: a.id,
          name: a.name,
          role: a.role,
          instructions: a.instructions,
          triggers: [],
          enabled: a.isActive,
          ...(inlineContacts ? { saved_contacts: inlineContacts } : {}),
        } as any);
        const extracted = (resp?.triggers || []) as AgentTrigger[];
        const before = JSON.stringify(a.triggers || []);
        const after = JSON.stringify(extracted);
        if (before !== after) {
          a.triggers = extracted;
          mutated = true;
        }
        // Stash debug info for the UI
        (a as any)._debug = (resp as any)?._debug;
      } catch (e) {
        console.warn('[agents] upsert failed for', a.id, e);
      }
    }
    if (mutated) {
      // Persist the freshly-extracted triggers locally so the next
      // open of the edit screen renders them without another network
      // round-trip. We use save() directly (not saveAgents) to avoid
      // re-triggering this sync recursively.
      await save('agents', agents);
    }
  } catch (e) {
    // api module failed to import — offline or auth missing
  }
}

/** Delete an agent both locally and on the backend. The local delete
 *  must come first so the UI updates immediately. */
export async function deleteAgent(agentId: string): Promise<void> {
  const agents = await getAgents();
  const next = agents.filter(a => a.id !== agentId);
  await save('agents', next);
  try {
    const { deleteServerAgent } = await import('./api');
    await deleteServerAgent(agentId).catch(() => {});
  } catch {}
}

// Chat history
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  reaction?: 'up' | 'down';
}

export async function getChatHistory(sessionId: string): Promise<ChatMessage[]> {
  return load(`chat_${sessionId}`, []);
}

export async function saveChatHistory(sessionId: string, messages: ChatMessage[]) {
  await save(`chat_${sessionId}`, messages.slice(-50)); // Keep last 50
}

// Chat sessions — each is a conversation thread shown in the sidebar
export interface ChatSession {
  id: string;
  title: string;      // First user message or "New Chat"
  createdAt: number;
  agentId: string | null;
  pinned?: boolean;
  tag?: string;        // e.g. "Work", "Personal", "School"
}

export async function getChatSessions(): Promise<ChatSession[]> {
  return load('chat_sessions', []);
}

export async function saveChatSessions(sessions: ChatSession[]) {
  await save('chat_sessions', sessions.slice(0, 50)); // Keep last 50
}

export async function pinChatSession(sessionId: string, pinned: boolean) {
  const sessions = await getChatSessions();
  await saveChatSessions(sessions.map(s => s.id === sessionId ? { ...s, pinned } : s));
}

export async function tagChatSession(sessionId: string, tag: string | undefined) {
  const sessions = await getChatSessions();
  await saveChatSessions(sessions.map(s => s.id === sessionId ? { ...s, tag } : s));
}

export async function searchAllChats(query: string): Promise<{ session: ChatSession; matchedMessage?: string }[]> {
  const q = query.toLowerCase();
  const sessions = await getChatSessions();
  const results: { session: ChatSession; matchedMessage?: string }[] = [];
  for (const session of sessions) {
    // Check title match
    if (session.title.toLowerCase().includes(q)) {
      results.push({ session });
      continue;
    }
    // Check message content match
    const msgs = await getChatHistory(session.id);
    const match = msgs.find(m => m.content.toLowerCase().includes(q));
    if (match) {
      // Extract snippet around the match
      const idx = match.content.toLowerCase().indexOf(q);
      const start = Math.max(0, idx - 30);
      const end = Math.min(match.content.length, idx + query.length + 30);
      const snippet = (start > 0 ? '...' : '') + match.content.slice(start, end) + (end < match.content.length ? '...' : '');
      results.push({ session, matchedMessage: snippet });
    }
  }
  return results;
}

export async function deleteChatSession(sessionId: string) {
  const sessions = await getChatSessions();
  await saveChatSessions(sessions.filter(s => s.id !== sessionId));
  await remove(`chat_${sessionId}`);
}

// Email templates
export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export async function getTemplates(): Promise<EmailTemplate[]> {
  return load('email_templates', []);
}

export async function saveTemplates(templates: EmailTemplate[]) {
  await save('email_templates', templates);
}

// SMS templates
export interface SMSTemplate {
  id: string;
  name: string;
  body: string;
}

export async function getSMSTemplates(): Promise<SMSTemplate[]> {
  return load('sms_templates', []);
}

export async function saveSMSTemplates(templates: SMSTemplate[]) {
  await save('sms_templates', templates);
}

// Scheduled tasks
export interface ScheduledTask {
  id: string;
  agentId: string;
  command: string;
  schedule: string;
  label: string;
  enabled: boolean;
}

const BACKEND_BASE = 'https://isibi-backend.onrender.com';
const SCHED_URL = `${BACKEND_BASE}/api/ghost/scheduled-tasks`;

export async function getScheduledTasks(): Promise<ScheduledTask[]> {
  return load('scheduled_tasks', []);
}

/** Save locally AND sync to backend so the server-side scheduler can fire them. */
export async function saveScheduledTasks(tasks: ScheduledTask[]) {
  await save('scheduled_tasks', tasks);
  // Fire-and-forget sync — if it fails the local copy is still correct
  syncScheduledTasksToBackend(tasks).catch(() => {});
}

/** Push the current task list to the backend. Enriches with agent details. */
export async function syncScheduledTasksToBackend(tasks: ScheduledTask[]): Promise<boolean> {
  try {
    const { getToken } = await import('./api');
    const token = await getToken();
    if (!token) return false;

    // Pull agents so we can send the system prompt with each task
    const agents = await getAgents();
    const agentMap = new Map(agents.map(a => [a.id, a]));

    let deviceTz = 'UTC';
    try {
      deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {}

    const payload = {
      tasks: tasks.map(t => {
        const agent = agentMap.get(t.agentId);
        return {
          client_id: t.id,
          label: t.label,
          command: t.command,
          schedule: t.schedule,
          timezone: deviceTz,
          enabled: t.enabled,
          agent_id: t.agentId || null,
          agent_name: agent?.name || null,
          agent_system_prompt: agent?.instructions || null,
        };
      }),
    };

    const res = await fetch(`${SCHED_URL}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Trigger a task immediately for testing. */
export async function runScheduledTaskNow(clientId: string): Promise<{ ok: boolean; result?: string; error?: string }> {
  try {
    const { getToken } = await import('./api');
    const token = await getToken();
    if (!token) return { ok: false, error: 'Not logged in' };

    const res = await fetch(`${SCHED_URL}/${encodeURIComponent(clientId)}/run-now`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: txt || `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, result: data.result };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Request failed' };
  }
}

// AI Name (what the user calls their AI — like "Hey Chris")
export async function getAIName(): Promise<string> {
  return load('ai_name', 'GoFarther');
}

export async function saveAIName(name: string) {
  await save('ai_name', name);
}

export async function getUserNickname(): Promise<string> {
  return load('user_nickname', '');
}

export async function saveUserNickname(name: string) {
  await save('user_nickname', name);
}

// Selected voice
export async function getSelectedVoice(): Promise<string | null> {
  return load('selected_voice', null);
}

export async function saveSelectedVoice(voiceId: string) {
  await save('selected_voice', voiceId);
}

// Memory — AI remembers facts across chats
export interface MemoryFact {
  id: string;
  fact: string;
  createdAt: number;
}

export async function getMemory(): Promise<MemoryFact[]> {
  return load('ai_memory', []);
}

export async function addMemoryFact(fact: string) {
  const mem = await getMemory();
  mem.push({ id: Date.now().toString(), fact, createdAt: Date.now() });
  await save('ai_memory', mem.slice(-100)); // Keep last 100 facts
}

export async function clearMemory() {
  await save('ai_memory', []);
}

// Custom instructions — global system prompt
export async function getCustomInstructions(): Promise<string> {
  return load('custom_instructions', '');
}

export async function saveCustomInstructions(instructions: string) {
  await save('custom_instructions', instructions);
}

// Learned preferences — auto-extracted from thumbs up/down reactions
export interface LearnedPreference {
  id: string;
  rule: string;
  confidence: number;
  createdAt: number;
}

export async function getLearnedPreferences(): Promise<LearnedPreference[]> {
  return load('learned_preferences', []);
}

export async function saveLearnedPreferences(prefs: LearnedPreference[]) {
  await save('learned_preferences', prefs.slice(0, 20)); // Cap at 20
}

export async function deleteLearnedPreference(id: string) {
  const prefs = await getLearnedPreferences();
  await saveLearnedPreferences(prefs.filter(p => p.id !== id));
}

export async function getReactionCount(): Promise<number> {
  return load('reaction_count_since_analysis', 0);
}

export async function incrementReactionCount() {
  const count = await getReactionCount();
  await save('reaction_count_since_analysis', count + 1);
}

export async function resetReactionCount() {
  await save('reaction_count_since_analysis', 0);
}

// Theme preference
export async function getThemeMode(): Promise<'light' | 'dark'> {
  return load('theme_mode', 'light');
}

export async function saveThemeMode(mode: 'light' | 'dark') {
  await save('theme_mode', mode);
}

// Onboarding completed
export async function hasCompletedOnboarding(): Promise<boolean> {
  return load('onboarding_done', false);
}

export async function setOnboardingComplete() {
  await save('onboarding_done', true);
}

// Rename chat session
export async function renameChatSession(sessionId: string, newTitle: string) {
  const sessions = await getChatSessions();
  await saveChatSessions(sessions.map(s => s.id === sessionId ? { ...s, title: newTitle } : s));
}

// Analytics — simple event tracking (uses same key as analytics.ts)
export async function trackEvent(event: string) {
  const events: { event: string; ts: number }[] = await load('analytics_events', []);
  events.push({ event, ts: Date.now() });
  await save('analytics_events', events.slice(-500));
}

// Language preference
export async function getLanguage(): Promise<string> {
  return load('app_language', 'en');
}

export async function saveLanguage(lang: string) {
  await save('app_language', lang);
}

// Biometric lock
export async function getBiometricEnabled(): Promise<boolean> {
  return load('biometric_lock', false);
}

export async function saveBiometricEnabled(enabled: boolean) {
  await save('biometric_lock', enabled);
}

// Saved contacts — "my boss", "my mom", etc.
export interface SavedContact {
  id: string;
  label: string;   // e.g. "My boss", "Mom"
  name: string;     // e.g. "John Smith"
  email?: string;
  phone?: string;
}

export async function getSavedContacts(): Promise<SavedContact[]> {
  return load('saved_contacts', []);
}

export async function saveSavedContacts(contacts: SavedContact[]) {
  await save('saved_contacts', contacts);
  // Fire-and-forget mirror to the backend so the agent extractor can
  // resolve "my boss" → an actual email address. Failures are logged
  // and don't block the UI.
  syncSavedContactsToBackend(contacts).catch(err => {
    console.warn('[contacts] backend sync failed', err);
  });
}

async function syncSavedContactsToBackend(contacts: SavedContact[]): Promise<void> {
  try {
    const { syncSavedContactsToServer } = await import('./api');
    await syncSavedContactsToServer(
      contacts.map(c => ({
        label: c.label,
        name: c.name,
        email: c.email,
        phone: c.phone,
      })),
    );
  } catch {
    // offline / not signed in — try again next save
  }
}

// ── Email templates ───────────────────────────────────────────────────
//
// Templates live in the same AsyncStorage bucket as saved contacts and get
// injected into the LLM system prompt on every surface (chat, agents,
// voice, scheduled tasks). Adding one is done via a `save_template`
// sidecar on any action, the same way `save_contact` works — see
// useChat.ts and promptContext.ts.

export interface EmailTemplate {
  id: string;
  /** The short name the user refers to ("welcome email", "invoice reminder"). */
  name: string;
  /** Email subject line. */
  subject: string;
  /** HTML or plain-text body — whatever the LLM produced. */
  body: string;
  /** Optional description so the LLM knows when to use this template. */
  description?: string;
  /** When this template was created or last updated. */
  updatedAt: number;
}

export async function getEmailTemplates(): Promise<EmailTemplate[]> {
  return load('email_templates', []);
}

export async function saveEmailTemplates(templates: EmailTemplate[]) {
  await save('email_templates', templates);
}

export async function addEmailTemplate(template: Omit<EmailTemplate, 'id' | 'updatedAt'>) {
  const templates = await getEmailTemplates();
  // Dedupe by name (case-insensitive) so repeated "save my welcome email"
  // calls update the existing record in place instead of creating copies.
  const normalizedName = (template.name || '').trim().toLowerCase();
  const existingIdx = templates.findIndex(t => (t.name || '').trim().toLowerCase() === normalizedName);
  const now = Date.now();
  if (existingIdx >= 0) {
    templates[existingIdx] = {
      ...templates[existingIdx],
      ...template,
      id: templates[existingIdx].id,
      updatedAt: now,
    };
  } else {
    templates.push({ ...template, id: now.toString(), updatedAt: now });
  }
  await saveEmailTemplates(templates);
}

export async function deleteEmailTemplate(id: string) {
  const templates = await getEmailTemplates();
  await saveEmailTemplates(templates.filter(t => t.id !== id));
}

export async function addSavedContact(contact: Omit<SavedContact, 'id'>) {
  const contacts = await getSavedContacts();
  // Dedupe by label (case-insensitive). If the label already exists, update
  // the record in place so "my boss" never becomes three copies with slightly
  // different casing after repeated chat references.
  const normalizedLabel = (contact.label || '').trim().toLowerCase();
  const existingIdx = contacts.findIndex(c => (c.label || '').trim().toLowerCase() === normalizedLabel);
  if (existingIdx >= 0) {
    contacts[existingIdx] = {
      ...contacts[existingIdx],
      ...contact,
      // Preserve the original id so other code holding references stays valid
      id: contacts[existingIdx].id,
    };
  } else {
    contacts.push({ ...contact, id: Date.now().toString() });
  }
  await saveSavedContacts(contacts);
}

export async function deleteSavedContact(id: string) {
  const contacts = await getSavedContacts();
  await saveSavedContacts(contacts.filter(c => c.id !== id));
}

// Connected apps — cached list of user's connected integrations
export interface ConnectedApp {
  id: string;
  name: string;
  category: string;
  icon: string;
  actions: string[];
}

export async function getConnectedApps(): Promise<ConnectedApp[]> {
  return load('connected_apps', []);
}

export async function saveConnectedApps(apps: ConnectedApp[]) {
  await save('connected_apps', apps);
}

// Offline message queue
export interface QueuedMessage {
  sessionId: string;
  text: string;
  timestamp: number;
}

export async function getOfflineQueue(): Promise<QueuedMessage[]> {
  return load('offline_queue', []);
}

export async function addToOfflineQueue(msg: QueuedMessage) {
  const queue = await getOfflineQueue();
  queue.push(msg);
  await save('offline_queue', queue);
}

export async function clearOfflineQueue() {
  await save('offline_queue', []);
}

// Call recordings
export interface CallRecording {
  id: string;
  contactName: string;
  phone?: string;
  duration: number; // seconds
  transcript?: string;
  summary?: string;
  keyPoints?: string[];
  actionItems?: string[];
  followUpDraft?: string;
  crmLogged?: boolean;
  createdAt: number;
}

export async function getCallRecordings(): Promise<CallRecording[]> {
  return load('call_recordings', []);
}

export async function saveCallRecordings(recordings: CallRecording[]) {
  await save('call_recordings', recordings.slice(0, 100));
}

export async function addCallRecording(recording: Omit<CallRecording, 'id'>) {
  const recordings = await getCallRecordings();
  recordings.unshift({ ...recording, id: Date.now().toString() });
  await saveCallRecordings(recordings);
  return recordings[0];
}
