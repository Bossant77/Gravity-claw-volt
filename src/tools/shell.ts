import { exec } from "child_process";
import { promisify } from "util";
import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";

const execAsync = promisify(exec);

// Commands that are too dangerous to allow
const BLOCKED_PATTERNS = [
  /rm\s+(-rf?|--recursive)\s+\//i,
  /mkfs/i,
  /dd\s+if=/i,
  /:(){ :|:& };:/,
  /shutdown/i,
  /reboot/i,
  /init\s+0/i,
  /halt/i,
  /poweroff/i,
  /format\s+/i,
];

export function registerShellTool(): void {
  registerTool({
    name: "run_shell_command",
    description:
      "Execute a shell command on the server and return its output. Use for system info, file operations, installing packages, etc. Dangerous commands require user confirmation.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        command: {
          type: SchemaType.STRING,
          description: "The shell command to execute (e.g. 'ls -la /home', 'uname -a')",
        },
      },
      required: ["command"],
    },
    requiresConfirmation: true,
    handler: async (args) => {
      const command = String(args.command);

      // Check blocked patterns
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(command)) {
          return { result: `Blocked: "${command}" matches a dangerous command pattern.` };
        }
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          cwd: "/home",
        });

        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += `\nSTDERR:\n${stderr}`;

        // Truncate long output
        if (output.length > 4000) {
          output = output.slice(0, 4000) + "\n\n[...output truncated]";
        }

        return { result: output || "(no output)" };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Command failed: ${msg.slice(0, 2000)}` };
      }
    },
  });
}
