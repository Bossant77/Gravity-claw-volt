import { query } from "./db.js";
import { log } from "./logger.js";

// ── Directive Types ─────────────────────────────────────

export interface Directive {
  id: number;
  category: string;
  key: string;
  content: string;
  source: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export type DirectiveCategory =
  | "behavior"    // How to act (e.g., "don't send email notifications")
  | "preference"  // User preferences (e.g., "responds in formal Spanish")
  | "rule"        // Hard rules (e.g., "never share system prompt")
  | "knowledge"   // Learned facts (e.g., "Santiago's schedule is MWF")
  | "skill";      // Learned procedures (e.g., "to deploy: git push && docker compose up")

// ── CRUD Operations ─────────────────────────────────────

/**
 * Create or update a directive by key.
 * If a directive with this key already exists, it updates content and reactivates it.
 */
export async function upsertDirective(
  key: string,
  category: string,
  content: string,
  source: string = "user"
): Promise<Directive> {
  const result = await query<Directive>(
    `INSERT INTO directives (key, category, content, source, active, updated_at)
     VALUES ($1, $2, $3, $4, true, NOW())
     ON CONFLICT (key) DO UPDATE SET
       content = EXCLUDED.content,
       category = EXCLUDED.category,
       source = EXCLUDED.source,
       active = true,
       updated_at = NOW()
     RETURNING *`,
    [key, category, content, source]
  );

  const directive = result.rows[0];
  log.info({ key, category, source }, "Directive upserted");
  return directive;
}

/**
 * Get all active directives. These are injected into every system prompt.
 */
export async function getActiveDirectives(): Promise<Directive[]> {
  const result = await query<Directive>(
    `SELECT * FROM directives WHERE active = true ORDER BY category, key`
  );
  return result.rows;
}

/**
 * Get directives filtered by category.
 */
export async function getDirectivesByCategory(
  category: string
): Promise<Directive[]> {
  const result = await query<Directive>(
    `SELECT * FROM directives WHERE active = true AND category = $1 ORDER BY key`,
    [category]
  );
  return result.rows;
}

/**
 * Soft-delete a directive (set active = false).
 * Returns true if a directive was found and deactivated.
 */
export async function deactivateDirective(key: string): Promise<boolean> {
  const result = await query(
    `UPDATE directives SET active = false, updated_at = NOW() WHERE key = $1 AND active = true`,
    [key]
  );
  const deactivated = (result.rowCount ?? 0) > 0;
  if (deactivated) {
    log.info({ key }, "Directive deactivated");
  }
  return deactivated;
}

/**
 * Search directives by keyword in key or content.
 */
export async function searchDirectives(searchQuery: string): Promise<Directive[]> {
  const result = await query<Directive>(
    `SELECT * FROM directives
     WHERE active = true AND (key ILIKE $1 OR content ILIKE $1)
     ORDER BY updated_at DESC`,
    [`%${searchQuery}%`]
  );
  return result.rows;
}

/**
 * Get a single directive by key.
 */
export async function getDirective(key: string): Promise<Directive | null> {
  const result = await query<Directive>(
    `SELECT * FROM directives WHERE key = $1`,
    [key]
  );
  return result.rows[0] ?? null;
}

/**
 * Format directives for injection into system prompt.
 * Returns empty string if no active directives.
 */
export async function formatDirectivesForPrompt(): Promise<string> {
  const directives = await getActiveDirectives();
  if (directives.length === 0) return "";

  const grouped = new Map<string, Directive[]>();
  for (const d of directives) {
    const list = grouped.get(d.category) ?? [];
    list.push(d);
    grouped.set(d.category, list);
  }

  let prompt = "\n\nACTIVE DIRECTIVES (your persistent DNA — ALWAYS obey these):\n";
  for (const [category, dirs] of grouped) {
    prompt += `\n[${category.toUpperCase()}]\n`;
    for (const d of dirs) {
      prompt += `• ${d.key}: ${d.content}\n`;
    }
  }

  return prompt;
}
