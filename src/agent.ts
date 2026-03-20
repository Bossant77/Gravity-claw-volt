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
import { isCorrection, extractLesson, storeLesson, findRelevantLessons } from "./learning.js";
import { executeTool } from "./tools/registry.js";
import { getTopicConfig } from "./topics.js";
import type { AgentMessage, AgentResponse } from "./types.js";
import type { Content } from "@google/generative-ai";
import type { ToolOutput } from "./tools/registry.js";

// ── Agent Loop ──────────────────────────────────────────

/**
 * Process a user message through the agentic loop.
 *
 * Level 4: Full tool-calling loop. Gemini can call tools,
 * see results, and iterate before giving the final response.
 *
 * @param threadId - Telegram forum topic thread ID (for topic-scoped context)
 */
export async function runAgent(
  chatId: number,
  userMessage: string,
  threadId?: number
): Promise<AgentResponse> {
  await saveMessage(chatId, "user", userMessage, threadId);

  const history = await getRecentMessages(chatId, 50, threadId);
  const relevantMemories = await searchMemories(chatId, userMessage, 5, threadId);
  const relevantLessons = await findRelevantLessons(chatId, userMessage, 3, threadId);

  // Get topic-specific system prompt override
  const topicConfig = getTopicConfig(threadId);
  const topicContext = topicConfig?.systemPromptOverride;

  // Build initial Gemini history
  const pastMessages = history.slice(0, -1).filter(
    (m): m is AgentMessage & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant"
  );
  const geminiHistory = toGeminiHistory(pastMessages);

  // First LLM call (with topic context)
  let response = await chat(geminiHistory, userMessage, relevantMemories, relevantLessons, topicContext);

  // Build conversation contents for multi-turn tool calling
  let memoryContext = "";
  if (relevantMemories.length > 0) {
    memoryContext += `\n\nRelevant memories from past conversations:\n${relevantMemories.map((m, i) => `[${i + 1}] ${m}`).join("\n\n")}`;
  }
  if (relevantLessons.length > 0) {
    memoryContext += `\n\nLessons I've learned from past corrections (apply these!):\n${relevantLessons.map((l, i) => `[Lesson ${i + 1}] ${l}`).join("\n\n")}`;
  }

  // Build the full system prompt (with topic context for multi-turn)
  let fullSystemPrompt = SYSTEM_PROMPT;
  if (topicContext) {
    fullSystemPrompt += `\n\n${topicContext}`;
  }
  fullSystemPrompt += memoryContext;

  const conversationContents: Content[] = [
    { role: "user", parts: [{ text: fullSystemPrompt }] },
    { role: "model", parts: [{ text: "Understood. I am Gravity Claw, ready with tools and my learned lessons. How can I help?" }] },
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
        // Inject chatId and threadId for tools that need them (reminders, etc.)
        const argsWithContext = { ...fc.args, __chatId: chatId, __threadId: threadId };
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
    log.warn({ chatId, threadId, iterations }, "Agent loop hit max iterations");
    finalText += "\n\n⚠️ _Reached maximum processing steps._";
  }

  // Save response (thread-scoped)
  await saveMessage(chatId, "assistant", finalText, threadId);

  const memoryContent = `User: ${userMessage}\nAssistant: ${finalText}`;
  storeMemory(chatId, memoryContent, threadId).catch(() => {});

  // Self-learning: detect corrections and store lessons (thread-scoped)
  if (isCorrection(userMessage) && history.length > 1) {
    const lastAssistantMsg = history.filter((m) => m.role === "assistant").pop();
    if (lastAssistantMsg) {
      const lesson = await extractLesson(lastAssistantMsg.content, userMessage);
      storeLesson(chatId, lastAssistantMsg.content, userMessage, lesson, threadId).catch(() => {});
      log.info({ chatId, threadId }, "Self-learning: lesson extracted from correction");
    }
  }

  log.info({ chatId, threadId, iterations, toolsUsed: iterations - 1 }, "Agent loop completed");
  return { text: finalText, iterations, files: files.filter((f): f is NonNullable<typeof f> => !!f) };
}

/**
 * Process a voice message through the agent.
 */
export async function runVoiceAgent(
  chatId: number,
  audioBuffer: Buffer,
  mimeType: string,
  threadId?: number
): Promise<AgentResponse> {
  await saveMessage(chatId, "user", "[🎙️ Voice message]", threadId);

  const history = await getRecentMessages(chatId, 50, threadId);
  const relevantMemories = await searchMemories(chatId, "voice message", 3, threadId);

  // Get topic-specific system prompt override
  const topicConfig = getTopicConfig(threadId);
  const topicContext = topicConfig?.systemPromptOverride;

  const pastMessages = history.slice(0, -1).filter(
    (m): m is AgentMessage & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant"
  );
  const geminiHistory = toGeminiHistory(pastMessages);

  const responseText = await chatWithAudio(geminiHistory, audioBuffer, mimeType, relevantMemories, topicContext);

  await saveMessage(chatId, "assistant", responseText, threadId);

  const memoryContent = `User: [voice message]\nAssistant: ${responseText}`;
  storeMemory(chatId, memoryContent, threadId).catch(() => {});

  log.info({ chatId, threadId }, "Voice agent completed");
  return { text: responseText, iterations: 1 };
}

/**
 * Clear conversation history for a chat (thread-scoped).
 */
export async function clearHistory(chatId: number, threadId?: number): Promise<void> {
  await clearMessages(chatId, threadId);
  log.info({ chatId, threadId }, "Conversation history cleared");
}
