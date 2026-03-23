import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";
import { getAgentNames, getAgentSummary } from "../subagents/registry.js";
import { runSolo, runSwarm, runPipeline } from "../subagents/runner.js";
import { pool } from "../db.js";
import { log } from "../logger.js";

export function registerDelegateTool(): void {
  registerTool({
    name: "delegate_task",
    description: `Delegate a task to a specialized sub-agent that runs in the background. Available agents:\n${getAgentSummary()}\n\nUse this when a task benefits from specialized handling. The agent runs async and sends the result to the user when done.`,
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        agent: {
          type: SchemaType.STRING,
          description: `Name of the agent to delegate to. Options: ${getAgentNames().join(", ")}`,
        },
        task: {
          type: SchemaType.STRING,
          description: "Clear description of the task for the agent",
        },
        mode: {
          type: SchemaType.STRING,
          description: "Execution mode: 'solo' (default, one agent), 'swarm' (multiple in parallel — comma-separate agent names), 'pipeline' (sequential chain — comma-separate agent names)",
        },
      },
      required: ["agent", "task"],
    },
    handler: async (args) => {
      const agentArg = String(args.agent);
      const task = String(args.task);
      const mode = String(args.mode || "solo");
      const chatId = Number(args.__chatId || 0);
      const threadId = (args as Record<string, unknown>).__threadId as number | undefined;

      try {
        if (mode === "swarm") {
          const agentList = agentArg.split(",").map((a) => a.trim());
          const taskIds = await runSwarm(agentList, task, chatId, threadId);
          return {
            result: `🐝 Swarm delegated! ${agentList.length} agents working in parallel: ${agentList.join(", ")}. Task IDs: ${taskIds.join(", ")}. I'll send results as each finishes.`,
          };
        }

        if (mode === "pipeline") {
          const agentList = agentArg.split(",").map((a) => a.trim());
          const taskId = await runPipeline(agentList, task, chatId, threadId);
          return {
            result: `🔗 Pipeline delegated! Chain: ${agentList.join(" → ")}. Task ID: ${taskId}. I'll send the final result when the chain completes.`,
          };
        }

        // Default: solo
        const taskId = await runSolo(agentArg, task, chatId, threadId);
        return {
          result: `🤖 Task delegated to **${agentArg}** agent! Task ID: ${taskId}. I'll send the result when it's done. Keep chatting!`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err }, "Delegation error");
        return { result: `Failed to delegate: ${msg}` };
      }
    },
  });

  registerTool({
    name: "check_tasks",
    description: "Check the status of delegated sub-agent tasks.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        count: {
          type: SchemaType.NUMBER,
          description: "Number of recent tasks to show (default: 5)",
        },
      },
    },
    handler: async (args) => {
      const count = Math.min(Number(args.count) || 5, 10);
      const chatId = Number(args.__chatId || 0);
      const threadId = (args as Record<string, unknown>).__threadId ?? null;

      try {
        const res = await pool.query(
          `SELECT id, agent, mode, model, task, status, 
                  created_at, completed_at,
                  LEFT(result, 200) as result_preview
           FROM tasks 
           WHERE chat_id = $1 AND thread_id IS NOT DISTINCT FROM $2
           ORDER BY created_at DESC 
           LIMIT $3`,
          [chatId, threadId, count]
        );

        if (res.rows.length === 0) {
          return { result: "No delegated tasks found." };
        }

        const statusEmoji: Record<string, string> = {
          queued: "⏳",
          running: "🔄",
          done: "✅",
          failed: "❌",
        };

        const lines = res.rows.map((r) => {
          const emoji = statusEmoji[r.status as string] ?? "❓";
          const preview = r.result_preview ? `\n   → ${r.result_preview}...` : "";
          return `${emoji} #${r.id} | ${r.agent} (${r.model}) | ${r.status} | ${r.mode}${preview}`;
        });

        return { result: `📋 Recent tasks:\n\n${lines.join("\n\n")}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Error checking tasks: ${msg}` };
      }
    },
  });
}
