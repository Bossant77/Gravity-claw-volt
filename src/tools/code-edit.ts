import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";
import { log } from "../logger.js";
import { config } from "../config.js";

const execAsync = promisify(exec);

// ── Constants ───────────────────────────────────────────

/** Directory where Volt clones its own repo for self-editing */
const REPO_DIR = "/home/claw/workspace/volt-repo";

/** Source directory inside the cloned repo */
const REPO_SRC = path.join(REPO_DIR, "src");

/** Git remote URL — from config */
const GIT_REPO_URL = config.gitRepoUrl;

const GIT_USER_NAME = config.gitUserName;
const GIT_USER_EMAIL = config.gitUserEmail;

/**
 * Whitelist of file patterns Volt is allowed to edit.
 * Paths are relative to the repo root.
 */
const EDITABLE_PATTERNS = [
  "src/tools/",
  "src/llm.ts",
  "src/config.ts",
  "src/gmail/",
  "src/topics.ts",
  "src/subagents/agents.ts",
  "src/heartbeat.ts",
];

/**
 * Blacklist — files that must NEVER be edited regardless of whitelist.
 * Safety net to protect core agent infrastructure.
 */
const PROTECTED_FILES = [
  "src/index.ts",
  "src/agent.ts",
  "src/bot.ts",
  "src/tools/registry.ts",
  "src/tools/code-edit.ts", // Prevent self-modification paradox
  "src/db.ts",
  "Dockerfile",
  "docker-compose.yml",
  "package.json",
  "tsconfig.json",
];

// ── Helpers ─────────────────────────────────────────────

/**
 * Check if a file path (relative to repo root) is editable.
 */
function isEditable(filePath: string): { allowed: boolean; reason: string } {
  const normalized = filePath.replace(/\\/g, "/");

  // Check blacklist first
  for (const blocked of PROTECTED_FILES) {
    if (normalized === blocked || normalized.endsWith(`/${blocked}`)) {
      return {
        allowed: false,
        reason: `🚫 PROTECTED: "${normalized}" is a core file and cannot be modified. Protected files: ${PROTECTED_FILES.join(", ")}`,
      };
    }
  }

  // Check whitelist
  const inWhitelist = EDITABLE_PATTERNS.some((pattern) => {
    if (pattern.endsWith("/")) {
      return normalized.startsWith(pattern) || normalized.includes(`/${pattern}`);
    }
    return normalized === pattern || normalized.endsWith(`/${pattern}`);
  });

  if (!inWhitelist) {
    return {
      allowed: false,
      reason: `🚫 NOT IN WHITELIST: "${normalized}" is not in the editable files list. Editable patterns: ${EDITABLE_PATTERNS.join(", ")}`,
    };
  }

  return { allowed: true, reason: "ok" };
}

/**
 * Ensure the repo is cloned and up to date.
 */
async function ensureRepo(): Promise<void> {
  try {
    await fs.access(path.join(REPO_DIR, ".git"));
    // Repo exists — pull latest
    await execAsync("git pull origin main --ff-only", {
      cwd: REPO_DIR,
      timeout: 30_000,
    });
    log.info("Self-edit: repo updated via git pull");
  } catch {
    // Repo doesn't exist — clone it
    await fs.mkdir(path.dirname(REPO_DIR), { recursive: true });
    await execAsync(`git clone ${GIT_REPO_URL} ${REPO_DIR}`, {
      timeout: 60_000,
    });
    // Configure git identity
    await execAsync(`git config user.name "${GIT_USER_NAME}"`, { cwd: REPO_DIR });
    await execAsync(`git config user.email "${GIT_USER_EMAIL}"`, { cwd: REPO_DIR });
    log.info("Self-edit: repo cloned successfully");
  }
}

/**
 * Install dependencies in the cloned repo (needed for tsc).
 */
async function ensureDependencies(): Promise<void> {
  const nodeModules = path.join(REPO_DIR, "node_modules");
  try {
    await fs.access(nodeModules);
  } catch {
    log.info("Self-edit: installing dependencies for compilation check...");
    await execAsync("npm ci", { cwd: REPO_DIR, timeout: 120_000 });
    log.info("Self-edit: dependencies installed");
  }
}

/**
 * Run TypeScript compilation check (tsc --noEmit) to validate syntax.
 * Returns null if compilation succeeds, or the error output if it fails.
 */
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
    // Return only the first 3000 chars to avoid overwhelming the LLM
    return output.slice(0, 3000) || error.message || "Unknown compilation error";
  }
}

// ── Tool Registration ───────────────────────────────────

export function registerCodeEditTools(): void {
  // ── code_read ─────────────────────────────────────────
  registerTool({
    name: "code_read",
    description:
      "Read Volt's own source code files. Use this to inspect your current implementation " +
      "before making changes. Returns the file content with line numbers. " +
      "Path should be relative to the repo root (e.g. 'src/tools/email.ts').",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description:
            "Relative path to the file in the repo (e.g. 'src/tools/email.ts', 'src/llm.ts')",
        },
      },
      required: ["path"],
    },
    handler: async (args) => {
      const filePath = String(args.path);

      try {
        await ensureRepo();

        const fullPath = path.join(REPO_DIR, filePath);
        // Security: ensure we stay within repo
        const resolved = path.resolve(fullPath);
        if (!resolved.startsWith(REPO_DIR)) {
          return { result: "Error: path traversal detected — access denied." };
        }

        const stat = await fs.stat(resolved);
        if (stat.size > 200_000) {
          return { result: "Error: file too large (>200KB)." };
        }

        const content = await fs.readFile(resolved, "utf-8");
        const lines = content.split("\n");
        const numbered = lines.map((line, i) => `${i + 1}: ${line}`).join("\n");

        return {
          result: `📄 ${filePath} (${lines.length} lines):\n\n${numbered}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Error reading file: ${msg}` };
      }
    },
  });

  // ── code_edit ─────────────────────────────────────────
  registerTool({
    name: "code_edit",
    description:
      "Edit Volt's own source code. Writes new content to a file, validates it compiles " +
      "with TypeScript (tsc --noEmit), and auto-commits to git if compilation passes. " +
      "If compilation fails, the change is reverted and the errors are returned. " +
      "ALWAYS use code_read first to see the current content before editing. " +
      "Only files in the editable whitelist can be modified (tools, llm, config, gmail, topics). " +
      "Core files like agent.ts, index.ts, bot.ts, registry.ts are PROTECTED.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description:
            "Relative path to the file in the repo (e.g. 'src/tools/email.ts')",
        },
        content: {
          type: SchemaType.STRING,
          description:
            "The COMPLETE new content for the file. Must include all imports, exports, etc. " +
            "This replaces the entire file content.",
        },
        commit_message: {
          type: SchemaType.STRING,
          description:
            "Git commit message describing the change (e.g. 'feat: add GitHub integration tool')",
        },
      },
      required: ["path", "content", "commit_message"],
    },
    requiresConfirmation: true, // Require user confirmation before editing code
    handler: async (args) => {
      const filePath = String(args.path);
      const newContent = String(args.content);
      const commitMsg = String(args.commit_message || "self-edit: update " + filePath);

      // 1. Check whitelist/blacklist
      const editCheck = isEditable(filePath);
      if (!editCheck.allowed) {
        return { result: editCheck.reason };
      }

      try {
        // 2. Ensure repo is cloned and up to date
        await ensureRepo();
        await ensureDependencies();

        const fullPath = path.join(REPO_DIR, filePath);
        const resolved = path.resolve(fullPath);
        if (!resolved.startsWith(REPO_DIR)) {
          return { result: "Error: path traversal detected — access denied." };
        }

        // 3. Backup original content (if file exists)
        let originalContent: string | null = null;
        try {
          originalContent = await fs.readFile(resolved, "utf-8");
        } catch {
          // New file — no backup needed
          log.info({ file: filePath }, "Self-edit: creating new file");
        }

        // 4. Write new content
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, newContent, "utf-8");
        log.info({ file: filePath }, "Self-edit: file written, running compilation check...");

        // 5. Run tsc --noEmit to validate
        const compileErrors = await compileCheck();

        if (compileErrors) {
          // COMPILATION FAILED — revert the change
          log.warn({ file: filePath }, "Self-edit: compilation FAILED — reverting");

          if (originalContent !== null) {
            await fs.writeFile(resolved, originalContent, "utf-8");
          } else {
            // Was a new file — delete it
            await fs.unlink(resolved).catch(() => {});
          }

          return {
            result:
              `❌ COMPILATION FAILED — change reverted.\n\n` +
              `TypeScript errors:\n\`\`\`\n${compileErrors}\n\`\`\`\n\n` +
              `Fix the errors and try again. The original file is unchanged.`,
          };
        }

        // 6. Compilation passed — commit to git
        log.info({ file: filePath }, "Self-edit: compilation passed ✅ — committing");

        await execAsync(`git add "${filePath}"`, { cwd: REPO_DIR });
        await execAsync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
          cwd: REPO_DIR,
        });

        // Get the commit hash for reference
        const { stdout: commitHash } = await execAsync("git rev-parse --short HEAD", {
          cwd: REPO_DIR,
        });

        return {
          result:
            `✅ Code edit successful!\n\n` +
            `📄 File: ${filePath}\n` +
            `🔨 Compilation: PASSED\n` +
            `📝 Commit: ${commitHash.trim()} — "${commitMsg}"\n\n` +
            `⚠️ The change is committed locally but NOT yet deployed. ` +
            `Use \`code_deploy\` when ready to push and rebuild.`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ file: filePath, err: msg }, "Self-edit: unexpected error");
        return { result: `Error during code edit: ${msg}` };
      }
    },
    verifier: async (args) => {
      const filePath = String(args.path);
      try {
        const fullPath = path.join(REPO_DIR, filePath);
        const content = await fs.readFile(fullPath, "utf-8");
        const expectedContent = String(args.content);
        const matches = content === expectedContent;
        return {
          verified: matches,
          detail: matches
            ? `File "${filePath}" content matches the intended edit`
            : `File "${filePath}" content does NOT match — edit may have been reverted`,
        };
      } catch {
        return { verified: false, detail: `Could not read file "${filePath}" for verification` };
      }
    },
  });

  // ── code_deploy ───────────────────────────────────────
  registerTool({
    name: "code_deploy",
    description:
      "Push committed code changes to GitHub and trigger a rebuild on the VPS. " +
      "This will: git push → SSH into VPS → docker compose up --build. " +
      "Only use after code_edit has successfully committed changes. " +
      "WARNING: This will restart Volt. There will be a brief downtime (~30-60 seconds).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        confirm: {
          type: SchemaType.STRING,
          description:
            "Must be 'YES_DEPLOY' to confirm. This is a safety check since deployment restarts the bot.",
        },
      },
      required: ["confirm"],
    },
    requiresConfirmation: true, // Double confirmation: tool + user
    handler: async (args) => {
      if (String(args.confirm) !== "YES_DEPLOY") {
        return {
          result:
            "Deployment requires explicit confirmation. Set confirm to 'YES_DEPLOY' to proceed.",
        };
      }

      try {
        // 1. Check for uncommitted changes
        const { stdout: status } = await execAsync("git status --porcelain", {
          cwd: REPO_DIR,
        });
        if (status.trim()) {
          return {
            result:
              `⚠️ There are uncommitted changes in the repo. ` +
              `Use code_edit first to make and commit changes.\n\n` +
              `Uncommitted files:\n${status}`,
          };
        }

        // 2. Check if there are commits to push
        const { stdout: ahead } = await execAsync(
          "git rev-list --count origin/main..HEAD",
          { cwd: REPO_DIR }
        ).catch(() => ({ stdout: "0" }));

        if (ahead.trim() === "0") {
          return { result: "Nothing to deploy — no new commits ahead of origin/main." };
        }

        // 3. Push to GitHub
        log.info("Self-edit: pushing to GitHub...");
        await execAsync("git push origin main", {
          cwd: REPO_DIR,
          timeout: 30_000,
        });

        // 4. Trigger rebuild on VPS via SSH
        log.info("Self-edit: triggering rebuild on VPS...");
        const vpsHost = config.vpsSshHost;
        const vpsUser = config.vpsSshUser;

        try {
          await execAsync(
            `ssh -o StrictHostKeyChecking=no ${vpsUser}@${vpsHost} "cd ~/gravity-claw && git pull origin main && docker compose up -d --build"`,
            { timeout: 180_000 }
          );
        } catch (sshErr) {
          const sshMsg = sshErr instanceof Error ? sshErr.message : String(sshErr);
          return {
            result:
              `✅ Code pushed to GitHub successfully!\n\n` +
              `⚠️ But the automatic VPS rebuild failed: ${sshMsg.slice(0, 500)}\n\n` +
              `The code is on GitHub. Santiago can deploy manually with:\n` +
              `\`ssh ${vpsUser}@${vpsHost} "cd ~/gravity-claw && git pull && docker compose up -d --build"\``,
          };
        }

        return {
          result:
            `🚀 DEPLOYMENT COMPLETE!\n\n` +
            `✅ Code pushed to GitHub\n` +
            `✅ VPS rebuild triggered\n` +
            `⏳ Volt will restart in ~30-60 seconds.\n\n` +
            `${ahead.trim()} commit(s) deployed.`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg }, "Self-edit: deployment failed");
        return { result: `Deployment failed: ${msg}` };
      }
    },
  });

  // ── code_list ─────────────────────────────────────────
  registerTool({
    name: "code_list",
    description:
      "List Volt's source code files and directories. Use to explore the codebase structure. " +
      "Shows which files are editable (✏️) vs protected (🔒).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description:
            "Relative directory path in the repo (default: 'src/'). Example: 'src/tools/'",
        },
      },
    },
    handler: async (args) => {
      const dirPath = String(args.path || "src");

      try {
        await ensureRepo();

        const fullPath = path.join(REPO_DIR, dirPath);
        const resolved = path.resolve(fullPath);
        if (!resolved.startsWith(REPO_DIR)) {
          return { result: "Error: path traversal detected." };
        }

        const entries = await fs.readdir(resolved, { withFileTypes: true });
        const lines: string[] = [];

        for (const entry of entries) {
          const relativePath = path.join(dirPath, entry.name).replace(/\\/g, "/");
          if (entry.isDirectory()) {
            lines.push(`📁 ${entry.name}/`);
          } else {
            const check = isEditable(relativePath);
            const icon = check.allowed ? "✏️" : "🔒";
            lines.push(`${icon} ${entry.name}`);
          }
        }

        return {
          result:
            `📂 ${dirPath} (${lines.length} items):\n` +
            `✏️ = editable | 🔒 = protected\n\n` +
            lines.join("\n"),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Error listing directory: ${msg}` };
      }
    },
  });

  log.info(
    "🔧 Code self-edit tools registered (code_read, code_edit, code_deploy, code_list)"
  );
}
