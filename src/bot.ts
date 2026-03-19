import { Bot } from "grammy";
import { config } from "./config.js";
import { log } from "./logger.js";
import { runAgent, runVoiceAgent, clearHistory } from "./agent.js";
import { downloadTelegramFile } from "./voice.js";

// ── Bot Instance ────────────────────────────────────────

export const bot = new Bot(config.telegramBotToken);

// ── Security Middleware (FIRST — before anything else) ──

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;

  // No user ID = system event or channel post → ignore
  if (!userId) return;

  // Whitelist check — silently drop non-whitelisted users
  if (!config.allowedUserIds.includes(userId)) {
    log.warn({ userId, username: ctx.from?.username }, "Blocked unauthorized user");
    return; // silent drop — no response, no error
  }

  await next();
});

// ── Commands ────────────────────────────────────────────

bot.command("start", async (ctx) => {
  await ctx.reply(
    "⚡ *Gravity Claw online.*\\n\\n" +
      "I'm your personal AI agent powered by Gemini\\.\\n" +
      "Just send me a message and I'll respond\\.\\n\\n" +
      "Commands:\\n" +
      "/clear — reset conversation memory\\n" +
      "/ping — check if I'm alive",
    { parse_mode: "MarkdownV2" }
  );
});

bot.command("clear", async (ctx) => {
  clearHistory(ctx.chat.id);
  await ctx.reply("🧹 Conversation history cleared. Fresh start!");
});

bot.command("ping", async (ctx) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  await ctx.reply(`🏓 Pong! Uptime: ${hours}h ${minutes}m`);
});

// ── Message Handler ─────────────────────────────────────

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userMessage = ctx.message.text;

  log.info(
    { chatId, messageLength: userMessage.length },
    "Incoming message"
  );

  // Show typing indicator while processing
  await ctx.replyWithChatAction("typing");

  try {
    const response = await runAgent(chatId, userMessage);

    // Telegram has a 4096 character limit per message
    const chunks = splitMessage(response.text, 4096);
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  } catch (err) {
    log.error({ err, chatId }, "Agent error");
    const errorMsg = err instanceof Error ? err.message : String(err);
    await ctx.reply(
      `⚠️ Error: ${errorMsg.slice(0, 500)}`
    );
  }
});

// ── Voice Handler ───────────────────────────────────────

bot.on(["message:voice", "message:video_note"], async (ctx) => {
  const chatId = ctx.chat.id;
  const fileId = ctx.message.voice?.file_id ?? ctx.message.video_note?.file_id;

  if (!fileId) return;

  log.info({ chatId, type: ctx.message.voice ? "voice" : "video_note" }, "Incoming voice message");

  await ctx.replyWithChatAction("typing");

  try {
    const { buffer, mimeType } = await downloadTelegramFile(fileId);
    const response = await runVoiceAgent(chatId, buffer, mimeType);

    const chunks = splitMessage(response.text, 4096);
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  } catch (err) {
    log.error({ err, chatId }, "Voice agent error");
    const errorMsg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`⚠️ Error processing voice: ${errorMsg.slice(0, 500)}`);
  }
});

// ── Helpers ─────────────────────────────────────────────

/** Split a long message into chunks respecting Telegram's limit */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to break at a newline
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt === -1 || splitAt < maxLen * 0.5) {
      // Fall back to breaking at a space
      splitAt = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitAt === -1 || splitAt < maxLen * 0.5) {
      // Hard cut as last resort
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
