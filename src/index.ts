import { bot } from "./bot.js";
import { log } from "./logger.js";
import { initDatabase, shutdown as dbShutdown } from "./db.js";

// ── Banner ──────────────────────────────────────────────

console.log(`
   ⚡ G R A V I T Y   C L A W ⚡
   ─────────────────────────────
   Personal AI Agent · Level 3
   Telegram + Gemini + Memory + Voice
   ─────────────────────────────
`);

// ── Start Bot ───────────────────────────────────────────

async function main() {
  log.info("Starting Gravity Claw...");

  // Initialize database (creates tables if needed)
  await initDatabase();

  // grammY long-polling — no webhook, no exposed port
  bot.start({
    onStart: (botInfo) => {
      log.info(
        { username: botInfo.username, id: botInfo.id },
        `✅ Bot online as @${botInfo.username}`
      );
    },
    drop_pending_updates: true,
  });
}

// ── Graceful Shutdown ───────────────────────────────────

async function shutdown(signal: string) {
  log.info({ signal }, "Shutting down...");
  bot.stop();
  await dbShutdown();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Handle uncaught errors (don't crash on a single failed message)
process.on("unhandledRejection", (err) => {
  log.error({ err }, "Unhandled rejection");
});

process.on("uncaughtException", (err) => {
  log.fatal({ err }, "Uncaught exception — shutting down");
  shutdown("uncaughtException");
});

// ── Go ──────────────────────────────────────────────────

main().catch((err) => {
  log.fatal({ err }, "Fatal error during startup");
  process.exit(1);
});
