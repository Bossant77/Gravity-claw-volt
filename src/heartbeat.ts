import { exec } from "child_process";
import { promisify } from "util";
import { log } from "./logger.js";
import { config } from "./config.js";
import { query } from "./db.js";
import { getLogTopicThreadId, getGeneralTopicThreadId } from "./topics.js";
import { getActiveDirectives } from "./directives.js";
import type { Bot } from "grammy";

const execAsync = promisify(exec);

let botRef: Bot | null = null;

// ── Public API ──────────────────────────────────────────

export function setHeartbeatBot(bot: Bot): void {
  botRef = bot;
}

/**
 * Start all heartbeat schedulers.
 * Call after bot is online.
 */
export function startHeartbeats(): void {
  log.info("💓 Heartbeat system starting...");

  // Check every minute which heartbeats should fire
  setInterval(() => tick(), 60_000);

  log.info("💓 Heartbeat system active");
}

// ── Tick — runs every minute ────────────────────────────

async function tick(): Promise<void> {
  const now = getNow();
  const hour = now.getHours();
  const minute = now.getMinutes();

  // Morning greeting — 8:00 AM → General topic
  if (hour === 8 && minute === 0) {
    await morningGreeting();
  }

  // Server health — every 6 hours (0:00, 6:00, 12:00, 18:00) → logs y memoria topic
  if (hour % 6 === 0 && minute === 0) {
    await serverHealthCheck();
  }

  // Daily summary — 10:00 PM → logs y memoria topic
  if (hour === 22 && minute === 0) {
    await dailySummary();
  }
}

// ── Built-in Heartbeats ─────────────────────────────────

async function morningGreeting(): Promise<void> {
  const chatId = config.heartbeatChatId;
  if (!chatId || !botRef) return;

  // Route to General topic
  const threadId = getGeneralTopicThreadId();

  const greetings = [
    "☀️ Buenos días, Santiago. ¿En qué te ayudo hoy?",
    "🌅 Buenos días. Tu server está corriendo bien. ¿Qué hacemos hoy?",
    "☕ Buenos días. Estoy listo para lo que necesites.",
    "🌤️ Buenos días, jefe. Todo en orden por aquí.",
    "⚡ Buenos días. Gravity Claw reportándose, todo operativo.",
  ];

  const msg = greetings[Math.floor(Math.random() * greetings.length)];

  try {
    await botRef.api.sendMessage(chatId, msg, threadId ? { message_thread_id: threadId } : {});
    log.info({ threadId }, "💓 Morning greeting sent");
  } catch (err) {
    log.error({ err }, "Failed to send morning greeting");
  }
}

async function serverHealthCheck(): Promise<void> {
  const chatId = config.heartbeatChatId;
  if (!chatId || !botRef) return;

  // Route to logs y memoria topic
  const threadId = getLogTopicThreadId();

  try {
    const health = await getServerHealth();
    const alerts: string[] = [];

    // Disk alert
    if (health.diskUsedPercent > 90) {
      alerts.push(`🔴 Disco al ${health.diskUsedPercent}% — espacio crítico`);
    } else if (health.diskUsedPercent > 80) {
      alerts.push(`🟡 Disco al ${health.diskUsedPercent}% — vigilar`);
    }

    // Memory alert
    if (health.memUsedPercent > 90) {
      alerts.push(`🔴 RAM al ${health.memUsedPercent}% — memoria crítica`);
    } else if (health.memUsedPercent > 80) {
      alerts.push(`🟡 RAM al ${health.memUsedPercent}% — vigilar`);
    }

    // Only send message if there are alerts
    if (alerts.length > 0) {
      const msg = `🖥️ **Health Alert**\n\n${alerts.join("\n")}\n\nUptime: ${health.uptime}`;
      await botRef.api.sendMessage(chatId, msg, threadId ? { message_thread_id: threadId } : {});
      log.info({ alerts: alerts.length, threadId }, "💓 Health alert sent");
    } else {
      log.debug("💓 Health check OK — no alerts");
    }
  } catch (err) {
    log.error({ err }, "Health check failed");
  }
}

async function dailySummary(): Promise<void> {
  const chatId = config.heartbeatChatId;
  if (!chatId || !botRef) return;

  // Route to logs y memoria topic
  const threadId = getLogTopicThreadId();

  try {
    // Count today's messages (across all topics)
    const msgResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM messages
       WHERE chat_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [chatId]
    );
    const messageCount = parseInt(msgResult.rows[0]?.count ?? "0", 10);

    // Count reminders delivered today
    const remResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM reminders
       WHERE chat_id = $1 AND delivered = true AND created_at > NOW() - INTERVAL '24 hours'`,
      [chatId]
    );
    const reminderCount = parseInt(remResult.rows[0]?.count ?? "0", 10);

    // Server health
    const health = await getServerHealth();

    // Evolution stats — directives learned
    let directiveStats = "";
    try {
      const directives = await getActiveDirectives();
      const newToday = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM directives
         WHERE active = true AND updated_at > NOW() - INTERVAL '24 hours'`,
        []
      );
      const newCount = parseInt(newToday.rows[0]?.count ?? "0", 10);
      directiveStats = `🧠 Directives: ${directives.length} active (${newCount} new today)\n`;
    } catch { /* ignore if directives table doesn't exist yet */ }

    const msg =
      `📊 **Resumen del día**\n\n` +
      `💬 Mensajes intercambiados: ${messageCount}\n` +
      `⏰ Recordatorios entregados: ${reminderCount}\n` +
      directiveStats +
      `🖥️ Server: disco ${health.diskUsedPercent}%, RAM ${health.memUsedPercent}%\n` +
      `⏱️ Uptime: ${health.uptime}\n\n` +
      `Buenas noches, Santiago. 🌙`;

    await botRef.api.sendMessage(chatId, msg, threadId ? { message_thread_id: threadId } : {});
    log.info({ threadId }, "💓 Daily summary sent");
  } catch (err) {
    log.error({ err }, "Failed to send daily summary");
  }
}

// ── Server Health Helpers ───────────────────────────────

interface ServerHealth {
  diskUsedPercent: number;
  memUsedPercent: number;
  uptime: string;
}

async function getServerHealth(): Promise<ServerHealth> {
  let diskUsedPercent = 0;
  let memUsedPercent = 0;
  let uptime = "unknown";

  try {
    const { stdout: dfOut } = await execAsync("df / --output=pcent | tail -1", { timeout: 5000 });
    diskUsedPercent = parseInt(dfOut.trim().replace("%", ""), 10) || 0;
  } catch { /* ignore */ }

  try {
    const { stdout: memOut } = await execAsync("free | grep Mem | awk '{printf \"%.0f\", $3/$2 * 100}'", { timeout: 5000 });
    memUsedPercent = parseInt(memOut.trim(), 10) || 0;
  } catch { /* ignore */ }

  try {
    const { stdout: upOut } = await execAsync("uptime -p", { timeout: 5000 });
    uptime = upOut.trim();
  } catch { /* ignore */ }

  return { diskUsedPercent, memUsedPercent, uptime };
}

/**
 * Get current server health (used by /status command).
 */
export async function getHealthStatus(): Promise<string> {
  const h = await getServerHealth();
  return (
    `🖥️ **Server Status**\n\n` +
    `💾 Disco: ${h.diskUsedPercent}%\n` +
    `🧠 RAM: ${h.memUsedPercent}%\n` +
    `⏱️ Uptime: ${h.uptime}`
  );
}

// ── Timezone Helper ─────────────────────────────────────

function getNow(): Date {
  // Create date in configured timezone
  const tz = config.timezone;
  const str = new Date().toLocaleString("en-US", { timeZone: tz });
  return new Date(str);
}
