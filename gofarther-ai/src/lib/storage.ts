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
}

export async function getChatSessions(): Promise<ChatSession[]> {
  return load('chat_sessions', []);
}

export async function saveChatSessions(sessions: ChatSession[]) {
  await save('chat_sessions', sessions.slice(0, 50)); // Keep last 50
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

export async function getScheduledTasks(): Promise<ScheduledTask[]> {
  return load('scheduled_tasks', []);
}

export async function saveScheduledTasks(tasks: ScheduledTask[]) {
  await save('scheduled_tasks', tasks);
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
