import { GoogleGenerativeAI, type Content, type Part } from "@google/generative-ai";
import { config } from "./config.js";
import { log } from "./logger.js";
import { toGeminiHistory, getSystemPrompt } from "./llm.js";
import type { AgentMessage } from "./types.js";

// ── Constants ───────────────────────────────────────────

// Gemini Flash context window is ~1M tokens, but we target a practical limit
const MAX_CONTEXT_TOKENS = 900_000;
const COMPACTION_THRESHOLD = 0.7; // Trigger at 70% of max
const MIN_RECENT_MESSAGES = 10; // Always keep this many verbatim
const MAX_MEMORIES_IN_CONTEXT = 5;

// ── Token Counter ───────────────────────────────────────

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const counterModel = genAI.getGenerativeModel({ model: config.geminiModel });

/**
 * Estimate token count for a Content array using Gemini's countTokens API.
 * Falls back to character-based estimation on error.
 */
export async function countTokens(contents: Content[]): Promise<number> {
  try {
    const result = await counterModel.countTokens({ contents });
    return result.totalTokens;
  } catch {
    // Fallback: rough estimate (1 token ≈ 4 chars for English/Spanish mix)
    const totalChars = contents.reduce((sum, c) => {
      return sum + c.parts.reduce((pSum, p) => {
        if ("text" in p && p.text) return pSum + p.text.length;
        return pSum;
      }, 0);
    }, 0);
    return Math.ceil(totalChars / 3.5);
  }
}

// ── Context Builder ─────────────────────────────────────

export interface ContextBuildResult {
  contents: Content[];
  tokenCount: number;
  wasCompacted: boolean;
  summaryGenerated: boolean;
}

/**
 * Build an optimized conversation context.
 *
 * Strategy (inspired by Gemini CLI + Claude Code):
 * 1. Assemble full system prompt + directives + topic context
 * 2. Count tokens
 * 3. If < 70% of limit → use everything as-is
 * 4. If >= 70% → summarize older messages, keep recent ones verbatim
 */
export async function buildContext(
  fullSystemPrompt: string,
  history: AgentMessage[],
  userMessage: string,
  relevantMemories: string[] = [],
  relevantLessons: string[] = []
): Promise<ContextBuildResult> {
  // Build memory context
  let memoryContext = "";
  if (relevantMemories.length > 0) {
    const cappedMemories = relevantMemories.slice(0, MAX_MEMORIES_IN_CONTEXT);
    memoryContext += `\n\nRelevant memories from past conversations:\n${cappedMemories.map((m, i) => `[${i + 1}] ${m}`).join("\n\n")}`;
  }
  if (relevantLessons.length > 0) {
    memoryContext += `\n\nLessons I've learned from past corrections (apply these!):\n${relevantLessons.map((l, i) => `[Lesson ${i + 1}] ${l}`).join("\n\n")}`;
  }

  const systemWithMemory = fullSystemPrompt + memoryContext;

  // Filter valid history
  const validHistory = history.filter(
    (m): m is AgentMessage & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant"
  );

  // Build full contents
  const systemContents: Content[] = [
    { role: "user", parts: [{ text: systemWithMemory }] },
    { role: "model", parts: [{ text: "Understood. I am Gravity Claw, ready with tools and my learned lessons. How can I help?" }] },
  ];

  const historyContents = toGeminiHistory(validHistory);
  const userContent: Content = { role: "user", parts: [{ text: userMessage }] };

  const fullContents = [...systemContents, ...historyContents, userContent];

  // Count tokens
  let tokenCount: number;
  try {
    tokenCount = await countTokens(fullContents);
  } catch {
    tokenCount = 0; // If counting fails, don't compact
  }

  const threshold = MAX_CONTEXT_TOKENS * COMPACTION_THRESHOLD;

  // If under threshold, return as-is
  if (tokenCount < threshold || validHistory.length <= MIN_RECENT_MESSAGES) {
    return {
      contents: fullContents,
      tokenCount,
      wasCompacted: false,
      summaryGenerated: false,
    };
  }

  // ── Compaction needed ─────────────────────────────────
  log.info(
    { tokenCount, threshold, historyLength: validHistory.length },
    "Context compaction triggered"
  );

  // Split history: older messages → summarize, recent → keep verbatim
  const recentCount = Math.min(MIN_RECENT_MESSAGES, validHistory.length);
  const olderMessages = validHistory.slice(0, -recentCount);
  const recentMessages = validHistory.slice(-recentCount);

  // Summarize older messages
  const summary = await summarizeMessages(olderMessages);

  // Build compacted contents
  const summaryContent: Content = {
    role: "user",
    parts: [{ text: `[CONVERSATION SUMMARY — older messages compressed]\n${summary}` }],
  };
  const summaryAck: Content = {
    role: "model",
    parts: [{ text: "Understood, I have the conversation context from the summary." }],
  };

  const recentContents = toGeminiHistory(recentMessages);
  const compactedContents = [
    ...systemContents,
    summaryContent,
    summaryAck,
    ...recentContents,
    userContent,
  ];

  const compactedTokens = await countTokens(compactedContents).catch(() => 0);

  log.info(
    { originalTokens: tokenCount, compactedTokens, messagesSummarized: olderMessages.length },
    "Context compacted"
  );

  return {
    contents: compactedContents,
    tokenCount: compactedTokens,
    wasCompacted: true,
    summaryGenerated: true,
  };
}

// ── Message Summarizer ──────────────────────────────────

/**
 * Summarize a list of messages into a compact context paragraph.
 * Preserves key decisions, facts, and action items.
 */
async function summarizeMessages(messages: AgentMessage[]): Promise<string> {
  if (messages.length === 0) return "No prior conversation.";

  // Build a simple text representation
  const conversationText = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  // If short enough, just return truncated version
  if (conversationText.length < 2000) {
    return conversationText;
  }

  // Use LLM to summarize
  try {
    const summarizerModel = genAI.getGenerativeModel({
      model: config.geminiModel,
      generationConfig: { maxOutputTokens: 1024 },
    });

    const result = await summarizerModel.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Summarize this conversation concisely. Preserve:
1. Key decisions and facts mentioned
2. User preferences or instructions given
3. Action items or pending tasks
4. Any corrections or clarifications made

Do NOT include greetings or filler. Use bullet points.

Conversation:
${conversationText.slice(0, 15_000)}`,
            },
          ],
        },
      ],
    });

    return result.response.text();
  } catch (err) {
    log.error({ err }, "Failed to summarize messages, using truncation");
    // Fallback: take first and last few messages
    const first = messages.slice(0, 3).map((m) => `${m.role}: ${m.content.slice(0, 200)}`);
    const last = messages.slice(-3).map((m) => `${m.role}: ${m.content.slice(0, 200)}`);
    return `[Truncated summary]\n${first.join("\n")}\n...\n${last.join("\n")}`;
  }
}
