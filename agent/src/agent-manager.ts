/**
 * ISIBI Ghost Mode — Agent Manager
 *
 * Manages parallel execution of multiple agents.
 * Each agent has its own task queue and runs independently.
 */

import { AgentProfile, getAgent, getActiveAgents } from './agents';
import { processCommand, getTaskQueue, getActiveTask, TaskPlan } from './brain';
import { SystemIndex } from './indexer';

interface AgentState {
  agentId: string;
  isRunning: boolean;
  lastCommand?: string;
  taskCount: number;
}

// Track state per agent
const agentStates = new Map<string, AgentState>();

/** Dispatch a command to a specific agent */
export async function dispatchCommand(
  agentId: string,
  command: string,
  systemIndex: SystemIndex,
): Promise<TaskPlan[]> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  if (!agent.isActive) throw new Error(`Agent "${agent.name}" is not active`);

  // Track state
  let state = agentStates.get(agentId);
  if (!state) {
    state = { agentId, isRunning: false, taskCount: 0 };
    agentStates.set(agentId, state);
  }
  state.lastCommand = command;
  state.isRunning = true;
  state.taskCount++;

  try {
    const plans = await processCommand(command, systemIndex, agent);
    return plans;
  } finally {
    // Check if still running after execution
    const active = getActiveTask();
    if (!active) {
      state.isRunning = false;
    }
  }
}

/** Get the status of all active agents */
export function getAllAgentStatuses(): Array<{
  agent: AgentProfile;
  isRunning: boolean;
  lastCommand?: string;
  taskCount: number;
}> {
  const agents = getActiveAgents();
  return agents.map(agent => {
    const state = agentStates.get(agent.id);
    return {
      agent,
      isRunning: state?.isRunning || false,
      lastCommand: state?.lastCommand,
      taskCount: state?.taskCount || 0,
    };
  });
}

/** Get a single agent's status */
export function getAgentStatus(agentId: string): AgentState | null {
  return agentStates.get(agentId) || null;
}
