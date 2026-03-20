import "dotenv/config";
import { Bot } from "grammy";
import { spawn, type ChildProcess } from "child_process";

// ── Config ──────────────────────────────────────────────

const BOT_TOKEN = process.env.BRIDGE_BOT_TOKEN!;
const ALLOWED_USER_ID = Number(process.env.ALLOWED_USER_ID);
const WORKSPACE = process.env.GEMINI_WORKSPACE || "/home/molt_user/projects";

if (!BOT_TOKEN) throw new Error("Missing BRIDGE_BOT_TOKEN");
if (!ALLOWED_USER_ID) throw new Error("Missing ALLOWED_USER_ID");

// ── Topic Filtering ─────────────────────────────────────
// Only respond in these forum topics (by thread ID).
// academia = 42, Projects = 40
const ALLOWED_THREAD_IDS = new Set<number>([
  40,  // Projects
  42,  // academia
]);

// ── Active Sessions ─────────────────────────────────────

interface GeminiSession {
  process: ChildProcess;
  chatId: number;
  threadId?: number;
  buffer: string;
  timeout: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, GeminiSession>();

/** Create a unique session key from chatId + threadId */
function sessionKey(chatId: number, threadId?: number): string {
  return `${chatId}:${threadId ?? "dm"}`;
}

// ── Bot ─────────────────────────────────────────────────

const bot = new Bot(BOT_TOKEN);

console.log(`
  💻 G E M I N I   D E V   B O T
  ────────────────────────────────
  Coding partner via Telegram
  Powered by Gemini CLI
  Topics: Projects (#40), academia (#42)
  ────────────────────────────────
`);

// Security: only allow owner
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ALLOWED_USER_ID) return;
  await next();
});

// ── Topic Filter Middleware ─────────────────────────────

bot.use(async (ctx, next) => {
  const threadId = ctx.message?.message_thread_id;

  // In a group with topics: only respond in allowed topics
  if (ctx.chat?.type === "supergroup" && threadId !== undefined) {
    if (!ALLOWED_THREAD_IDS.has(threadId)) {
      // Silently ignore messages in non-allowed topics
      return;
    }
  }

  await next();
});

// ── Helper: send message to correct thread ──────────────

async function sendInThread(chatId: number, text: string, threadId?: number): Promise<void> {
  try {
    await bot.api.sendMessage(chatId, text, threadId ? { message_thread_id: threadId } : {});
  } catch { /* ignore send errors */ }
}

// ── Commands ────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const threadId = ctx.message?.message_thread_id;
  const reply = (text: string) => ctx.reply(text, {
    parse_mode: "MarkdownV2",
    ...(threadId ? { message_thread_id: threadId } : {}),
  });

  await reply(
    `💻 *Gemini Dev Bot online*\n\n` +
      `I'm your coding partner powered by Gemini CLI\\.\n` +
      `Send me any coding task and I'll handle it\\.\n\n` +
      `Commands:\n` +
      `/project \\<path\\> — set working directory\n` +
      `/stop — kill active session\n` +
      `/codex \\<task\\> — run via Codex instead`
  );
});

bot.command("stop", async (ctx) => {
  const threadId = ctx.message?.message_thread_id;
  const key = sessionKey(ctx.chat.id, threadId);
  const session = sessions.get(key);
  if (session) {
    session.process.kill();
    sessions.delete(key);
    await sendInThread(ctx.chat.id, "🛑 Gemini session killed.", threadId);
  } else {
    await sendInThread(ctx.chat.id, "No active session.", threadId);
  }
});

bot.command("codex", async (ctx) => {
  const task = ctx.match;
  const threadId = ctx.message?.message_thread_id;
  if (!task) {
    await sendInThread(ctx.chat.id, "Usage: /codex <task description>", threadId);
    return;
  }
  await runExternalAgent(ctx.chat.id, "codex", [task], ctx, threadId);
});

// ── Message Handler ─────────────────────────────────────

bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const message = ctx.message.text;
  const threadId = ctx.message?.message_thread_id;
  const key = sessionKey(chatId, threadId);

  // Kill existing session if any
  const existing = sessions.get(key);
  if (existing) {
    existing.process.kill();
    sessions.delete(key);
  }

  await ctx.replyWithChatAction("typing");
  await sendInThread(chatId, "🔄 Starting Gemini CLI...", threadId);

  try {
    await runGemini(chatId, message, ctx, threadId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendInThread(chatId, `❌ Error: ${msg}`, threadId);
  }
});

// ── Gemini CLI Runner ───────────────────────────────────

async function runGemini(chatId: number, task: string, ctx: any, threadId?: number): Promise<void> {
  const gemini = spawn("gemini", ["-p", task], {
    cwd: WORKSPACE,
    env: { ...process.env, TERM: "dumb" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let output = "";
  let lastSendLength = 0;
  const key = sessionKey(chatId, threadId);

  const session: GeminiSession = {
    process: gemini,
    chatId,
    threadId,
    buffer: "",
    timeout: null,
  };
  sessions.set(key, session);

  // Debounced send — wait for output to stabilize before sending
  function scheduleSend() {
    if (session.timeout) clearTimeout(session.timeout);
    session.timeout = setTimeout(async () => {
      const newContent = output.slice(lastSendLength);
      if (newContent.trim().length > 0) {
        // Split long messages
        const chunks = splitMessage(newContent.trim(), 4000);
        for (const chunk of chunks) {
          await sendInThread(chatId, chunk, threadId);
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
    sessions.delete(key);

    // Send any remaining output
    const remaining = output.slice(lastSendLength).trim();
    if (remaining.length > 0) {
      const chunks = splitMessage(remaining, 4000);
      for (const chunk of chunks) {
        await sendInThread(chatId, chunk, threadId);
      }
    }

    await sendInThread(chatId, `✅ Gemini CLI finished (exit code: ${code})`, threadId);
  });

  // Timeout: kill after 5 minutes
  setTimeout(() => {
    if (sessions.has(key)) {
      gemini.kill();
      sessions.delete(key);
      sendInThread(chatId, "⏰ Session timed out (5 min limit)", threadId);
    }
  }, 5 * 60 * 1000);
}

// ── External Agent Runner (Codex, etc.) ─────────────────

async function runExternalAgent(
  chatId: number,
  command: string,
  args: string[],
  ctx: any,
  threadId?: number
): Promise<void> {
  await sendInThread(chatId, `🔄 Starting ${command}...`, threadId);

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
      await sendInThread(chatId, chunk, threadId);
    }
    await sendInThread(chatId, `✅ ${command} finished (exit code: ${code})`, threadId);
  });

  setTimeout(() => {
    proc.kill();
    sendInThread(chatId, `⏰ ${command} timed out`, threadId);
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
