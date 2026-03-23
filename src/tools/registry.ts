import { log } from "../logger.js";
import type { FunctionDeclaration } from "@google/generative-ai";

// ── Tool Types ──────────────────────────────────────────

export interface ToolConfig {
  name: string;
  description: string;
  parameters: FunctionDeclaration["parameters"];
  /** If true, agent must confirm with user before executing */
  requiresConfirmation?: boolean;
  /** The function that executes the tool */
  handler: (args: Record<string, unknown>) => Promise<ToolOutput>;
}

export interface ToolOutput {
  /** Text result to feed back to the LLM */
  result: string;
  /** Optional file to send to user via Telegram */
  file?: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  };
}

// ── Registry ────────────────────────────────────────────

const tools = new Map<string, ToolConfig>();

/**
 * Register a tool so the agent can use it.
 */
export function registerTool(tool: ToolConfig): void {
  tools.set(tool.name, tool);
  log.info({ tool: tool.name }, "Tool registered");
}

/**
 * Get all tool declarations for Gemini's function calling.
 */
export function getToolDeclarations(): FunctionDeclaration[] {
  return Array.from(tools.values()).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * Execute a tool by name with the given arguments.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolOutput> {
  const tool = tools.get(name);
  if (!tool) {
    return { result: `Error: Unknown tool "${name}". Available tools: ${Array.from(tools.keys()).join(", ")}` };
  }

  // Validate required parameters
  if (tool.parameters && "required" in tool.parameters && Array.isArray(tool.parameters.required)) {
    const missing = tool.parameters.required.filter(
      (param: string) => args[param] === undefined || args[param] === null || args[param] === ""
    );
    if (missing.length > 0) {
      return {
        result: `Error: Missing required parameters for "${name}": ${missing.join(", ")}. Please provide all required arguments.`,
      };
    }
  }

  log.info({ tool: name, args }, "Executing tool");

  try {
    const output = await tool.handler(args);

    // Handle empty results — guide LLM to try alternatives
    if (!output.result || output.result.trim() === "") {
      return {
        result: `Tool "${name}" executed successfully but returned no output. Consider trying a different approach or checking if the input was correct.`,
      };
    }

    log.info({ tool: name, resultLength: output.result.length }, "Tool completed");
    return output;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error({ tool: name, err }, "Tool execution failed");
    return { result: `Error executing ${name}: ${errorMsg}` };
  }
}

/**
 * Check if a tool requires user confirmation.
 */
export function toolRequiresConfirmation(name: string): boolean {
  return tools.get(name)?.requiresConfirmation ?? false;
}

/**
 * Get all registered tool names.
 */
export function getRegisteredTools(): string[] {
  return Array.from(tools.keys());
}
