import { config } from "./config.js";
import { log } from "./logger.js";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "ffmpeg-static";
import { PassThrough } from "stream";

if (ffmpegInstaller) {
  ffmpeg.setFfmpegPath(ffmpegInstaller as unknown as string);
}

function pcmToWav(pcmData: Buffer, sampleRate: number = 24000, numChannels: number = 1): Buffer {
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;

  const buffer = Buffer.alloc(44 + pcmData.length);

  // RIFF chunk descriptor
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + pcmData.length, 4);
  buffer.write("WAVE", 8);

  // fmt sub-chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20); // AudioFormat
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // BitsPerSample

  // data sub-chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(pcmData.length, 40);

  pcmData.copy(buffer, 44);

  return buffer;
}

/**
 * Generates an audio buffer from text using Gemini's native multimodal TTS capabilities.
 * Returns an object with the buffer and extension (.wav or .mp3, etc.)
 */
export async function generateSpeech(text: string): Promise<{ buffer: any; mimeType: string; filename: string }> {
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
      const mime = part.inlineData.mimeType;
      let buffer = Buffer.from(part.inlineData.data, "base64");
      
      // Gemini natively returns audio/pcm;rate=24000
      if (mime.includes("pcm") || mime === "audio/raw") {
        const wavBuffer = pcmToWav(buffer, 24000, 1);
        
        // Convert WAV to OGG (Opus) so Telegram reads it natively as a Voice Note
        const oggBuffer = await new Promise<Buffer>((resolve, reject) => {
          const inputStream = new PassThrough();
          inputStream.end(wavBuffer);
          
          const outputStream = new PassThrough();
          const chunks: Buffer[] = [];
          
          outputStream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          outputStream.on("end", () => resolve(Buffer.concat(chunks)));
          outputStream.on("error", reject);
          
          ffmpeg(inputStream)
            .inputFormat("wav")
            .audioCodec("libopus")
            .format("ogg")
            .audioChannels(1)
            .audioFrequency(24000)
            .on("error", (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
            .pipe(outputStream, { end: true });
        });

        return { buffer: oggBuffer, mimeType: "audio/ogg", filename: "response.ogg" };
      }
      
      // Fallback if it miraculously returns mp3 or ogg
      const ext = mime.split(";")[0].split("/")[1] || "ogg";
      return { buffer, mimeType: mime, filename: `response.${ext}` };
    }
  }

  throw new Error("No audio data returned from Gemini TTS API");
}
