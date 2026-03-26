import { config } from "./config.js";
import { log } from "./logger.js";

/**
 * Generates an audio buffer from text using Gemini's native multimodal TTS capabilities.
 * Uses the experimental TTS model available in the API.
 */
export async function generateSpeech(text: string): Promise<Buffer> {
  log.debug({ textLength: text.length }, "Generating speech via Gemini TTS");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${config.geminiApiKey}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text }],
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: "Aoede", // Options: Aoede, Charon, Fenrir, Kore, Puck
          },
        },
      },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TTS API Error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  
  for (const part of parts) {
    if (part.inlineData && part.inlineData.mimeType.startsWith("audio/")) {
      return Buffer.from(part.inlineData.data, "base64");
    }
  }

  throw new Error("No audio data returned from Gemini TTS API");
}
