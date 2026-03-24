import { bot } from "./bot.js";
import { log } from "./logger.js";
import { config } from "./config.js";
import { initDatabase, shutdown as dbShutdown } from "./db.js";

// Import tool registrations
import { registerWebSearchTool } from "./tools/web-search.js";
import { registerFoundryTools } from "./tools/foundry.js";
import { registerBrowserTool } from "./tools/browser.js";
import { registerShellTool } from "./tools/shell.js";
import { registerFilesTool } from "./tools/files.js";
import { registerDocumentsTool } from "./tools/documents.js";
import { registerRemindersTool, setReminderBot, startReminderScheduler } from "./tools/reminders.js";
import { registerCronJobsTool, setCronJobBot, startCronScheduler } from "./tools/cronjobs.js";
import { registerEmailTool } from "./tools/email.js";
import { registerDelegateTool } from "./tools/delegate.js";
import { registerSelfTools } from "./tools/self.js";
import { registerCodeEditTools } from "./tools/code-edit.js";
import { setHeartbeatBot, startHeartbeats } from "./heartbeat.js";
import { registerAllAgents } from "./subagents/agents.js";
import { setSubAgentBot } from "./subagents/runner.js";
import { initMcp, shutdownMcp } from "./mcp/client.js";
import { initGmailClients } from "./gmail/client.js";
import { registerGmailTools } from "./gmail/tools.js";
import { setGmailNotificationBot, startGmailNotifications, stopGmailNotifications } from "./gmail/notifications.js";
import { registerListSkills, registerInstallSkill } from "./tools/skill-manager.js";
import { loadSkills } from "./skills.js";

// ── Banner ──────────────────────────────────────────────

console.log(`
   ⚡ G R A V I T Y   C L A W ⚡
   ─────────────────────────────
   Personal AI Agent · Level 9
   Self-Evolution 🧠 · MCP 🔗
   ─────────────────────────────
`);

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ── Register Tools ──────────────────────────────────────

async function loadCustomTools() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const customToolsDir = path.join(__dirname, "tools", "custom");
  
  try {
    await fs.access(customToolsDir);
  } catch {
    // Directory doesn't exist yet, that's fine
    return;
  }

  const files = await fs.readdir(customToolsDir);
  let loadedCount = 0;

  for (const file of files) {
    if (file.endsWith(".js") || file.endsWith(".ts")) {
      try {
        // dynamic import using file:// URL to avoid issues on Windows
        const modulePath = path.join(customToolsDir, file);
        const moduleUrl = `file://${modulePath.replace(/\\/g, "/")}`;
        const customToolModule = await import(moduleUrl);
        
        if (typeof customToolModule.register === "function") {
          customToolModule.register();
          loadedCount++;
        }
      } catch (err) {
        log.error({ file, err }, "Failed to load custom tool");
      }
    }
  }
  
  if (loadedCount > 0) {
    log.info(`Loaded ${loadedCount} custom tool(s) from Foundry.`);
  }
}

async function registerAllTools() {
  registerWebSearchTool();
  registerFoundryTools();
  registerBrowserTool();
  registerShellTool();
  registerFilesTool();
  registerDocumentsTool();
  registerRemindersTool();
  registerEmailTool();
  registerCronJobsTool();
  registerSelfTools();  // 🧠 Self-evolution tools
  registerCodeEditTools();  // 🔧 Code self-edit tools
  registerListSkills();  // 🧩 Skill Ecosystem tools
  registerInstallSkill();

  // Automatically load crystallized tools
  await loadCustomTools();

  // Parse and load installed skills from src/skills
  await loadSkills();

  // Sub-agents must be registered before delegate tool
  registerAllAgents();
  registerDelegateTool();
}

// ── Start Bot ───────────────────────────────────────────

async function main() {
  // Load any custom tools from src/tools/custom
  await loadCustomTools();
  log.info("Starting Gravity Claw...");

  // Initialize database
  await initDatabase();

  // Register all tools
  await registerAllTools();

  // Initialize Gmail API (multi-account)
  initGmailClients();
  registerGmailTools();

  // Initialize MCP servers (discovers and registers external tools)
  await initMcp();

  // Set up reminders
  setReminderBot(bot);
  startReminderScheduler();

  // Set up cron jobs
  setCronJobBot(bot);
  startCronScheduler();

  // Set up heartbeats
  setHeartbeatBot(bot);
  startHeartbeats();

  // Set up sub-agent bot reference (for async result delivery)
  setSubAgentBot(bot);

  // Set up Gmail notifications
  if (config.heartbeatChatId) {
    setGmailNotificationBot(bot, config.heartbeatChatId);
    startGmailNotifications();
  }

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
  stopGmailNotifications();
  await shutdownMcp();
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
