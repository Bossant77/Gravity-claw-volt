// ── Message Types ────────────────────────────────────────

/** A single message in a conversation */
export interface AgentMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Present when role === "tool" */
  toolCallId?: string;
}

// ── Tool Types ──────────────────────────────────────────

/** Schema describing a tool the LLM can invoke */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A tool call requested by the LLM */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** The result of executing a tool */
export interface ToolResult {
  callId: string;
  name: string;
  output: string;
  isError?: boolean;
}

/** A handler function for a tool */
export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<string>;

// ── Conversation Types ──────────────────────────────────

/** Per-chat conversation context (in-memory for Level 1) */
export interface ConversationContext {
  chatId: number;
  history: AgentMessage[];
}

// ── Agent Response ──────────────────────────────────────

/** What the agent loop returns to the bot */
export interface AgentResponse {
  text: string;
  /** How many loop iterations it took */
  iterations: number;
  /** Optional files to send to the user */
  files?: Array<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
  }>;
}
