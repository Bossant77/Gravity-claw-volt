import { query } from "../db.js";
import { log } from "../logger.js";
import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";
import type { Bot } from "grammy";

let botRef: Bot | null = null;

/**
 * Set the bot reference so reminders can send messages.
 */
export function setReminderBot(bot: Bot): void {
  botRef = bot;
}

/**
 * Start the reminder scheduler — checks every 60 seconds for due reminders.
 */
export function startReminderScheduler(): void {
  log.info("Reminder scheduler started (checks every 60s)");

  setInterval(async () => {
    try {
      const result = await query<{
        id: number;
        chat_id: string;
        thread_id: number | null;
        message: string;
      }>(
        `SELECT id, chat_id, thread_id, message FROM reminders
         WHERE due_at <= NOW() AND delivered = false`,
        []
      );

      log.debug(
        { pendingCount: result.rows.length },
        "⏰ Reminder scheduler tick"
      );

      for (const row of result.rows) {
        if (botRef) {
          try {
            await botRef.api.sendMessage(
              Number(row.chat_id),
              `⏰ **Reminder:**\n${row.message}`,
              row.thread_id ? { message_thread_id: row.thread_id } : {}
            );
            await query("UPDATE reminders SET delivered = true WHERE id = $1", [row.id]);
            log.info({ reminderId: row.id, threadId: row.thread_id }, "Reminder delivered");
          } catch (err) {
            log.error({ err, reminderId: row.id }, "Failed to deliver reminder");
          }
        }
      }
    } catch (err) {
      log.error({ err }, "Reminder scheduler error");
    }
  }, 60_000);
}

export function registerRemindersTool(): void {
  registerTool({
    name: "set_reminder",
    description:
      "Set a reminder that will be sent as a Telegram message at the specified time. Supports relative times like '5 minutes', '1 hour', '2 days'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        message: {
          type: SchemaType.STRING,
          description: "The reminder message to send",
        },
        minutes_from_now: {
          type: SchemaType.NUMBER,
          description: "Number of minutes from now to send the reminder",
        },
      },
      required: ["message", "minutes_from_now"],
    },
    handler: async (args) => {
      const message = String(args.message);
      const minutes = Number(args.minutes_from_now);

      if (isNaN(minutes) || minutes <= 0) {
        return { result: "Error: minutes_from_now must be a positive number" };
      }

      // Use context chatId and threadId which will be injected
      const chatId = (args as Record<string, unknown>).__chatId ?? 0;
      const threadId = (args as Record<string, unknown>).__threadId ?? null;

      await query(
        `INSERT INTO reminders (chat_id, thread_id, message, due_at, delivered)
         VALUES ($1, $2, $3, NOW() + INTERVAL '1 minute' * $4, false)`,
        [chatId, threadId, message, minutes]
      );

      const dueTime = new Date(Date.now() + minutes * 60_000);
      return {
        result: `Reminder set for ${dueTime.toLocaleTimeString()} (in ${minutes} minutes): "${message}"`,
      };
    },
  });

  registerTool({
    name: "list_reminders",
    description: "List all active (undelivered) reminders.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
    handler: async (args) => {
      const chatId = (args as Record<string, unknown>).__chatId ?? 0;

      const result = await query<{ id: number; message: string; due_at: Date }>(
        `SELECT id, message, due_at FROM reminders
         WHERE chat_id = $1 AND delivered = false
         ORDER BY due_at ASC`,
        [chatId]
      );

      if (result.rows.length === 0) {
        return { result: "No active reminders." };
      }

      const lines = result.rows.map(
        (r: { id: number; message: string; due_at: Date }) => `#${r.id} — ${new Date(r.due_at).toLocaleString()}: ${r.message}`
      );
      return { result: `Active reminders:\n${lines.join("\n")}` };
    },
  });

  registerTool({
    name: "cancel_reminder",
    description: "Cancel an active reminder by its ID.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        reminder_id: {
          type: SchemaType.NUMBER,
          description: "The ID of the reminder to cancel",
        },
      },
      required: ["reminder_id"],
    },
    handler: async (args) => {
      const id = Number(args.reminder_id);
      const result = await query(
        "DELETE FROM reminders WHERE id = $1 AND delivered = false",
        [id]
      );

      if (result.rowCount === 0) {
        return { result: `No active reminder found with ID ${id}` };
      }
      return { result: `Reminder #${id} cancelled.` };
    },
  });
}
