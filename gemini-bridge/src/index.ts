import "dotenv/config";
import { Bot } from "grammy";
import { spawn, type ChildProcess } from "child_process";

// ── Config ──────────────────────────────────────────────

const BOT_TOKEN = process.env.BRIDGE_BOT_TOKEN!;
const ALLOWED_USER_ID = Number(process.env.ALLOWED_USER_ID);
const WORKSPACE = process.env.GEMINI_WORKSPACE || "/home/molt_user/projects";

if (!BOT_TOKEN) throw new Error("Missing BRIDGE_BOT_TOKEN");
if (!ALLOWED_USER_ID) throw new Error("Missing ALLOWED_USER_ID");

// ── Active Sessions ─────────────────────────────────────

interface GeminiSession {
  process: ChildProcess;
  chatId: number;
  buffer: string;
  timeout: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<number, GeminiSession>();

// ── Bot ─────────────────────────────────────────────────

const bot = new Bot(BOT_TOKEN);

console.log(`
  💻 G E M I N I   D E V   B O T
  ────────────────────────────────
  Coding partner via Telegram
  Powered by Gemini CLI
  ────────────────────────────────
`);

// Security: only allow owner
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ALLOWED_USER_ID) return;
  await next();
});

// ── Commands ────────────────────────────────────────────

bot.command("start", async (ctx) => {
  await ctx.reply(
    `💻 *Gemini Dev Bot online*\n\n` +
      `I'm your coding partner powered by Gemini CLI\\.\n` +
      `Send me any coding task and I'll handle it\\.\n\n` +
      `Commands:\n` +
      `/project \\<path\\> — set working directory\n` +
      `/stop — kill active session\n` +
      `/codex \\<task\\> — run via Codex instead`,
    { parse_mode: "MarkdownV2" }
  );
});

bot.command("stop", async (ctx) => {
  const session = sessions.get(ctx.chat.id);
  if (session) {
    session.process.kill();
    sessions.delete(ctx.chat.id);
    await ctx.reply("🛑 Gemini session killed.");
  } else {
    await ctx.reply("No active session.");
  }
});

bot.command("codex", async (ctx) => {
  const task = ctx.match;
  if (!task) {
    await ctx.reply("Usage: /codex <task description>");
    return;
  }
  await runExternalAgent(ctx.chat.id, "codex", [task], ctx);
});

// ── Message Handler ─────────────────────────────────────

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const message = ctx.message.text;

  // Kill existing session if any
  const existing = sessions.get(chatId);
  if (existing) {
    existing.process.kill();
    sessions.delete(chatId);
  }

  await ctx.replyWithChatAction("typing");
  await ctx.reply("🔄 Starting Gemini CLI...");

  try {
    await runGemini(chatId, message, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ Error: ${msg}`);
  }
});

// ── Gemini CLI Runner ───────────────────────────────────

async function runGemini(chatId: number, task: string, ctx: any): Promise<void> {
  const gemini = spawn("gemini", ["-p", task], {
    cwd: WORKSPACE,
    env: { ...process.env, TERM: "dumb" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let output = "";
  let lastSendLength = 0;

  const session: GeminiSession = {
    process: gemini,
    chatId,
    buffer: "",
    timeout: null,
  };
  sessions.set(chatId, session);

  // Debounced send — wait for output to stabilize before sending
  function scheduleSend() {
    if (session.timeout) clearTimeout(session.timeout);
    session.timeout = setTimeout(async () => {
      const newContent = output.slice(lastSendLength);
      if (newContent.trim().length > 0) {
        // Split long messages
        const chunks = splitMessage(newContent.trim(), 4000);
        for (const chunk of chunks) {
          try {
            await bot.api.sendMessage(chatId, chunk);
          } catch { /* ignore send errors */ }
        }
        lastSendLength = output.length;
      }
    }, 2000); // Wait 2s after last output
  }

  gemini.stdout?.on("data", (data: Buffer) => {
    output += data.toString();
    scheduleSend();
  });

  gemini.stderr?.on("data", (data: Buffer) => {
    output += data.toString();
    scheduleSend();
  });

  gemini.on("close", async (code) => {
    sessions.delete(chatId);

    // Send any remaining output
    const remaining = output.slice(lastSendLength).trim();
    if (remaining.length > 0) {
      const chunks = splitMessage(remaining, 4000);
      for (const chunk of chunks) {
        try {
          await bot.api.sendMessage(chatId, chunk);
        } catch { /* ignore */ }
      }
    }

    await bot.api.sendMessage(chatId, `✅ Gemini CLI finished (exit code: ${code})`);
  });

  // Timeout: kill after 5 minutes
  setTimeout(() => {
    if (sessions.has(chatId)) {
      gemini.kill();
      sessions.delete(chatId);
      bot.api.sendMessage(chatId, "⏰ Session timed out (5 min limit)").catch(() => {});
    }
  }, 5 * 60 * 1000);
}

// ── External Agent Runner (Codex, etc.) ─────────────────

async function runExternalAgent(
  chatId: number,
  command: string,
  args: string[],
  ctx: any
): Promise<void> {
  await ctx.reply(`🔄 Starting ${command}...`);

  const proc = spawn(command, args, {
    cwd: WORKSPACE,
    env: { ...process.env, TERM: "dumb" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let output = "";

  proc.stdout?.on("data", (data: Buffer) => {
    output += data.toString();
  });

  proc.stderr?.on("data", (data: Buffer) => {
    output += data.toString();
  });

  proc.on("close", async (code) => {
    const chunks = splitMessage(output.trim() || "No output", 4000);
    for (const chunk of chunks) {
      try {
        await bot.api.sendMessage(chatId, chunk);
      } catch { /* ignore */ }
    }
    await bot.api.sendMessage(chatId, `✅ ${command} finished (exit code: ${code})`);
  });

  setTimeout(() => {
    proc.kill();
    bot.api.sendMessage(chatId, `⏰ ${command} timed out`).catch(() => {});
  }, 5 * 60 * 1000);
}

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
    if (splitAt < maxLen * 0.3) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

// ── Start ───────────────────────────────────────────────

bot.start({
  onStart: (info) => console.log(`✅ Gemini Dev Bot online as @${info.username}`),
  drop_pending_updates: true,
});
