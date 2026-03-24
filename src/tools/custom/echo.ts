import { registerTool } from "../registry.js";
import { SchemaType } from "@google/generative-ai";

export function register(): void {
  registerTool({
    name: "echo_test",
    description: "A simple echo tool to test the Foundry dynamic custom tools loader.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        message: {
          type: SchemaType.STRING,
          description: "The message to echo back",
        },
      },
      required: ["message"],
    },
    handler: async (args) => {
      return { result: `Echo from Foundry custom tool: ${args.message}` };
    },
  });
}
