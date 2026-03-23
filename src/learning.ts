import { query } from "./db.js";
import { log } from "./logger.js";
import { embedText } from "./memory.js";

// ── Self-Learning System ────────────────────────────────

/**
 * Store a lesson learned from user corrections (thread-scoped).
 */
export async function storeLesson(
  chatId: number,
  context: string,
  correction: string,
  lesson: string,
  threadId?: number
): Promise<void> {
  try {
    const embedding = await embedText(lesson);
    const vectorStr = `[${embedding.join(",")}]`;

    await query(
      `INSERT INTO lessons (chat_id, thread_id, context, correction, lesson, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)`,
      [chatId, threadId ?? null, context, correction, lesson, vectorStr]
    );

    log.info({ chatId, threadId }, "Lesson stored");
  } catch (err) {
    log.error({ err }, "Failed to store lesson");
  }
}

/**
 * Find lessons relevant to the current query (thread-scoped).
 */
export async function findRelevantLessons(
  chatId: number,
  queryText: string,
  limit = 3,
  threadId?: number
): Promise<string[]> {
  try {
    const embedding = await embedText(queryText);
    const vectorStr = `[${embedding.join(",")}]`;

    const result = await query<{ lesson: string; similarity: number }>(
      `SELECT lesson, 1 - (embedding <=> $1::vector) AS similarity
       FROM lessons
       WHERE chat_id = $2 AND thread_id IS NOT DISTINCT FROM $3
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      [vectorStr, chatId, threadId ?? null, limit]
    );

    return result.rows
      .filter((r: { lesson: string; similarity: number }) => r.similarity > 0.25)
      .map((r: { lesson: string; similarity: number }) => r.lesson);
  } catch (err) {
    log.error({ err }, "Lesson search failed");
    return [];
  }
}

// ── Correction Detection ────────────────────────────────

const CORRECTION_PATTERNS = [
  // Spanish corrections
  /no,?\s*(me refiero|quise decir|quiero decir|meant)/i,
  /est[áa]s?\s*(mal|equivocad|incorrecto)/i,
  /eso no\s*(es|está)/i,
  /no\s*era?\s*(eso|así)/i,
  /te equivocas/i,
  /corrección|correction/i,
  // English corrections
  /that'?s?\s*(wrong|incorrect|not right)/i,
  /actually,?\s*(I meant|it'?s)/i,
  // Behavioral instructions (these should also trigger directive creation)
  /a partir de ahora/i,
  /de ahora en adelante/i,
  /nunca\s+(más\s+)?(me |lo |la |les |hagas|vuelvas|envíes|mandes)/i,
  /siempre\s+(que|debes|tienes|haz)/i,
  /deja\s+de/i,
  /no\s+(me\s+)?(hagas|envíes|mandes|notifiques|avises)/i,
  /no\s+quiero\s+que/i,
  /para\s+de|detén|detente/i,
  /from now on/i,
  /stop\s+(doing|sending|notifying)/i,
  /don'?t\s+ever/i,
  /never\s+(again|do|send|notify)/i,
  /always\s+(do|use|respond|answer)/i,
];

/**
 * Check if a user message looks like a correction or behavioral instruction.
 */
export function isCorrection(text: string): boolean {
  return CORRECTION_PATTERNS.some((p) => p.test(text));
}

/**
 * Extract a lesson from a correction exchange.
 * Uses structured format for better retrieval.
 */
export async function extractLesson(
  previousResponse: string,
  userCorrection: string
): Promise<string> {
  // Build a structured lesson that's easy to retrieve and apply
  const prevTruncated = previousResponse.slice(0, 300).replace(/\n/g, " ");
  const corrTruncated = userCorrection.slice(0, 400).replace(/\n/g, " ");

  return `CORRECTION: My response "${prevTruncated}" was wrong/unwanted. User said: "${corrTruncated}". RULE: ${corrTruncated}`;
}
