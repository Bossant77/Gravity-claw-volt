import { EventEmitter } from "events";
import { log } from "./logger.js";

/**
 * The Gateway is the central nervous system of Volt.
 * It decouples the core logic (agent.ts, council.ts) from specific platforms (Telegram, CLI, Web).
 * 
 * Events:
 * - 'message:incoming': A new message from ANY platform (Telegram, CLI, Web).
 * - 'message:outgoing': Volt's final response intended for a specific chat/interface.
 * - 'agent:thought': Live stream of what Volt is thinking or executing (for the Mission Control UI).
 * - 'council:debate': Real-time updates when the AI Council is discussing a plan.
 * - 'action:pending': A destructive action that requires human approval in the GUI.
 */
class VoltGateway extends EventEmitter {
  constructor() {
    super();
    // Allow more listeners (multiple sub-agents, multiple websocket clients)
    this.setMaxListeners(50);
  }

  // Incoming
  dispatchIncomingMessage(platform: "telegram" | "cli" | "web", chatId: number | string, text: string) {
    this.emit("message:incoming", { platform, chatId, text });
  }

  // Outgoing
  dispatchOutgoingMessage(chatId: number | string, text: string) {
    this.emit("message:outgoing", { chatId, text });
  }

  // Telemetry / Mission Control events
  streamThought(action: string, detail: string) {
    this.emit("agent:thought", { action, detail, timestamp: new Date().toISOString() });
    // Keep standard logger as backup
    log.info({ action, detail }, "Agent Phase");
  }

  // AI Council events
  streamCouncil(agentId: string, status: "thinking" | "speaking" | "agreed", message?: string) {
    this.emit("council:debate", { agentId, status, message, timestamp: new Date().toISOString() });
  }

  // Action Queues
  requestApproval(toolName: string, args: any, callbackId: string) {
    this.emit("action:pending", { toolName, args, callbackId, timestamp: new Date().toISOString() });
  }
}

export const gateway = new VoltGateway();
