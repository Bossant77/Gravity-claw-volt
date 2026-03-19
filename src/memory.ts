import { query } from "./db.js";
import { log } from "./logger.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "./config.js";
import type { AgentMessage } from "./types.js";

// ── Embedding Client ────────────────────────────────────

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const embeddingModel = genAI.getGenerativeModel({
  model: "gemini-embedding-001",
});

/**
 * Generate a vector embedding for the given text.
 * Returns a 768-dimensional float array.
 */
export async function embedText(text: string): Promise<number[]> {
  try {
    const result = await embeddingModel.embedContent(text);
    return result.embedding.values;
  } catch (err) {
    log.error({ err }, "Embedding generation failed");
    throw err;
  }
}

// ── Conversation Memory (Messages) ──────────────────────

/**
 * Save a message to persistent storage.
 */
export async function saveMessage(
  chatId: number,
  role: string,
  content: string
): Promise<void> {
  await query(
    "INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3)",
    [chatId, role, content]
  );
}

/**
 * Load the most recent messages for a chat.
 */
export async function getRecentMessages(
  chatId: number,
  limit = 50
): Promise<AgentMessage[]> {
  const result = await query<{ role: string; content: string }>(
    `SELECT role, content FROM messages
     WHERE chat_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [chatId, limit]
  );

  // Reverse to get chronological order (oldest first)
  return result.rows.reverse().map((row: { role: string; content: string }) => ({
    role: row.role as AgentMessage["role"],
    content: row.content,
  }));
}

/**
 * Delete all messages for a chat.
 */
export async function clearMessages(chatId: number): Promise<void> {
  await query("DELETE FROM messages WHERE chat_id = $1", [chatId]);
  await query("DELETE FROM memories WHERE chat_id = $1", [chatId]);
  log.info({ chatId }, "Cleared messages and memories");
}

// ── Semantic Memory (Embeddings) ────────────────────────

/**
 * Store a semantic memory with its embedding.
 */
export async function storeMemory(
  chatId: number,
  content: string
): Promise<void> {
  try {
    const embedding = await embedText(content);
    const vectorStr = `[${embedding.join(",")}]`;

    await query(
      "INSERT INTO memories (chat_id, content, embedding) VALUES ($1, $2, $3::vector)",
      [chatId, content, vectorStr]
    );

    log.debug({ chatId, contentLength: content.length }, "Stored semantic memory");
  } catch (err) {
    // Non-fatal — don't crash the bot if embedding fails
    log.error({ err }, "Failed to store semantic memory");
  }
}

/**
 * Search memories by cosine similarity to the query text.
 * Returns the top `limit` most relevant memories.
 */
export async function searchMemories(
  chatId: number,
  queryText: string,
  limit = 5
): Promise<string[]> {
  try {
    const embedding = await embedText(queryText);
    const vectorStr = `[${embedding.join(",")}]`;

    const result = await query<{ content: string; similarity: number }>(
      `SELECT content, 1 - (embedding <=> $1::vector) AS similarity
       FROM memories
       WHERE chat_id = $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vectorStr, chatId, limit]
    );

    return result.rows
      .filter((r: { content: string; similarity: number }) => r.similarity > 0.3)
      .map((r: { content: string; similarity: number }) => r.content);
  } catch (err) {
    log.error({ err }, "Semantic memory search failed");
    return []; // graceful degradation
  }
}
