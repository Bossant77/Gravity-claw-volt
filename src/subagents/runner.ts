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
import { formatDirectivesForPrompt } from "../directives.js";
import type { Bot } from "grammy";
import type { FunctionDeclaration } from "@google/generative-ai";

// ── Bot Reference ───────────────────────────────────────

let botRef: Bot | null = null;

export function setSubAgentBot(bot: Bot): void {
  botRef = bot;
}

// ── Gemini Client ───────────────────────────────────────

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

// ── Helper: send message to the correct topic thread ────

async function sendToThread(
  chatId: number,
  text: string,
  threadId?: number
): Promise<void> {
  if (!botRef) return;

  const options: Record<string, unknown> = {};
  if (threadId) {
    options.message_thread_id = threadId;
  }

  // Split long messages
  if (text.length > 4000) {
    await botRef.api.sendMessage(chatId, text.slice(0, 3900) + "...", options);
  } else {
    await botRef.api.sendMessage(chatId, text, options);
  }
}

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

  // Load directives for sub-agent context (behavioral rules apply to all agents)
  const directivesBlock = await formatDirectivesForPrompt().catch(() => "");
  const enrichedPrompt = agentConfig.systemPrompt + directivesBlock;

  // Isolated context — fresh conversation (no parent history) but with directives
  const contents: Content[] = [
    { role: "user", parts: [{ text: enrichedPrompt }] },
    { role: "model", parts: [{ text: `Understood. I am the ${agentConfig.name} agent, ready to work.` }] },
    { role: "user", parts: [{ text: `Task: ${task}` }] },
  ];

  try {
    let iterations = 0;
    const maxIterations = 15; // Increased from 8 — sub-agents need more room for multi-tool tasks

    while (iterations < maxIterations) {
      iterations++;

      // Check for cancellation
      const statusRes = await pool.query("SELECT status FROM tasks WHERE id = $1", [taskId]);
      if (statusRes.rows.length > 0 && statusRes.rows[0].status === "cancelled") {
        log.info({ agent: agentConfig.name, taskId }, "Task cancelled mid-execution");
        return "[Tarea cancelada por el usuario o por actualización de instrucciones.]";
      }

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
          log.info(
            { agent: agentConfig.name, tool: fc.name, taskId, iteration: iterations },
            "Sub-agent executing tool"
          );
          const toolOutput = await executeTool(fc.name, (fc.args ?? {}) as Record<string, unknown>);
          toolResults.push({
            functionResponse: {
              name: fc.name,
              response: { result: toolOutput.result },
            },
          } as Part);
        }

        contents.push({ role: "user", parts: toolResults });

        // Budget warning for sub-agents too
        if (iterations >= maxIterations - 2) {
          contents.push({
            role: "user",
            parts: [{ text: `⚠️ BUDGET WARNING: Te quedan ${maxIterations - iterations} pasos. Termina lo esencial y da tu respuesta final AHORA.` }],
          });
        }

        continue; // Loop back for next model response
      }

      // Got text response — done
      const text = response.text();
      log.info({ agent: agentConfig.name, iterations }, "Sub-agent completed");
      return text;
    }

    return "[Agent reached max iterations — la tarea requiere más pasos de los permitidos. Considera dividir en sub-tareas más pequeñas.]";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ agent: agentConfig.name, err }, "Sub-agent error");
    return `[Error from ${agentConfig.name}: ${msg}]`;
  }
}

// ── Public API ──────────────────────────────────────────

/**
 * Solo mode — one agent, one task, runs async and sends result to Telegram.
 * Now properly routes results to the correct topic thread.
 */
export async function runSolo(
  agentName: string,
  task: string,
  chatId: number,
  threadId?: number
): Promise<number> {
  const agentConfig = getAgent(agentName);
  if (!agentConfig) throw new Error(`Unknown agent: ${agentName}`);

  // Create task record (with thread_id for topic-scoped tracking)
  const res = await pool.query(
    `INSERT INTO tasks (chat_id, thread_id, agent, mode, model, task, status)
     VALUES ($1, $2, $3, 'solo', $4, $5, 'queued') RETURNING id`,
    [chatId, threadId ?? null, agentName, agentConfig.model, task]
  );
  const taskId = res.rows[0].id as number;

  // Run async — don't await
  (async () => {
    try {
      const result = await executeAgent(agentConfig, task, chatId, taskId);

      // Check if cancelled before broadcasting
      const checkStatus = await pool.query("SELECT status FROM tasks WHERE id = $1", [taskId]);
      if (checkStatus.rows.length === 0 || checkStatus.rows[0].status !== "cancelled") {
        await pool.query(
          "UPDATE tasks SET status = 'done', result = $1, completed_at = NOW() WHERE id = $2",
          [result, taskId]
        );

        // Send result to the correct topic thread
        const header = `🤖 **${agentConfig.name}** (${agentConfig.model}) completó:\n\n`;
        await sendToThread(chatId, header + result, threadId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query(
        "UPDATE tasks SET status = 'failed', result = $1, completed_at = NOW() WHERE id = $2",
        [msg, taskId]
      );
      await sendToThread(chatId, `❌ Agent ${agentName} failed: ${msg}`, threadId);
    }
  })();

  return taskId;
}

/**
 * Swarm mode — multiple agents in parallel, results merged.
 * Now properly routes results to the correct topic thread.
 */
export async function runSwarm(
  agentNames: string[],
  task: string,
  chatId: number,
  threadId?: number
): Promise<number[]> {
  const taskIds: number[] = [];

  for (const name of agentNames) {
    const id = await runSolo(name, task, chatId, threadId);
    taskIds.push(id);
  }

  return taskIds;
}

/**
 * Pipeline mode — sequential chain, output of each feeds into the next.
 * Now properly routes results to the correct topic thread.
 */
export async function runPipeline(
  agentNames: string[],
  task: string,
  chatId: number,
  threadId?: number
): Promise<number> {
  // Create a parent task
  const res = await pool.query(
    `INSERT INTO tasks (chat_id, thread_id, agent, mode, model, task, status)
     VALUES ($1, $2, $3, 'pipeline', 'multi', $4, 'queued') RETURNING id`,
    [chatId, threadId ?? null, agentNames.join(" → "), task]
  );
  const parentTaskId = res.rows[0].id as number;

  // Run async
  (async () => {
    try {
      await pool.query("UPDATE tasks SET status = 'running', started_at = NOW() WHERE id = $1", [parentTaskId]);

      let currentInput = task;
      const allResults: string[] = [];

      for (const agentName of agentNames) {
        // Check if parent pipeline was cancelled
        const parentStatusRes = await pool.query("SELECT status FROM tasks WHERE id = $1", [parentTaskId]);
        if (parentStatusRes.rows.length > 0 && parentStatusRes.rows[0].status === "cancelled") {
          allResults.push(`[${agentName}]: Pipeline cancelado.`);
          break;
        }

        const agentConfig = getAgent(agentName);
        if (!agentConfig) {
          throw new Error(`Unknown agent in pipeline: ${agentName}`);
        }

        // Create sub-task
        const subRes = await pool.query(
          `INSERT INTO tasks (chat_id, thread_id, agent, mode, model, task, status)
           VALUES ($1, $2, $3, 'pipeline-step', $4, $5, 'queued') RETURNING id`,
          [chatId, threadId ?? null, agentName, agentConfig.model, currentInput.slice(0, 500)]
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

      // Only broadcast if not cancelled
      const finalStatusRes = await pool.query("SELECT status FROM tasks WHERE id = $1", [parentTaskId]);
      if (finalStatusRes.rows.length === 0 || finalStatusRes.rows[0].status !== "cancelled") {
        const finalResult = allResults[allResults.length - 1] ?? "No results";
        await pool.query(
          "UPDATE tasks SET status = 'done', result = $1, completed_at = NOW() WHERE id = $2",
          [finalResult, parentTaskId]
        );

        // Send result to the correct topic thread
        const header = `🔗 **Pipeline** (${agentNames.join(" → ")}) completó:\n\n`;
        await sendToThread(chatId, header + (allResults[allResults.length - 1] ?? ""), threadId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query(
        "UPDATE tasks SET status = 'failed', result = $1, completed_at = NOW() WHERE id = $2",
        [msg, parentTaskId]
      );
      await sendToThread(chatId, `❌ Pipeline failed: ${msg}`, threadId);
    }
  })();

  return parentTaskId;
}
