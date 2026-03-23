import { chat, chatWithAudio, chatWithToolResults, toGeminiHistory, SYSTEM_PROMPT } from "./llm.js";
import { log } from "./logger.js";
import { detectHallucinatedAction } from "./guards/hallucination.js";
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
import { formatDirectivesForPrompt } from "./directives.js";
import type { AgentMessage, AgentResponse } from "./types.js";
import type { Content } from "@google/generative-ai";
import type { ToolOutput } from "./tools/registry.js";

// ── Retry Helpers ───────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff in ms

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is transient (worth retrying).
 */
function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("429") || // Rate limit
    msg.includes("503") || // Service unavailable
    msg.includes("500") || // Internal server error
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("timeout") ||
    msg.includes("overloaded")
  );
}

// ── Agent Loop ──────────────────────────────────────────

/**
 * Process a user message through the agentic loop.
 *
 * Level 4: Full tool-calling loop with retry, fallback, and directives.
 * Gemini can call tools, see results, and iterate before giving the final response.
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

  // Load active directives for dynamic injection
  const directivesBlock = await formatDirectivesForPrompt().catch(() => "");

  // Get topic-specific system prompt override
  const topicConfig = getTopicConfig(threadId);
  const topicContext = topicConfig?.systemPromptOverride;

  // Build initial Gemini history
  const pastMessages = history.slice(0, -1).filter(
    (m): m is AgentMessage & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant"
  );
  const geminiHistory = toGeminiHistory(pastMessages);

  // First LLM call (with directives + topic context) — with retry
  let response = await callWithRetry(() =>
    chat(geminiHistory, userMessage, relevantMemories, relevantLessons, topicContext, directivesBlock)
  );

  // Build conversation contents for multi-turn tool calling
  let memoryContext = "";
  if (relevantMemories.length > 0) {
    memoryContext += `\n\nRelevant memories from past conversations:\n${relevantMemories.map((m, i) => `[${i + 1}] ${m}`).join("\n\n")}`;
  }
  if (relevantLessons.length > 0) {
    memoryContext += `\n\nLessons I've learned from past corrections (apply these!):\n${relevantLessons.map((l, i) => `[Lesson ${i + 1}] ${l}`).join("\n\n")}`;
  }

  // Build the full system prompt (with directives + topic context for multi-turn)
  let fullSystemPrompt = SYSTEM_PROMPT;
  if (directivesBlock) {
    fullSystemPrompt += directivesBlock;
  }
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
  let toolsCalledThisLoop = false;
  const files: ToolOutput["file"][] = [];

  while (iterations < config.maxIterations) {
    iterations++;

    if (response.text) {
      // LLM responded with text — we're done
      finalText = response.text;
      break;
    }

    if (response.functionCalls && response.functionCalls.length > 0) {
      toolsCalledThisLoop = true;
      // Add model's raw response to conversation (preserves thought_signature)
      if (response.modelContent) {
        conversationContents.push(response.modelContent);
      }

      // Execute each function call
      const functionResponseParts = [];
      for (const fc of response.functionCalls) {
        // Inject chatId and threadId for tools that need them (reminders, etc.)
        const argsWithContext = { ...fc.args, __chatId: chatId, __threadId: threadId };

        let toolOutput: ToolOutput;
        try {
          toolOutput = await executeTool(fc.name, argsWithContext);
        } catch (toolErr) {
          // Structured error feedback — let LLM reason about the failure
          const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
          log.warn({ tool: fc.name, err: errMsg }, "Tool execution failed — sending error to LLM");
          toolOutput = {
            result: `⚠️ Tool "${fc.name}" failed: ${errMsg}. Consider retrying with different parameters or using an alternative tool.`,
          };
        }

        functionResponseParts.push({
          functionResponse: {
            name: fc.name,
            id: (fc as unknown as Record<string, unknown>).id as string | undefined,
            response: { result: toolOutput.result },
          },
        });

        // Audit trail — structured log of every tool call for debugging
        const auditArgs = Object.fromEntries(
          Object.entries(fc.args ?? {}).filter(([k]) => !k.startsWith("__"))
        );
        log.info(
          {
            chatId,
            threadId,
            tool: fc.name,
            args: auditArgs,
            resultPreview: toolOutput.result.slice(0, 200),
            hasFile: !!toolOutput.file,
          },
          "🔍 Tool audit trail"
        );

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

      // Call Gemini again with tool results — with retry
      response = await callWithRetry(() => chatWithToolResults(conversationContents));
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

  // ── Anti-Hallucination Guard ────────────────────────────
  const hallucinationCheck = detectHallucinatedAction(finalText, toolsCalledThisLoop);
  if (hallucinationCheck.detected && hallucinationCheck.reprompt) {
    log.warn(
      { chatId, threadId, matchedPattern: hallucinationCheck.matchedPattern },
      "Anti-hallucination guard triggered — re-prompting LLM"
    );

    // Re-prompt: push correction and call Gemini one more time
    conversationContents.push(
      { role: "model", parts: [{ text: finalText }] },
      { role: "user", parts: [{ text: hallucinationCheck.reprompt }] }
    );

    try {
      const retryResponse = await callWithRetry(() =>
        chatWithToolResults(conversationContents)
      );

      if (retryResponse.functionCalls && retryResponse.functionCalls.length > 0) {
        // LLM corrected itself — process tool calls
        if (retryResponse.modelContent) {
          conversationContents.push(retryResponse.modelContent);
        }
        const functionResponseParts = [];
        for (const fc of retryResponse.functionCalls) {
          const argsWithContext = { ...fc.args, __chatId: chatId, __threadId: threadId };
          let toolOutput: ToolOutput;
          try {
            toolOutput = await executeTool(fc.name, argsWithContext);
          } catch (toolErr) {
            const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
            toolOutput = { result: `⚠️ Tool "${fc.name}" failed: ${errMsg}` };
          }
          functionResponseParts.push({
            functionResponse: {
              name: fc.name,
              id: (fc as unknown as Record<string, unknown>).id as string | undefined,
              response: { result: toolOutput.result },
            },
          });
          if (toolOutput.file) files.push(toolOutput.file);
        }
        conversationContents.push({ role: "user", parts: functionResponseParts });

        // Get final text after tool execution
        const finalResponse = await callWithRetry(() =>
          chatWithToolResults(conversationContents)
        );
        finalText = finalResponse.text ?? "Action completed.";
        log.info({ chatId, threadId }, "Anti-hallucination guard: LLM corrected itself and used tool");
      } else if (retryResponse.text) {
        // LLM responded with text again — check if it's still hallucinating
        const secondCheck = detectHallucinatedAction(retryResponse.text, false);
        if (secondCheck.detected) {
          log.error(
            { chatId, threadId, matchedPattern: secondCheck.matchedPattern },
            "Anti-hallucination guard: LLM hallucinated AGAIN after re-prompt — giving up"
          );
          // Keep original text but don't loop forever
        } else {
          finalText = retryResponse.text;
        }
      }
    } catch (retryErr) {
      log.error({ err: retryErr }, "Anti-hallucination re-prompt failed");
      // Keep original finalText
    }
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

// ── Retry Wrapper ───────────────────────────────────────

/**
 * Call a function with exponential backoff retry on transient errors.
 */
async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < MAX_RETRIES && isTransientError(err)) {
        const delay = RETRY_DELAYS[attempt] ?? 4000;
        log.warn(
          { attempt: attempt + 1, maxRetries: MAX_RETRIES, delayMs: delay },
          "Transient error — retrying..."
        );
        await sleep(delay);
        continue;
      }
      // Non-transient or exhausted retries
      throw err;
    }
  }
  throw new Error("Retry logic bug — should not reach here");
}

// ── Voice Agent ─────────────────────────────────────────

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

  // Load directives for voice responses too
  const directivesBlock = await formatDirectivesForPrompt().catch(() => "");

  // Get topic-specific system prompt override
  const topicConfig = getTopicConfig(threadId);
  const topicContext = topicConfig?.systemPromptOverride;

  const pastMessages = history.slice(0, -1).filter(
    (m): m is AgentMessage & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant"
  );
  const geminiHistory = toGeminiHistory(pastMessages);

  const responseText = await callWithRetry(() =>
    chatWithAudio(geminiHistory, audioBuffer, mimeType, relevantMemories, topicContext)
  );

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
