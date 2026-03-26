import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

async function listModels() {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.models) {
      console.log("Available models supporting audio/TTS:");
      const ttsModels = data.models.filter((m: any) => 
        m.name.includes("tts") || m.name.includes("audio") || (m.supportedGenerationMethods && m.supportedGenerationMethods.some((method: string) => method.toLowerCase().includes("audio") || method.toLowerCase().includes("tts")))
      );
      
      if (ttsModels.length > 0) {
        ttsModels.forEach((m: any) => console.log(`- ${m.name}: ${JSON.stringify(m.supportedGenerationMethods)}`));
      } else {
        console.log("None explicitly matched 'tts' or 'audio'. Showing all models:");
        data.models.forEach((m: any) => console.log(`- ${m.name} (${m.displayName})`));
      }
    } else {
      console.log("Response did not contain models:", data);
    }
  } catch (err: any) {
    console.error("Error fetching models:", err.message);
  }
}

listModels();
