import { log } from "../logger.js";
import { getRegisteredTools, getToolDeclarations } from "../tools/registry.js";

// ── Hallucination Detection Patterns ────────────────────

/**
 * Patterns that indicate the LLM is *claiming* it performed an action.
 * These are checked only when no tool was actually called.
 */
const ACTION_CLAIM_PATTERNS: RegExp[] = [
  // Spanish — past tense claims
  /ya\s+(lo\s+)?hice/i,
  /listo[.,!]?\s*.*(hecho|creado|guardado|enviado|configurado)/i,
  /ya\s+(guardé|creé|configuré|envié|ejecuté|establecí|borré|actualicé|agendé|programé)/i,
  /recordatorio\s+(creado|configurado|establecido|agendado|programado)/i,
  /he\s+(guardado|enviado|creado|actualizado|eliminado|configurado|establecido|ejecutado)/i,
  /queda\s+(guardado|configurado|establecido|agendado)/i,
  /cron\s*(job)?\s+(creado|configurado|establecido)/i,

  // English — past tense claims
  /I('ve|\s+have)\s+(set|created|saved|sent|updated|deleted|configured|stored|executed|scheduled|established)/i,
  /reminder\s+(set|created|saved|scheduled)/i,
  /done[.!]?\s*(I('ve|\s+have)|it('s|\s+is|\s+has))/i,
  /completed\s+the\s+(task|action|request)/i,
  /I\s+(just\s+)?(set|created|saved|sent|updated|deleted|scheduled)\s/i,

  // Action success markers (emoji + claim)
  /✅\s*.*(set|created|done|saved|reminder|cron|updated|hecho|creado|guardado|enviado|configurado)/i,
  /🔔\s*.*(recordatorio|reminder)\s*(creado|set|configured|establecido)/i,
];

/**
 * Patterns that indicate the LLM is claiming it *delegated* work.
 * Only valid if delegate_task was actually called.
 */
const DELEGATION_CLAIM_PATTERNS: RegExp[] = [
  // Spanish — delegation claims
  /pipeline\s+(activad[ao]|en\s+marcha|delegad[ao]|iniciad[ao]|lanzad[ao])/i,
  /sub-?agent(e)?s?\s+(trabajando|en\s+marcha|ejecutando|activ[ao]s?)/i,
  /ya\s+(delegué|asigné|lancé|activé)\s/i,
  /he\s+(delegado|asignado|lanzado|activado)\s+(la\s+tarea|el\s+trabajo|los\s+agentes)/i,
  /cadena\s+de\s+(sub-?agentes|agentes)\s/i,
  /el\s+(analista|codificador|investigador|escritor)\s+se\s+encargará/i,
  /agentes?\s+(procesando|analizando|trabajando|en\s+marcha)/i,

  // English — delegation claims
  /I('ve|\s+have)\s+(delegated|assigned|dispatched|launched)\s/i,
  /pipeline\s+(started|activated|running|launched)/i,
  /sub-?agents?\s+(working|running|active|processing)/i,
  /task\s+(delegated|dispatched|handed\s+off)/i,
  /agents?\s+are\s+(now\s+)?(working|processing|analyzing)/i,
];

/**
 * Phrases that are safe — the LLM is describing what it DID via a tool (not hallucinating).
 * Used to reduce false positives when the guard runs after tool calls.
 */
const SAFE_CONTEXT_PATTERNS: RegExp[] = [
  /tool.*returned/i,
  /result.*from/i,
  /the\s+tool\s+(responded|said|returned)/i,
  /según\s+(el|la)\s+(resultado|herramienta)/i,
];

// ── Detection Function ─────────────────────────────────

export interface HallucinationCheck {
  /** Whether a hallucinated action claim was detected */
  detected: boolean;
  /** The matched pattern (for logging) */
  matchedPattern?: string;
  /** Re-prompt text to send back to the LLM */
  reprompt?: string;
}

/**
 * Scan the LLM's final text for action claims that lack tool backing.
 *
 * @param text - The LLM's text response
 * @param toolsWereCalled - Whether any tools were called during this agent loop
 * @param toolNamesCalled - Specific tool names called (for delegation check)
 */
export function detectHallucinatedAction(
  text: string,
  toolsWereCalled: boolean,
  toolNamesCalled: string[] = []
): HallucinationCheck {
  // If tools were actually called, check specifically for delegation hallucinations
  if (toolsWereCalled) {
    // Even if tools were called, check if LLM claims delegation without calling delegate_task
    const delegateWasCalled = toolNamesCalled.includes("delegate_task");
    if (!delegateWasCalled) {
      for (const pattern of DELEGATION_CLAIM_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
          // Check safe context first
          let isSafe = false;
          for (const safe of SAFE_CONTEXT_PATTERNS) {
            if (safe.test(text)) { isSafe = true; break; }
          }
          if (isSafe) continue;

          log.warn(
            { matchedPattern: match[0], textSnippet: text.slice(0, 200) },
            "Delegation hallucination detected — LLM claimed delegation without calling delegate_task"
          );
          return {
            detected: true,
            matchedPattern: match[0],
            reprompt:
              `⚠️ VERIFICATION FAILURE: You claimed to have delegated a task ("${match[0]}"), ` +
              `but you did NOT call the delegate_task tool. This is FORBIDDEN. ` +
              `To delegate work to sub-agents, you MUST call the delegate_task tool. ` +
              `DO IT NOW: call delegate_task with the appropriate agent, task, and mode. ` +
              `Do NOT respond with text claiming you delegated — CALL THE TOOL.`,
          };
        }
      }
    }
    return { detected: false };
  }

  // No tools were called — check for all action claim patterns
  // Check for safe context (tool result descriptions) — skip if found
  for (const safe of SAFE_CONTEXT_PATTERNS) {
    if (safe.test(text)) {
      return { detected: false };
    }
  }

  // Check delegation claims first (more specific)
  for (const pattern of DELEGATION_CLAIM_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      log.warn(
        { matchedPattern: match[0], textSnippet: text.slice(0, 200) },
        "Delegation hallucination detected — LLM claimed delegation without ANY tool call"
      );
      return {
        detected: true,
        matchedPattern: match[0],
        reprompt:
          `⚠️ VERIFICATION FAILURE: You claimed to have delegated a task ("${match[0]}"), ` +
          `but NO tool was called in this interaction. This is FORBIDDEN. ` +
          `You MUST call delegate_task to actually delegate work. ` +
          `Re-examine the user's request and CALL delegate_task NOW.`,
      };
    }
  }

  // Then check general action claims
  for (const pattern of ACTION_CLAIM_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      log.warn(
        { matchedPattern: match[0], textSnippet: text.slice(0, 200) },
        "Hallucination detected — LLM claimed action without tool call"
      );
      return {
        detected: true,
        matchedPattern: match[0],
        reprompt:
          `⚠️ VERIFICATION FAILURE: You claimed to have performed an action ("${match[0]}"), ` +
          `but NO tool was called in this interaction. This is FORBIDDEN. ` +
          `You MUST call the actual tool to perform the action. ` +
          `Re-examine the user's request and USE THE APPROPRIATE TOOL. ` +
          `Do NOT respond with text claiming you did something — CALL THE TOOL.`,
      };
    }
  }

  return { detected: false };
}

// ── Tool Inventory ──────────────────────────────────────

/**
 * Build a formatted block listing all registered tools.
 * Injected into the system prompt so the LLM knows its exact capabilities.
 */
export function getToolInventoryBlock(): string {
  const declarations = getToolDeclarations();

  if (declarations.length === 0) {
    return "";
  }

  const toolList = declarations
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");

  return (
    `\n\nAVAILABLE TOOLS (you can ONLY perform actions listed here — do NOT claim capabilities you don't have):\n` +
    `${toolList}\n` +
    `If a user asks for something that requires a capability NOT in this list, tell them honestly that you cannot do it yet.`
  );
}
