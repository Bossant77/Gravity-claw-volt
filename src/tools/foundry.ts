import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";
import { log } from "../logger.js";
import { config } from "../config.js";

const execAsync = promisify(exec);

// Directories
const REPO_DIR = "/home/claw/workspace/volt-repo";
const CUSTOM_TOOLS_DIR = path.join(REPO_DIR, "src", "tools", "custom");

async function ensureRepo(): Promise<void> {
  try {
    const stat = await fs.stat(REPO_DIR);
  } catch {
    throw new Error(`Repo not cloned. Please use 'code_read' or 'code_edit' first to clone the repo before forging tools.`);
  }
}

async function compileCheck(): Promise<string | null> {
  try {
    await execAsync("npx tsc --noEmit", {
      cwd: REPO_DIR,
      timeout: 60_000,
    });
    return null; // Compilation succeeded
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    const output = (error.stdout || "") + (error.stderr || "");
    return output.slice(0, 3000) || error.message || "Unknown compilation error";
  }
}

export function registerFoundryTools(): void {
  registerTool({
    name: "forge_tool",
    description:
      "The Tool Crystallizer! Use this when you detect a repetitive pattern that could be solved with a dedicated tool. " +
      "This dynamically generates a new tool in src/tools/custom/, validates it with tsc --noEmit, and registers it. " +
      "You must provide the exact TypeScript code for the tool file.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: {
          type: SchemaType.STRING,
          description: "Name of the new tool (e.g. 'github_commits_summary')",
        },
        code: {
          type: SchemaType.STRING,
          description: "The complete TypeScript code for the file. Must export a register() function that calls registerTool().",
        },
      },
      required: ["name", "code"],
    },
    requiresConfirmation: true, // Needs user approval
    handler: async (args) => {
      const toolName = String(args.name);
      const code = String(args.code);

      // Validate safe file name
      if (!/^[a-z0-9_-]+$/.test(toolName)) {
        return { result: "Error: tool name must be alphanumeric with hyphens or underscores only." };
      }

      await ensureRepo();
      await fs.mkdir(CUSTOM_TOOLS_DIR, { recursive: true });

      const fileName = `${toolName}.ts`;
      const fullPath = path.join(CUSTOM_TOOLS_DIR, fileName);

      let originalContent: string | null = null;
      try {
        originalContent = await fs.readFile(fullPath, "utf-8");
      } catch {}

      try {
        await fs.writeFile(fullPath, code, "utf-8");
        log.info({ tool: toolName }, "Foundry: wrote custom tool, checking compilation...");

        const compileErrors = await compileCheck();

        if (compileErrors) {
          log.warn({ tool: toolName }, "Foundry: compilation failed — reverting");
          if (originalContent !== null) {
            await fs.writeFile(fullPath, originalContent, "utf-8");
          } else {
            await fs.unlink(fullPath).catch(() => {});
          }

          return {
            result:
              `❌ FORGING FAILED — COMPILATION ERRORS!\n\n` +
              `TypeScript errors:\n\`\`\`\n${compileErrors}\n\`\`\`\n\n` +
              `The tool was not created. Please completely fix the code and call forge_tool again.`,
          };
        }

        log.info({ tool: toolName }, "Foundry: compilation passed ✅ — committing to git");

        await execAsync(`git add src/tools/custom/${fileName}`, { cwd: REPO_DIR });
        await execAsync(`git commit -m "forge: create auto-generated tool ${toolName}"`, { cwd: REPO_DIR });

        // IMPORTANT
        // Since loadCustomTools uses dynamic import file-level, we can actually try loading it now
        // if we are running in the same codebase! However, since REPO_DIR is the clone, we should 
        // deploy it or the user can tell `code_deploy` to push it to VPS.
        
        return {
          result:
            `✨ TOOL FORGED SUCCESSFULLY! ✨\n\n` +
            `The new tool "${toolName}" has been crystallized in src/tools/custom/${fileName}.\n` +
            `It compiles perfectly and is committed locally.\n` +
            `⚠️ Run \`code_deploy\` to build and restart Volt so the tool becomes available!`,
        };

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Error forging tool: ${msg}` };
      }
    },
  });

  log.info("🔨 Foundry tools registered (forge_tool)");
}
