import { chat, toGeminiHistory } from "./llm.js";
import { log } from "./logger.js";
import { config } from "./config.js";
import type { AgentMessage, AgentResponse } from "./types.js";

// ── In-Memory Conversation Store ────────────────────────
// Key: Telegram chat ID → message history
const conversations = new Map<number, AgentMessage[]>();

const MAX_HISTORY = 50; // keep last N messages per chat to bound memory

// ── Agent Loop ──────────────────────────────────────────

/**
 * Process a user message through the agentic loop.
 *
 * Level 1: no tools registered, so the loop is a single pass —
 * send to LLM, get text back. The loop structure is here so
 * Levels 2–5 can plug in tools without refactoring.
 */
export async function runAgent(
  chatId: number,
  userMessage: string
): Promise<AgentResponse> {
  // Retrieve or initialize conversation history
  let history = conversations.get(chatId) ?? [];

  // Add user message
  history.push({ role: "user", content: userMessage });

  let iterations = 0;
  let finalText = "";

  while (iterations < config.maxIterations) {
    iterations++;

    // Build Gemini-compatible history (everything except the last user msg)
    const pastMessages = history.slice(0, -1).filter(
      (m): m is AgentMessage & { role: "user" | "assistant" } =>
        m.role === "user" || m.role === "assistant"
    );
    const geminiHistory = toGeminiHistory(pastMessages);
    const lastUserMsg = history[history.length - 1]!.content;

    // Call LLM
    const response = await chat(geminiHistory, lastUserMsg);

    // Level 1: no tool calls possible, so we always get text back
    finalText = response;

    // Add assistant response to history
    history.push({ role: "assistant", content: response });

    // No tool calls → loop ends after 1 iteration in Level 1
    break;

    // ── Future: Level 4 will add tool-call detection here ──
    // if (response.toolCalls) {
    //   for (const call of response.toolCalls) {
    //     const result = await executeToolCall(call);
    //     history.push({ role: "tool", content: result, toolCallId: call.id });
    //   }
    //   continue; // re-enter loop so LLM sees tool results
    // }
  }

  if (iterations >= config.maxIterations) {
    log.warn({ chatId, iterations }, "Agent loop hit max iterations");
    finalText += "\n\n⚠️ _Reached maximum processing steps._";
  }

  // Trim history to prevent unbounded growth
  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }
  conversations.set(chatId, history);

  log.info({ chatId, iterations }, "Agent loop completed");
  return { text: finalText, iterations };
}

/**
 * Clear conversation history for a chat.
 */
export function clearHistory(chatId: number): void {
  conversations.delete(chatId);
  log.info({ chatId }, "Conversation history cleared");
}
