/** GoFarther AI — Local Storage */

import AsyncStorage from '@react-native-async-storage/async-storage';

export async function save(key: string, data: any) {
  await AsyncStorage.setItem(key, JSON.stringify(data));
}

export async function load<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? JSON.parse(raw) : fallback;
}

export async function remove(key: string) {
  await AsyncStorage.removeItem(key);
}

// Agent storage
export interface Agent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  instructions: string;
  isActive: boolean;
  color: string;
}

export async function getAgents(): Promise<Agent[]> {
  return load('agents', []);
}

export async function saveAgents(agents: Agent[]) {
  await save('agents', agents);
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
  await AsyncStorage.removeItem(`chat_${sessionId}`);
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
}

export async function addSavedContact(contact: Omit<SavedContact, 'id'>) {
  const contacts = await getSavedContacts();
  contacts.push({ ...contact, id: Date.now().toString() });
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
