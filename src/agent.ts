import { chat, chatWithAudio, toGeminiHistory } from "./llm.js";
import { log } from "./logger.js";
import { config } from "./config.js";
import {
  saveMessage,
  getRecentMessages,
  clearMessages,
  storeMemory,
  searchMemories,
} from "./memory.js";
import type { AgentMessage, AgentResponse } from "./types.js";

// ── Agent Loop ──────────────────────────────────────────

/**
 * Process a user message through the agentic loop.
 *
 * Level 2: conversation history is loaded from PostgreSQL,
 * and semantic memories are injected as context.
 */
export async function runAgent(
  chatId: number,
  userMessage: string
): Promise<AgentResponse> {
  // Save user message to database
  await saveMessage(chatId, "user", userMessage);

  // Load recent conversation history from PostgreSQL
  const history = await getRecentMessages(chatId, 50);

  // Search semantic memories for relevant context
  const relevantMemories = await searchMemories(chatId, userMessage, 5);

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

    // Call LLM (with semantic context if available)
    const response = await chat(geminiHistory, lastUserMsg, relevantMemories);

    finalText = response;

    // Save assistant response to database
    await saveMessage(chatId, "assistant", response);

    // Store this exchange as a semantic memory (async, non-blocking)
    const memoryContent = `User: ${userMessage}\nAssistant: ${response}`;
    storeMemory(chatId, memoryContent).catch(() => {});

    break;
  }

  if (iterations >= config.maxIterations) {
    log.warn({ chatId, iterations }, "Agent loop hit max iterations");
    finalText += "\n\n⚠️ _Reached maximum processing steps._";
  }

  log.info({ chatId, iterations }, "Agent loop completed");
  return { text: finalText, iterations };
}

/**
 * Process a voice message through the agent.
 * Downloads audio → sends to Gemini multimodal → text response.
 */
export async function runVoiceAgent(
  chatId: number,
  audioBuffer: Buffer,
  mimeType: string
): Promise<AgentResponse> {
  // Save a placeholder for the voice message in history
  await saveMessage(chatId, "user", "[🎙️ Voice message]");

  // Load conversation history
  const history = await getRecentMessages(chatId, 50);

  // Search semantic memories (use generic query since we don't have text yet)
  const relevantMemories = await searchMemories(chatId, "voice message", 3);

  // Build Gemini history (everything except the last placeholder)
  const pastMessages = history.slice(0, -1).filter(
    (m): m is AgentMessage & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant"
  );
  const geminiHistory = toGeminiHistory(pastMessages);

  // Send audio to Gemini for transcription + response
  const response = await chatWithAudio(geminiHistory, audioBuffer, mimeType, relevantMemories);

  // Save assistant response
  await saveMessage(chatId, "assistant", response);

  // Store as semantic memory
  const memoryContent = `User: [voice message]\nAssistant: ${response}`;
  storeMemory(chatId, memoryContent).catch(() => {});

  log.info({ chatId }, "Voice agent completed");
  return { text: response, iterations: 1 };
}

/**
 * Clear conversation history for a chat.
 */
export async function clearHistory(chatId: number): Promise<void> {
  await clearMessages(chatId);
  log.info({ chatId }, "Conversation history cleared");
}

