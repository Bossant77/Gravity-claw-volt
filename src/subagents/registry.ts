import type { FunctionDeclaration } from "@google/generative-ai";

// ── Sub-Agent Config ────────────────────────────────────

export interface SubAgentConfig {
  /** Unique name (used as ID) */
  name: string;
  /** Short description for Volt to decide who to invoke */
  description: string;
  /** Gemini model ID to use for this agent */
  model: string;
  /** System prompt — role, goal, constraints */
  systemPrompt: string;
  /** Which registered tools this agent can use */
  allowedTools: string[];
  /** Max output tokens */
  maxTokens: number;
}

// ── Registry ────────────────────────────────────────────

const agents = new Map<string, SubAgentConfig>();

export function registerAgent(agent: SubAgentConfig): void {
  agents.set(agent.name, agent);
}

export function getAgent(name: string): SubAgentConfig | undefined {
  return agents.get(name);
}

export function getAllAgents(): SubAgentConfig[] {
  return Array.from(agents.values());
}

/**
 * Returns a summary of agents for Volt's system prompt so it knows who to delegate to.
 */
export function getAgentSummary(): string {
  return getAllAgents()
    .map((a) => `• ${a.name}: ${a.description} (model: ${a.model})`)
    .join("\n");
}

/**
 * Returns agent names + descriptions as a string for Gemini function calling enum.
 */
export function getAgentNames(): string[] {
  return getAllAgents().map((a) => a.name);
}
