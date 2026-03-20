import {
  GoogleGenerativeAI,
  type Content,
  type FunctionCall,
  type Part,
} from "@google/generative-ai";
import { config } from "../config.js";
import { log } from "../logger.js";
import { getAgent, type SubAgentConfig } from "./registry.js";
import { executeTool, getToolDeclarations } from "../tools/registry.js";
import { pool } from "../db.js";
import type { Bot } from "grammy";
import type { FunctionDeclaration } from "@google/generative-ai";

// ── Bot Reference ───────────────────────────────────────

let botRef: Bot | null = null;

export function setSubAgentBot(bot: Bot): void {
  botRef = bot;
}

// ── Gemini Client ───────────────────────────────────────

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

// ── Core: Run a Single Sub-Agent ────────────────────────

async function executeAgent(
  agentConfig: SubAgentConfig,
  task: string,
  chatId: number,
  taskId: number
): Promise<string> {
  log.info({ agent: agentConfig.name, model: agentConfig.model, task: task.slice(0, 100) }, "Sub-agent starting");

  // Update status to running
  await pool.query("UPDATE tasks SET status = 'running', started_at = NOW() WHERE id = $1", [taskId]);

  const model = genAI.getGenerativeModel({
    model: agentConfig.model,
    generationConfig: { maxOutputTokens: agentConfig.maxTokens },
  });

  // Build tool declarations for this agent's allowed tools
  const allTools = getToolDeclarations();
  const agentTools: FunctionDeclaration[] = agentConfig.allowedTools.length > 0
    ? allTools.filter((t) => agentConfig.allowedTools.includes(t.name))
    : [];

  // Isolated context — fresh conversation (no parent history)
  const contents: Content[] = [
    { role: "user", parts: [{ text: agentConfig.systemPrompt }] },
    { role: "model", parts: [{ text: `Understood. I am the ${agentConfig.name} agent, ready to work.` }] },
    { role: "user", parts: [{ text: `Task: ${task}` }] },
  ];

  try {
    let iterations = 0;
    const maxIterations = 8;

    while (iterations < maxIterations) {
      iterations++;

      const result = await model.generateContent({
        contents,
        tools: agentTools.length > 0 ? [{ functionDeclarations: agentTools }] : undefined,
      });

      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts ?? [];

      // Check for function calls
      const functionCalls = parts
        .filter((p): p is Part & { functionCall: FunctionCall } => !!p.functionCall)
        .map((p) => p.functionCall);

      if (functionCalls.length > 0) {
        // Add model response to conversation
        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) contents.push(modelContent);

        // Execute tools
        const toolResults: Part[] = [];
        for (const fc of functionCalls) {
          const toolOutput = await executeTool(fc.name, (fc.args ?? {}) as Record<string, unknown>);
          toolResults.push({
            functionResponse: {
              name: fc.name,
              response: { result: toolOutput.result },
            },
          } as Part);
        }

        contents.push({ role: "user", parts: toolResults });
        continue; // Loop back for next model response
      }

      // Got text response — done
      const text = response.text();
      log.info({ agent: agentConfig.name, iterations }, "Sub-agent completed");
      return text;
    }

    return "[Agent reached max iterations]";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ agent: agentConfig.name, err }, "Sub-agent error");
    return `[Error from ${agentConfig.name}: ${msg}]`;
  }
}

// ── Public API ──────────────────────────────────────────

/**
 * Solo mode — one agent, one task, runs async and sends result to Telegram.
 */
export async function runSolo(
  agentName: string,
  task: string,
  chatId: number
): Promise<number> {
  const agentConfig = getAgent(agentName);
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);

  // Create task record
  const res = await pool.query(
    `INSERT INTO tasks (chat_id, agent, mode, model, task, status)
     VALUES ($1, $2, 'solo', $3, $4, 'queued') RETURNING id`,
    [chatId, agentName, agentConfig.model, task]
  );
  const taskId = res.rows[0].id as number;

  // Run async — don't await
  (async () => {
    try {
      const result = await executeAgent(agentConfig, task, chatId, taskId);
      await pool.query(
        "UPDATE tasks SET status = 'done', result = $1, completed_at = NOW() WHERE id = $2",
        [result, taskId]
      );

      // Send result to Telegram
      if (botRef) {
        const header = `🤖 **${agentConfig.name}** (${agentConfig.model}) completó:\n\n`;
        const message = header + result;
        // Split if too long
        if (message.length > 4000) {
          await botRef.api.sendMessage(chatId, header + result.slice(0, 3900) + "...");
        } else {
          await botRef.api.sendMessage(chatId, message);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query(
        "UPDATE tasks SET status = 'failed', result = $1, completed_at = NOW() WHERE id = $2",
        [msg, taskId]
      );
      if (botRef) {
        await botRef.api.sendMessage(chatId, `❌ Agent ${agentName} failed: ${msg}`);
      }
    }
  })();

  return taskId;
}

/**
 * Swarm mode — multiple agents in parallel, results merged.
 */
export async function runSwarm(
  agentNames: string[],
  task: string,
  chatId: number
): Promise<number[]> {
  const taskIds: number[] = [];

  for (const name of agentNames) {
    const id = await runSolo(name, task, chatId);
    taskIds.push(id);
  }

  return taskIds;
}

/**
 * Pipeline mode — sequential chain, output of each feeds into the next.
 */
export async function runPipeline(
  agentNames: string[],
  task: string,
  chatId: number
): Promise<number> {
  // Create a parent task
  const res = await pool.query(
    `INSERT INTO tasks (chat_id, agent, mode, model, task, status)
     VALUES ($1, $2, 'pipeline', 'multi', $3, 'queued') RETURNING id`,
    [chatId, agentNames.join(" → "), task]
  );
  const parentTaskId = res.rows[0].id as number;

  // Run async
  (async () => {
    try {
      await pool.query("UPDATE tasks SET status = 'running', started_at = NOW() WHERE id = $1", [parentTaskId]);

      let currentInput = task;
      const allResults: string[] = [];

      for (const agentName of agentNames) {
        const agentConfig = getAgent(agentName);
        if (!agentConfig) {
          throw new Error(`Unknown agent in pipeline: ${agentName}`);
        }

        // Create sub-task
        const subRes = await pool.query(
          `INSERT INTO tasks (chat_id, agent, mode, model, task, status)
           VALUES ($1, $2, 'pipeline-step', $3, $4, 'queued') RETURNING id`,
          [chatId, agentName, agentConfig.model, currentInput.slice(0, 500)]
        );
        const subTaskId = subRes.rows[0].id as number;

        const result = await executeAgent(agentConfig, currentInput, chatId, subTaskId);
        await pool.query(
          "UPDATE tasks SET status = 'done', result = $1, completed_at = NOW() WHERE id = $2",
          [result, subTaskId]
        );

        allResults.push(`[${agentName}]: ${result}`);
        // Feed output as input to next agent
        currentInput = `Previous agent (${agentName}) produced this output:\n\n${result}\n\nContinue with the next step of the task: ${task}`;
      }

      const finalResult = allResults[allResults.length - 1] ?? "No results";
      await pool.query(
        "UPDATE tasks SET status = 'done', result = $1, completed_at = NOW() WHERE id = $2",
        [finalResult, parentTaskId]
      );

      if (botRef) {
        const header = `🔗 **Pipeline** (${agentNames.join(" → ")}) completó:\n\n`;
        const message = header + (allResults[allResults.length - 1] ?? "");
        if (message.length > 4000) {
          await botRef.api.sendMessage(chatId, header + message.slice(0, 3900) + "...");
        } else {
          await botRef.api.sendMessage(chatId, message);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query(
        "UPDATE tasks SET status = 'failed', result = $1, completed_at = NOW() WHERE id = $2",
        [msg, parentTaskId]
      );
      if (botRef) {
        await botRef.api.sendMessage(chatId, `❌ Pipeline failed: ${msg}`);
      }
    }
  })();

  return parentTaskId;
}
