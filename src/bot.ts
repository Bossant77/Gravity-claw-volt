import { Bot, InputFile } from "grammy";
import { config } from "./config.js";
import { log } from "./logger.js";
import { runAgent, runVoiceAgent, clearHistory } from "./agent.js";
import { downloadTelegramFile } from "./voice.js";
import { getRegisteredTools } from "./tools/registry.js";

// ── Bot Instance ────────────────────────────────────────

export const bot = new Bot(config.telegramBotToken);

// ── Security Middleware (FIRST — before anything else) ──

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;

  if (!userId) return;

  if (!config.allowedUserIds.includes(userId)) {
    log.warn({ userId, username: ctx.from?.username }, "Blocked unauthorized user");
    return;
  }

  await next();
});

// ── Commands ────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const tools = getRegisteredTools();
  await ctx.reply(
    `⚡ *Gravity Claw online \\(Level 5\\)*\n\n` +
      `I'm your personal AI agent with ${tools.length} tools\\.\n` +
      `Send me a message, voice note, or ask me to use my tools\\.\n\n` +
      `Commands:\n` +
      `/clear — reset conversation memory\n` +
      `/ping — check if I'm alive\n` +
      `/tools — list available tools\n` +
      `/status — server health\n` +
      `/heartbeat — heartbeat info`,
    { parse_mode: "MarkdownV2" }
  );
});

bot.command("clear", async (ctx) => {
  await clearHistory(ctx.chat.id);
  await ctx.reply("🧹 Conversation history cleared. Fresh start!");
});

bot.command("ping", async (ctx) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  await ctx.reply(`🏓 Pong! Uptime: ${hours}h ${minutes}m`);
});

bot.command("tools", async (ctx) => {
  const tools = getRegisteredTools();
  await ctx.reply(
    `🛠️ Available tools (${tools.length}):\n\n` +
      tools.map((t) => `• ${t}`).join("\n")
  );
});

bot.command("status", async (ctx) => {
  const { getHealthStatus } = await import("./heartbeat.js");
  const status = await getHealthStatus();
  await ctx.reply(status);
});

bot.command("heartbeat", async (ctx) => {
  await ctx.reply(
    `💓 **Heartbeats activos:**\n\n` +
      `🌅 Buenos días — 8:00 AM\n` +
      `🖥️ Health check — cada 6 horas (alerta si crítico)\n` +
      `📊 Resumen del día — 10:00 PM\n\n` +
      `Timezone: ${config.timezone}\n` +
      `Chat ID: ${config.heartbeatChatId || "⚠️ No configurado"}`
  );
});

// ── Message Handler ─────────────────────────────────────

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userMessage = ctx.message.text;

  log.info(
    { chatId, messageLength: userMessage.length },
    "Incoming message"
  );

  await ctx.replyWithChatAction("typing");

  try {
    const response = await runAgent(chatId, userMessage);

    // Send text response
    const chunks = splitMessage(response.text, 4096);
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }

    // Send any files the tools generated
    if (response.files && response.files.length > 0) {
      for (const file of response.files) {
        await ctx.replyWithDocument(new InputFile(file.buffer, file.filename));
      }
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

// ── Document Handler (files sent to bot) ────────────────

bot.on("message:document", async (ctx) => {
  const chatId = ctx.chat.id;
  const doc = ctx.message.document;

  if (!doc) return;

  log.info({ chatId, filename: doc.file_name, mimeType: doc.mime_type }, "Document received");

  await ctx.replyWithChatAction("typing");

  try {
    // Download the file
    const { buffer } = await downloadTelegramFile(doc.file_id);

    // Save to workspace
    const fs = await import("fs/promises");
    const path = await import("path");
    const workspace = "/home/claw/workspace";
    await fs.mkdir(workspace, { recursive: true });
    const filename = doc.file_name || `file_${Date.now()}`;
    await fs.writeFile(path.join(workspace, filename), buffer);

    // Inform the agent about the file
    const response = await runAgent(
      chatId,
      `[The user sent a file: "${filename}" (${doc.mime_type}, ${Math.round(buffer.length / 1024)}KB). It has been saved to the workspace at "${filename}". ${ctx.message.caption || ""}]`
    );

    const chunks = splitMessage(response.text, 4096);
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }

    if (response.files && response.files.length > 0) {
      for (const file of response.files) {
        await ctx.replyWithDocument(new InputFile(file.buffer, file.filename));
      }
    }
  } catch (err) {
    log.error({ err, chatId }, "Document handler error");
    const errorMsg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`⚠️ Error: ${errorMsg.slice(0, 500)}`);
  }
});

// ── Helpers ─────────────────────────────────────────────

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt === -1 || splitAt < maxLen * 0.5) {
      splitAt = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitAt === -1 || splitAt < maxLen * 0.5) {
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
