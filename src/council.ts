import { GoogleGenerativeAI, type FunctionDeclaration, type Content } from "@google/generative-ai";
import { config } from "./config.js";
import { log } from "./logger.js";
import { gateway } from "./gateway.js";
import { executeTool, getToolDeclarations } from "./tools/registry.js";

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

/**
 * Orchestrates a multi-agent debate (Planner -> Critic -> Coder) to solve a task.
 * Specific to Web Mission Control.
 */
export async function runCouncilDebate(
  chatId: number | string,
  task: string,
  allowedTools: string[]
): Promise<string> {
  log.info({ chatId, task, allowedTools }, "Starting AI Council Debate");

  // We use the pro model for the heavy lifting
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-pro-preview" });

  gateway.streamCouncil("Planner", "thinking", "Analyzing objective and drafting execution plan...");
  
  const plannerPrompt = `You are the Planner agent in an AI Council.
Your objective: Break down the requested task into a step-by-step technical plan.
Do NOT attempt to execute tools. Only output the plan.

Task: ${task}
Available Tools: ${allowedTools.join(", ") || "None"}
`;

  let plan = "";
  try {
    const plannerRes = await model.generateContent(plannerPrompt);
    plan = plannerRes.response.text();
    gateway.streamCouncil("Planner", "speaking", `Drafted Plan:\n${plan}`);
  } catch (err: any) {
    gateway.streamCouncil("Planner", "speaking", `Failed to create plan: ${err.message}`);
    return `Council aborted: Planner error - ${err.message}`;
  }

  gateway.streamCouncil("Critic", "thinking", "Reviewing Planner's draft for flaws and security issues...");
  
  const criticPrompt = `You are the Critic agent in an AI Council.
Review the following execution plan drafted by the Planner. Point out any logic flaws, potential bugs, missing context, or security issues.
If the plan is solid, say 'APPROVED' at the end of your review, otherwise list the concerns for the Coder.

Task: ${task}
Available Tools: ${allowedTools.join(", ") || "None"}

Proposed Plan:
${plan}
`;

  let review = "";
  try {
    const criticRes = await model.generateContent(criticPrompt);
    review = criticRes.response.text();
    gateway.streamCouncil("Critic", "speaking", review);
  } catch (err: any) {
    gateway.streamCouncil("Critic", "speaking", `Critic offline. Error: ${err.message}`);
    review = "Critic failed to review. Proceeding with caution.";
  }

  gateway.streamCouncil("Coder", "thinking", "Executing approved plan implementing required solutions...");

  const allTools = getToolDeclarations();
  const agentTools: FunctionDeclaration[] = allowedTools.length > 0
    ? allTools.filter((t) => allowedTools.includes(t.name))
    : [];

  const coderSystemPrompt = `You are the Coder agent in an AI Council.
Execute the plan provided by the Planner, taking into account the Critic's review.
Use the available tools if necessary to accomplish the task. Return the final success result or findings.

Task: ${task}

Plan: 
${plan}

Critic's Review:
${review}
`;

  let finalResponse = "";
  try {
    let contents: Content[] = [
      { role: "user", parts: [{ text: coderSystemPrompt }] },
      { role: "model", parts: [{ text: "Understood. Starting execution." }]}
    ];

    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      iterations++;
      const result = await model.generateContent({
        contents,
        tools: agentTools.length > 0 ? [{ functionDeclarations: agentTools }] : undefined,
      });

      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      
      const functionCalls = parts
        .filter((p) => p.functionCall)
        .map((p) => p.functionCall!);

      if (functionCalls.length > 0) {
        if (response.candidates?.[0]?.content) {
            contents.push(response.candidates?.[0]?.content);
        }
        
        const toolResults = [];
        for (const fc of functionCalls) {
          gateway.streamThought(fc.name, `Executing tool...`);
          const toolOutput = await executeTool(fc.name, fc.args as Record<string, unknown>);
          toolResults.push({
            functionResponse: {
              name: fc.name,
              response: { result: toolOutput.result }
            }
          });
        }
        contents.push({ role: "user", parts: toolResults });
      } else {
         finalResponse = response.text();
         gateway.streamCouncil("Coder", "speaking", finalResponse);
         break;
      }
    }
    
    if (iterations >= maxIterations) {
       finalResponse = "Reached maximum tool iterations before finishing.";
       gateway.streamCouncil("Coder", "speaking", finalResponse);
    }
  } catch (err: any) {
    gateway.streamCouncil("Coder", "speaking", `Execution failed. Error: ${err.message}`);
    finalResponse = `Execution failed: ${err.message}`;
  }

  gateway.streamCouncil("Planner", "agreed");
  gateway.streamCouncil("Critic", "agreed");
  gateway.streamCouncil("Coder", "agreed");

  return finalResponse;
}
