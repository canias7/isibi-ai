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

export async function getChatHistory(agentId: string): Promise<ChatMessage[]> {
  return load(`chat_${agentId}`, []);
}

export async function saveChatHistory(agentId: string, messages: ChatMessage[]) {
  await save(`chat_${agentId}`, messages.slice(-50)); // Keep last 50
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
