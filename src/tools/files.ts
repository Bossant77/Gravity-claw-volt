import * as fs from "fs/promises";
import * as path from "path";
import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";

// Sandbox directory — all file operations are restricted to this path
const WORKSPACE = "/home/claw/workspace";

/** Ensure path stays within sandbox */
function safePath(userPath: string): string {
  const resolved = path.resolve(WORKSPACE, userPath);
  if (!resolved.startsWith(WORKSPACE)) {
    throw new Error("Access denied: path outside workspace");
  }
  return resolved;
}

export function registerFilesTool(): void {
  // Ensure workspace exists
  fs.mkdir(WORKSPACE, { recursive: true }).catch(() => {});

  registerTool({
    name: "list_files",
    description: "List files and directories in the workspace. Provide a relative path within the workspace.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description: "Relative path within the workspace (default: root of workspace)",
        },
      },
    },
    handler: async (args) => {
      const target = safePath(String(args.path || "."));

      try {
        const entries = await fs.readdir(target, { withFileTypes: true });
        const lines = entries.map((e) => {
          const icon = e.isDirectory() ? "📁" : "📄";
          return `${icon} ${e.name}`;
        });
        return { result: lines.length > 0 ? lines.join("\n") : "(empty directory)" };
      } catch {
        return { result: `Directory not found: ${args.path}` };
      }
    },
  });

  registerTool({
    name: "read_file",
    description: "Read the text content of a file in the workspace.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description: "Relative path to the file within the workspace",
        },
      },
      required: ["path"],
    },
    handler: async (args) => {
      const target = safePath(String(args.path));

      try {
        const stat = await fs.stat(target);
        if (stat.size > 100_000) {
          return { result: "Error: File too large (>100KB). Use shell commands for large files." };
        }
        const content = await fs.readFile(target, "utf-8");
        return { result: content };
      } catch {
        return { result: `File not found: ${args.path}` };
      }
    },
  });

  registerTool({
    name: "write_file",
    description: "Write text content to a file in the workspace. Creates parent directories if needed.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description: "Relative path for the file within the workspace",
        },
        content: {
          type: SchemaType.STRING,
          description: "The text content to write to the file",
        },
      },
      required: ["path", "content"],
    },
    handler: async (args) => {
      const target = safePath(String(args.path));

      try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, String(args.content), "utf-8");
        return { result: `File written: ${args.path}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Error writing file: ${msg}` };
      }
    },
  });
}
