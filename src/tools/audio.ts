import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";
import { generateSpeech } from "../tts.js";

export function registerAudioTools(): void {
  registerTool({
    name: "send_voice_note",
    description: "Generate a voice note with spoken audio to send back to the user. Use this when the user explicitly asks for an audio message.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        text: {
          type: SchemaType.STRING,
          description: "The text you want to be synthesized into spoken audio.",
        },
      },
      required: ["text"],
    },
    handler: async (args) => {
      try {
        const text = String(args.text);
        const { buffer, mimeType, filename } = await generateSpeech(text);
        
        return {
          result: "Audio generated successfully and sent to the user.",
          file: {
            buffer,
            filename,
            mimeType,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `TTS Error: ${msg}` };
      }
    },
  });
}
