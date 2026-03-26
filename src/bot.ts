import { Bot, InputFile } from "grammy";
import { config } from "./config.js";
import { log } from "./logger.js";
import { runAgent, runVoiceAgent, clearHistory } from "./agent.js";
import { downloadTelegramFile } from "./voice.js";
import { generateSpeech } from "./tts.js";
import { getRegisteredTools } from "./tools/registry.js";
import { pool } from "./db.js";
import { getTopicConfig } from "./topics.js";
import { getActiveDirectives } from "./directives.js";
import * as fs from "fs/promises";

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

// ── Helper: extract thread ID from context ──────────────

function getThreadId(ctx: { message?: { message_thread_id?: number } }): number | undefined {
  return ctx.message?.message_thread_id;
}

// ── Helper: reply in the correct topic thread ───────────

async function replyInThread(
  ctx: { reply: (text: string, options?: Record<string, unknown>) => Promise<unknown> },
  text: string,
  threadId?: number
): Promise<void> {
  await ctx.reply(text, threadId ? { message_thread_id: threadId } : {});
}

async function replyDocumentInThread(
  ctx: { replyWithDocument: (doc: InputFile, options?: Record<string, unknown>) => Promise<unknown> },
  doc: InputFile,
  threadId?: number
): Promise<void> {
  await ctx.replyWithDocument(doc, threadId ? { message_thread_id: threadId } : {});
}

// ── Commands ────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const threadId = getThreadId(ctx);
  const topicConfig = getTopicConfig(threadId);
  const topicInfo = topicConfig ? ` (Topic: ${topicConfig.emoji} ${topicConfig.name})` : "";

  const tools = getRegisteredTools();
  await replyInThread(
    ctx,
    `⚡ *Gravity Claw online \\(Level 7\\)*${topicInfo ? ` — ${topicInfo}` : ""}\\n\\n` +
      `I'm your personal AI agent with ${tools.length} tools and multi\\-model sub\\-agents\\.\\n` +
      `Send me a message, voice note, or ask me to use my tools\\.\\n\\n` +
      `Commands:\\n` +
      `/clear — reset conversation memory\\n` +
      `/ping — check if I'm alive\\n` +
      `/tools — list available tools\\n` +
      `/tasks — sub\\-agent task status\\n` +
      `/status — server health\\n` +
      `/heartbeat — heartbeat info`,
    threadId
  );
});

bot.command("clear", async (ctx) => {
  const threadId = getThreadId(ctx);
  await clearHistory(ctx.chat.id, threadId);
  const topicConfig = getTopicConfig(threadId);
  const topicName = topicConfig ? ` for topic "${topicConfig.name}"` : "";
  await replyInThread(ctx, `🧹 Conversation history cleared${topicName}. Fresh start!`, threadId);
});

bot.command("ping", async (ctx) => {
  const threadId = getThreadId(ctx);
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  await replyInThread(ctx, `🏓 Pong! Uptime: ${hours}h ${minutes}m`, threadId);
});

bot.command("tools", async (ctx) => {
  const threadId = getThreadId(ctx);
  const tools = getRegisteredTools();
  await replyInThread(
    ctx,
    `🛠️ Available tools (${tools.length}):\n\n` +
      tools.map((t) => `• ${t}`).join("\n"),
    threadId
  );
});

bot.command("status", async (ctx) => {
  const threadId = getThreadId(ctx);
  const { getHealthStatus } = await import("./heartbeat.js");
  const status = await getHealthStatus();
  await replyInThread(ctx, status, threadId);
});

bot.command("directives", async (ctx) => {
  const threadId = getThreadId(ctx);
  try {
    const directives = await getActiveDirectives();
    if (directives.length === 0) {
      await replyInThread(ctx, "🧠 No active directives yet. Teach me something!", threadId);
      return;
    }

    const grouped = new Map<string, typeof directives>();
    for (const d of directives) {
      const list = grouped.get(d.category) ?? [];
      list.push(d);
      grouped.set(d.category, list);
    }

    let msg = `🧠 **Active Directives** (${directives.length})\n\n`;
    for (const [category, dirs] of grouped) {
      msg += `**[${category.toUpperCase()}]**\n`;
      for (const d of dirs) {
        msg += `• \`${d.key}\`: ${d.content} _(${d.source})_\n`;
      }
      msg += "\n";
    }

    await replyInThread(ctx, msg.trim(), threadId);
  } catch (err) {
    await replyInThread(ctx, "❌ Failed to load directives.", threadId);
  }
});

bot.command("brain", async (ctx) => {
  const threadId = getThreadId(ctx);
  const brainDir = "/home/claw/workspace/brain";
  const files = ["soul.md", "skills.md", "notes.md"];

  let msg = "🧠 **Brain Files**\n\n";
  for (const file of files) {
    try {
      const content = await fs.readFile(`${brainDir}/${file}`, "utf-8");
      const lines = content.split("\n").length;
      const size = content.length;
      msg += `📄 **${file}** — ${lines} lines, ${size} chars\n`;
    } catch {
      msg += `📄 **${file}** — not created yet\n`;
    }
  }

  try {
    const directives = await getActiveDirectives();
    msg += `\n🔧 Active directives: ${directives.length}`;
  } catch { /* ignore */ }

  await replyInThread(ctx, msg.trim(), threadId);
});

bot.command("heartbeat", async (ctx) => {
  const threadId = getThreadId(ctx);
  await replyInThread(
    ctx,
    `💓 **Heartbeats activos:**\n\n` +
      `🌅 Buenos días — 8:00 AM → topic General\n` +
      `🖥️ Health check — cada 6 horas → topic logs y memoria\n` +
      `📊 Resumen del día — 10:00 PM → topic logs y memoria\n\n` +
      `Timezone: ${config.timezone}\n` +
      `Chat ID: ${config.heartbeatChatId || "⚠️ No configurado"}`,
    threadId
  );
});

bot.command("tasks", async (ctx) => {
  const threadId = getThreadId(ctx);

  try {
    const res = await pool.query(
      `SELECT id, agent, mode, model, status, 
              LEFT(task, 80) as task_preview,
              created_at, completed_at
       FROM tasks 
       WHERE chat_id = $1 AND thread_id IS NOT DISTINCT FROM $2
       ORDER BY created_at DESC 
       LIMIT 10`,
      [ctx.chat.id, threadId ?? null]
    );

    if (res.rows.length === 0) {
      await replyInThread(ctx, "📋 No delegated tasks yet. Ask me to investigate or analyze something!", threadId);
      return;
    }

    const statusEmoji: Record<string, string> = {
      queued: "⏳",
      running: "🔄",
      done: "✅",
      failed: "❌",
    };

    const lines = res.rows.map((r) => {
      const emoji = statusEmoji[r.status as string] ?? "❓";
      return `${emoji} #${r.id} ${r.agent} (${r.model})\n   ${r.status} | ${r.task_preview}`;
    });

    await replyInThread(ctx, `📋 Recent sub-agent tasks:\n\n${lines.join("\n\n")}`, threadId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await replyInThread(ctx, `⚠️ Error: ${msg}`, threadId);
  }
});

// ── Message Handler ─────────────────────────────────────

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userMessage = ctx.message.text;
  const threadId = getThreadId(ctx);

  log.info(
    { chatId, threadId, messageLength: userMessage.length },
    "Incoming message"
  );

  await ctx.replyWithChatAction("typing");

  try {
    const response = await runAgent(chatId, userMessage, threadId);

    // Send text response in the correct topic
    const chunks = splitMessage(response.text, 4096);
    for (const chunk of chunks) {
      await replyInThread(ctx, chunk, threadId);
    }

    // Send any files the tools generated
    if (response.files && response.files.length > 0) {
      for (const file of response.files) {
        await replyDocumentInThread(ctx, new InputFile(file.buffer, file.filename), threadId);
      }
    }
  } catch (err) {
    log.error({ err, chatId, threadId }, "Agent error");
    const errorMsg = err instanceof Error ? err.message : String(err);
    await replyInThread(
      ctx,
      `⚠️ Error: ${errorMsg.slice(0, 500)}`,
      threadId
    );
  }
});

// ── Voice Handler ───────────────────────────────────────

bot.on(["message:voice", "message:video_note"], async (ctx) => {
  const chatId = ctx.chat.id;
  const threadId = getThreadId(ctx);
  const fileId = ctx.message.voice?.file_id ?? ctx.message.video_note?.file_id;

  if (!fileId) return;

  log.info({ chatId, threadId, type: ctx.message.voice ? "voice" : "video_note" }, "Incoming voice message");

  await ctx.replyWithChatAction("typing");

  try {
    const { buffer, mimeType } = await downloadTelegramFile(fileId);
    const response = await runVoiceAgent(chatId, buffer, mimeType, threadId);

    // 1. Reply with the text chunks (transcription + response)
    const chunks = splitMessage(response.text, 4096);
    for (const chunk of chunks) {
      await replyInThread(ctx, chunk, threadId);
    }

    // 2. Synthesize and reply with voice
    try {
      await ctx.replyWithChatAction("record_voice");
      const audioBuffer = await generateSpeech(response.text);
      await ctx.replyWithVoice(
        new InputFile(audioBuffer, "response.ogg"), 
        threadId ? { message_thread_id: threadId } : {}
      );
    } catch (ttsErr) {
      log.error({ ttsErr, chatId, threadId }, "TTS Generation error");
    }
  } catch (err) {
    log.error({ err, chatId, threadId }, "Voice agent error");
    const errorMsg = err instanceof Error ? err.message : String(err);
    await replyInThread(ctx, `⚠️ Error processing voice: ${errorMsg.slice(0, 500)}`, threadId);
  }
});

// ── Document Handler (files sent to bot) ────────────────

bot.on("message:document", async (ctx) => {
  const chatId = ctx.chat.id;
  const threadId = getThreadId(ctx);
  const doc = ctx.message.document;

  if (!doc) return;

  log.info({ chatId, threadId, filename: doc.file_name, mimeType: doc.mime_type }, "Document received");

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

    // Inform the agent about the file (thread-aware)
    const response = await runAgent(
      chatId,
      `[The user sent a file: "${filename}" (${doc.mime_type}, ${Math.round(buffer.length / 1024)}KB). It has been saved to the workspace at "${filename}". ${ctx.message.caption || ""}]`,
      threadId
    );

    const chunks = splitMessage(response.text, 4096);
    for (const chunk of chunks) {
      await replyInThread(ctx, chunk, threadId);
    }

    if (response.files && response.files.length > 0) {
      for (const file of response.files) {
        await replyDocumentInThread(ctx, new InputFile(file.buffer, file.filename), threadId);
      }
    }
  } catch (err) {
    log.error({ err, chatId, threadId }, "Document handler error");
    const errorMsg = err instanceof Error ? err.message : String(err);
    await replyInThread(ctx, `⚠️ Error: ${errorMsg.slice(0, 500)}`, threadId);
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
