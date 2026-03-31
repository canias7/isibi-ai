/**
 * ISIBI Ghost Mode — Agent Profiles
 *
 * Users can create multiple agents, each with a unique personality,
 * role, and set of instructions. Agents run in parallel.
 */

import { loadConfig, saveConfig } from './config';

export interface AgentProfile {
  id: string;
  name: string;
  emoji: string;
  role: string;           // Short description: "Handle all email tasks"
  instructions: string;   // Detailed system prompt for Claude
  isActive: boolean;
  color: string;          // Hex color for the orb/UI accent
  createdAt: string;
}

/** Generate a short random ID */
function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/** Default agent created on first run */
export function createDefaultAgent(): AgentProfile {
  return {
    id: 'ghost-default',
    name: 'Ghost',
    emoji: '👻',
    role: 'General-purpose assistant that controls your computer',
    instructions: 'You are Ghost, a helpful AI agent. You can open apps, click buttons, type text, and navigate the user\'s computer to complete any task they ask for.',
    isActive: true,
    color: '#ec4899',
    createdAt: new Date().toISOString(),
  };
}

/** Get all agents from config */
export function getAgents(): AgentProfile[] {
  const config = loadConfig();
  if (!config.agents || config.agents.length === 0) {
    const def = createDefaultAgent();
    saveConfig({ agents: [def] });
    return [def];
  }
  return config.agents;
}

/** Get a single agent by ID */
export function getAgent(id: string): AgentProfile | undefined {
  return getAgents().find(a => a.id === id);
}

/** Get all active agents */
export function getActiveAgents(): AgentProfile[] {
  return getAgents().filter(a => a.isActive);
}

/** Create a new agent */
export function createAgent(data: {
  name: string;
  emoji: string;
  role: string;
  instructions: string;
  color: string;
}): AgentProfile {
  const agent: AgentProfile = {
    id: randomId(),
    name: data.name,
    emoji: data.emoji,
    role: data.role,
    instructions: data.instructions,
    isActive: true,
    color: data.color,
    createdAt: new Date().toISOString(),
  };

  const agents = getAgents();
  agents.push(agent);
  saveConfig({ agents });
  return agent;
}

/** Update an existing agent */
export function updateAgent(id: string, data: Partial<Omit<AgentProfile, 'id' | 'createdAt'>>): AgentProfile | null {
  const agents = getAgents();
  const idx = agents.findIndex(a => a.id === id);
  if (idx === -1) return null;

  agents[idx] = { ...agents[idx], ...data };
  saveConfig({ agents });
  return agents[idx];
}

/** Toggle agent active/inactive */
export function toggleAgent(id: string): AgentProfile | null {
  const agents = getAgents();
  const agent = agents.find(a => a.id === id);
  if (!agent) return null;

  agent.isActive = !agent.isActive;
  saveConfig({ agents });
  return agent;
}

/** Delete an agent (cannot delete the last one) */
export function deleteAgent(id: string): boolean {
  const agents = getAgents();
  if (agents.length <= 1) return false;

  const filtered = agents.filter(a => a.id !== id);
  if (filtered.length === agents.length) return false;

  saveConfig({ agents: filtered });
  return true;
}
