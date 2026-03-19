import { chat, chatWithAudio, chatWithToolResults, toGeminiHistory, SYSTEM_PROMPT } from "./llm.js";
import { log } from "./logger.js";
import { config } from "./config.js";
import {
  saveMessage,
  getRecentMessages,
  clearMessages,
  storeMemory,
  searchMemories,
} from "./memory.js";
import { executeTool } from "./tools/registry.js";
import type { AgentMessage, AgentResponse } from "./types.js";
import type { Content } from "@google/generative-ai";
import type { ToolOutput } from "./tools/registry.js";

// ── Agent Loop ──────────────────────────────────────────

/**
 * Process a user message through the agentic loop.
 *
 * Level 4: Full tool-calling loop. Gemini can call tools,
 * see results, and iterate before giving the final response.
 */
export async function runAgent(
  chatId: number,
  userMessage: string
): Promise<AgentResponse> {
  await saveMessage(chatId, "user", userMessage);

  const history = await getRecentMessages(chatId, 50);
  const relevantMemories = await searchMemories(chatId, userMessage, 5);

  // Build initial Gemini history
  const pastMessages = history.slice(0, -1).filter(
    (m): m is AgentMessage & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant"
  );
  const geminiHistory = toGeminiHistory(pastMessages);

  // First LLM call
  let response = await chat(geminiHistory, userMessage, relevantMemories);

  // Build conversation contents for multi-turn tool calling
  let memoryContext = "";
  if (relevantMemories.length > 0) {
    memoryContext = `\n\nRelevant memories from past conversations:\n${relevantMemories.map((m, i) => `[${i + 1}] ${m}`).join("\n\n")}`;
  }

  const conversationContents: Content[] = [
    { role: "user", parts: [{ text: SYSTEM_PROMPT + memoryContext }] },
    { role: "model", parts: [{ text: "Understood. I am Gravity Claw, ready with tools. How can I help?" }] },
    ...geminiHistory,
    { role: "user", parts: [{ text: userMessage }] },
  ];

  let iterations = 0;
  let finalText = "";
  const files: ToolOutput["file"][] = [];

  while (iterations < config.maxIterations) {
    iterations++;

    if (response.text) {
      // LLM responded with text — we're done
      finalText = response.text;
      break;
    }

    if (response.functionCalls && response.functionCalls.length > 0) {
      // Add model's raw response to conversation (preserves thought_signature)
      if (response.modelContent) {
        conversationContents.push(response.modelContent);
      }

      // Execute each function call
      const functionResponseParts = [];
      for (const fc of response.functionCalls) {
        // Inject chatId for tools that need it (reminders)
        const argsWithContext = { ...fc.args, __chatId: chatId };
        const toolOutput = await executeTool(fc.name, argsWithContext);

        functionResponseParts.push({
          functionResponse: {
            name: fc.name,
            id: (fc as unknown as Record<string, unknown>).id as string | undefined,
            response: { result: toolOutput.result },
          },
        });

        // Collect files to send
        if (toolOutput.file) {
          files.push(toolOutput.file);
        }
      }

      // Add tool results to conversation
      conversationContents.push({
        role: "user",
        parts: functionResponseParts,
      });

      // Call Gemini again with tool results
      response = await chatWithToolResults(conversationContents);
    } else {
      // No text and no function calls — shouldn't happen
      finalText = "I processed your request but couldn't generate a response.";
      break;
    }
  }

  if (iterations >= config.maxIterations) {
    log.warn({ chatId, iterations }, "Agent loop hit max iterations");
    finalText += "\n\n⚠️ _Reached maximum processing steps._";
  }

  // Save response
  await saveMessage(chatId, "assistant", finalText);

  const memoryContent = `User: ${userMessage}\nAssistant: ${finalText}`;
  storeMemory(chatId, memoryContent).catch(() => {});

  log.info({ chatId, iterations, toolsUsed: iterations - 1 }, "Agent loop completed");
  return { text: finalText, iterations, files: files.filter((f): f is NonNullable<typeof f> => !!f) };
}

/**
 * Process a voice message through the agent.
 */
export async function runVoiceAgent(
  chatId: number,
  audioBuffer: Buffer,
  mimeType: string
): Promise<AgentResponse> {
  await saveMessage(chatId, "user", "[🎙️ Voice message]");

  const history = await getRecentMessages(chatId, 50);
  const relevantMemories = await searchMemories(chatId, "voice message", 3);

  const pastMessages = history.slice(0, -1).filter(
    (m): m is AgentMessage & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant"
  );
  const geminiHistory = toGeminiHistory(pastMessages);

  const responseText = await chatWithAudio(geminiHistory, audioBuffer, mimeType, relevantMemories);

  await saveMessage(chatId, "assistant", responseText);

  const memoryContent = `User: [voice message]\nAssistant: ${responseText}`;
  storeMemory(chatId, memoryContent).catch(() => {});

  log.info({ chatId }, "Voice agent completed");
  return { text: responseText, iterations: 1 };
}

/**
 * Clear conversation history for a chat.
 */
export async function clearHistory(chatId: number): Promise<void> {
  await clearMessages(chatId);
  log.info({ chatId }, "Conversation history cleared");
}
