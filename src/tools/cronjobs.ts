import { query } from "../db.js";
import { log } from "../logger.js";
import { config } from "../config.js";
import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";
import type { Bot } from "grammy";

let botRef: Bot | null = null;

// ── Public API ──────────────────────────────────────────

/**
 * Set the bot reference so cron jobs can send messages.
 */
export function setCronJobBot(bot: Bot): void {
  botRef = bot;
}

/**
 * Start the cron job scheduler — checks every 60 seconds for matching jobs.
 */
export function startCronScheduler(): void {
  log.info("🔄 Cron scheduler started (checks every 60s)");

  setInterval(async () => {
    try {
      const now = getNow();
      const result = await query<{
        id: number;
        chat_id: string;
        thread_id: number | null;
        name: string;
        cron_expr: string;
        message: string;
      }>(
        `SELECT id, chat_id, thread_id, name, cron_expr, message
         FROM cron_jobs WHERE enabled = true`,
        []
      );

      log.debug(
        { enabledJobs: result.rows.length, time: now.toLocaleTimeString() },
        "🔄 Cron scheduler tick"
      );

      for (const job of result.rows) {
        if (matchesCron(job.cron_expr, now)) {
          log.info(
            { cronId: job.id, name: job.name, expr: job.cron_expr },
            "🔄 Cron job matched — firing"
          );

          if (botRef) {
            try {
              const opts = job.thread_id
                ? { message_thread_id: job.thread_id }
                : {};
              await botRef.api.sendMessage(
                Number(job.chat_id),
                `🔁 **Cron job** _${job.name}_:\n${job.message}`,
                opts
              );
              await query(
                "UPDATE cron_jobs SET last_run = NOW() WHERE id = $1",
                [job.id]
              );
              log.info({ cronId: job.id, name: job.name }, "🔄 Cron job delivered");
            } catch (err) {
              log.error(
                { err, cronId: job.id, name: job.name },
                "Failed to deliver cron job"
              );
            }
          }
        }
      }
    } catch (err) {
      log.error({ err }, "Cron scheduler error");
    }
  }, 60_000);
}

// ── Cron Expression Parser ──────────────────────────────

/**
 * Parse a single cron field and return the set of valid values.
 * Supports: *, N, A-B, A,B,C, *​/N, A-B/N
 */
function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    const range = stepMatch ? stepMatch[1] : part;

    let start: number;
    let end: number;

    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      start = a;
      end = b;
    } else {
      start = parseInt(range, 10);
      end = start;
    }

    for (let i = start; i <= end; i += step) {
      if (i >= min && i <= max) {
        values.add(i);
      }
    }
  }

  return values;
}

/**
 * Check if a date matches a 5-field cron expression.
 * Format: minute hour day-of-month month day-of-week
 *
 * Day of week: 0 = Sunday, 6 = Saturday
 */
function matchesCron(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    log.warn({ expr }, "Invalid cron expression — expected 5 fields");
    return false;
  }

  const [minF, hourF, domF, monF, dowF] = fields;

  const minutes = parseCronField(minF, 0, 59);
  const hours = parseCronField(hourF, 0, 23);
  const doms = parseCronField(domF, 1, 31);
  const months = parseCronField(monF, 1, 12);
  const dows = parseCronField(dowF, 0, 6);

  return (
    minutes.has(date.getMinutes()) &&
    hours.has(date.getHours()) &&
    doms.has(date.getDate()) &&
    months.has(date.getMonth() + 1) &&
    dows.has(date.getDay())
  );
}

// ── Timezone Helper ─────────────────────────────────────

function getNow(): Date {
  const tz = config.timezone;
  const str = new Date().toLocaleString("en-US", { timeZone: tz });
  return new Date(str);
}

// ── Tool Registration ───────────────────────────────────

export function registerCronJobsTool(): void {
  registerTool({
    name: "create_cron_job",
    description:
      "Create a recurring cron job that sends a Telegram message on schedule. " +
      "Uses standard 5-field cron expressions: minute hour day-of-month month day-of-week. " +
      "Examples: '*/5 * * * *' (every 5 min), '0 9 * * 1-5' (9 AM weekdays), '0 0 1 * *' (1st of month).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: {
          type: SchemaType.STRING,
          description: "Short descriptive name for the cron job",
        },
        cron_expr: {
          type: SchemaType.STRING,
          description:
            "5-field cron expression: minute hour day-of-month month day-of-week",
        },
        message: {
          type: SchemaType.STRING,
          description: "The message to send when the cron job fires",
        },
      },
      required: ["name", "cron_expr", "message"],
    },
    handler: async (args) => {
      const name = String(args.name);
      const cronExpr = String(args.cron_expr);
      const message = String(args.message);
      const chatId = (args as Record<string, unknown>).__chatId ?? 0;
      const threadId =
        (args as Record<string, unknown>).__threadId ?? null;

      // Validate cron expression
      const fields = cronExpr.trim().split(/\s+/);
      if (fields.length !== 5) {
        return {
          result:
            "Error: cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week)",
        };
      }

      await query(
        `INSERT INTO cron_jobs (chat_id, thread_id, name, cron_expr, message)
         VALUES ($1, $2, $3, $4, $5)`,
        [chatId, threadId, name, cronExpr, message]
      );

      log.info(
        { chatId, name, cronExpr },
        "🔄 Cron job created"
      );

      return {
        result: `✅ Cron job "${name}" created with schedule: ${cronExpr}\nMessage: "${message}"`,
      };
    },
    verifier: async (args) => {
      const chatId = (args as Record<string, unknown>).__chatId ?? 0;
      const name = String(args.name);
      const result = await query<{ id: number }>(
        `SELECT id FROM cron_jobs WHERE chat_id = $1 AND name = $2 ORDER BY created_at DESC LIMIT 1`,
        [chatId, name]
      );
      return {
        verified: result.rows.length > 0,
        detail: result.rows.length > 0
          ? `Cron job #${result.rows[0].id} "${name}" confirmed in DB`
          : `No cron job "${name}" found in DB after insert`,
      };
    },
  });

  registerTool({
    name: "list_cron_jobs",
    description: "List all cron jobs (both enabled and disabled).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
    handler: async (args) => {
      const chatId = (args as Record<string, unknown>).__chatId ?? 0;

      const result = await query<{
        id: number;
        name: string;
        cron_expr: string;
        message: string;
        enabled: boolean;
        last_run: Date | null;
      }>(
        `SELECT id, name, cron_expr, message, enabled, last_run
         FROM cron_jobs WHERE chat_id = $1
         ORDER BY created_at ASC`,
        [chatId]
      );

      if (result.rows.length === 0) {
        return { result: "No cron jobs configured." };
      }

      const lines = result.rows.map((r) => {
        const status = r.enabled ? "✅" : "⏸️";
        const lastRun = r.last_run
          ? new Date(r.last_run).toLocaleString()
          : "never";
        return `${status} #${r.id} "${r.name}" — \`${r.cron_expr}\` — Last run: ${lastRun}\n   Message: ${r.message}`;
      });

      return { result: `Cron jobs:\n${lines.join("\n\n")}` };
    },
  });

  registerTool({
    name: "delete_cron_job",
    description: "Delete a cron job by its ID.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        cron_job_id: {
          type: SchemaType.NUMBER,
          description: "The ID of the cron job to delete",
        },
      },
      required: ["cron_job_id"],
    },
    handler: async (args) => {
      const id = Number(args.cron_job_id);

      const result = await query(
        "DELETE FROM cron_jobs WHERE id = $1",
        [id]
      );

      if (result.rowCount === 0) {
        return { result: `No cron job found with ID ${id}` };
      }

      log.info({ cronId: id }, "🔄 Cron job deleted");
      return { result: `Cron job #${id} deleted.` };
    },
  });

  registerTool({
    name: "toggle_cron_job",
    description: "Enable or disable a cron job by its ID without deleting it.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        cron_job_id: {
          type: SchemaType.NUMBER,
          description: "The ID of the cron job to toggle",
        },
        enabled: {
          type: SchemaType.BOOLEAN,
          description: "true to enable, false to disable",
        },
      },
      required: ["cron_job_id", "enabled"],
    },
    handler: async (args) => {
      const id = Number(args.cron_job_id);
      const enabled = Boolean(args.enabled);

      const result = await query(
        "UPDATE cron_jobs SET enabled = $1 WHERE id = $2",
        [enabled, id]
      );

      if (result.rowCount === 0) {
        return { result: `No cron job found with ID ${id}` };
      }

      const status = enabled ? "enabled ✅" : "disabled ⏸️";
      log.info({ cronId: id, enabled }, "🔄 Cron job toggled");
      return { result: `Cron job #${id} ${status}` };
    },
  });
}
