import readline from "readline";
import { runAgent } from "./agent.js";
import { gateway } from "./gateway.js";
import { log } from "./logger.js";

/**
 * Terminal Interface (CLI)
 * Allows interaction with Volt entirely from the console, bypassing Telegram.
 */
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "Volt ⚡ > "
});

// Mock ChatID for CLI sessions
const CLI_CHAT_ID = 999999999;

export function startCli() {
  console.log("\nInitialize Volt Local Terminal Session...");
  console.log("Type your prompt and press Enter. Type 'exit' to quit.\n");
  
  rl.prompt();

  rl.on("line", async (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }
    
    if (text.toLowerCase() === "exit" || text.toLowerCase() === "quit") {
      console.log("Disconnecting from matrix...");
      process.exit(0);
    }

    // Publish to the gateway so Mission Control sees it
    gateway.dispatchIncomingMessage("cli", String(CLI_CHAT_ID), text);

    try {
      console.log("...thinking...");
      // The CLI uses a special user structure.
      const fromUser = {
        id: 0,
        username: "Local_Admin",
        first_name: "Admin"
      };

      const reply = await runAgent(CLI_CHAT_ID, text, undefined, fromUser as any);
      console.log(`\nVolt: ${reply.text}\n`);
      
      // Publish the outgoing response to the UI
      gateway.dispatchOutgoingMessage(String(CLI_CHAT_ID), reply.text || "");
      
    } catch (err: any) {
      console.log(`\nError: ${err.message}\n`);
      log.error({ err }, "CLI execution error");
    }

    rl.prompt();
  }).on("close", () => {
    console.log("Shutting down CLI.");
    process.exit(0);
  });
}
