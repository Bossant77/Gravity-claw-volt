import { bot } from "./bot.js";
import { log } from "./logger.js";
import { initDatabase, shutdown as dbShutdown } from "./db.js";

// Import tool registrations
import { registerWebSearchTool } from "./tools/web-search.js";
import { registerBrowserTool } from "./tools/browser.js";
import { registerShellTool } from "./tools/shell.js";
import { registerFilesTool } from "./tools/files.js";
import { registerDocumentsTool } from "./tools/documents.js";
import { registerRemindersTool, setReminderBot, startReminderScheduler } from "./tools/reminders.js";

// ── Banner ──────────────────────────────────────────────

console.log(`
   ⚡ G R A V I T Y   C L A W ⚡
   ─────────────────────────────
   Personal AI Agent · Level 4
   Tools + Memory + Voice
   ─────────────────────────────
`);

// ── Register Tools ──────────────────────────────────────

function registerAllTools() {
  registerWebSearchTool();
  registerBrowserTool();
  registerShellTool();
  registerFilesTool();
  registerDocumentsTool();
  registerRemindersTool();
}

// ── Start Bot ───────────────────────────────────────────

async function main() {
  log.info("Starting Gravity Claw...");

  // Initialize database
  await initDatabase();

  // Register all tools
  registerAllTools();

  // Set up reminders
  setReminderBot(bot);
  startReminderScheduler();

  // grammY long-polling
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
