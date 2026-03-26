import { log } from "./logger.js";
import { runAgent } from "./agent.js";
import { bot } from "./bot.js";
import { config } from "./config.js";

const INITIATIVE_PROMPT = `
<SYSTEM_INITIATIVE>
Revisa tus metas y contexto general. Además, usa tus herramientas para revisar Google Calendar y Google Tasks para las próximas horas si lo consideras útil.
Decide si hay alguna tarea proactiva que debas avanzar o reportar en este momento de forma autónoma (ej. alertarme sobre una reunión que empieza pronto, prepararme contexto/resumen para mi siguiente evento, hacer follow-up de una tarea prioritaria, o buscar información).

REGLAS:
1. Si NO hay nada importante próximo en agenda y decides que no hay ninguna acción prioritaria ahora mismo, tu respuesta DEBE SER EXACTAMENTE Y SOLO LA PALABRA: PASS
2. ¡IMPORTANTE! NUNCA HABLES CONTIGO MISMO SIN USAR UNA HERRAMIENTA. Si decides actuar, DEBES invocar tus herramientas.
3. Si decides hacer una alerta proactiva o resumen, NO respondas PASS. Realiza la acción con tus herramientas, y envía el reporte directo al usuario de forma amigable ("Copiloto proactivo").
</SYSTEM_INITIATIVE>
`.trim();

/**
 * Runs a single initiative cycle.
 * This evaluates if the agent wants to do something proactively.
 * Returns true if the agent acted, false if it passed.
 */
export async function runInitiativeCycle(chatId: number): Promise<boolean> {
  log.info({ chatId }, "🚀 Running Proactive Initiative Cycle");

  try {
    const response = await runAgent(chatId, INITIATIVE_PROMPT, undefined, true);

    if (response.text && response.text.trim() === "PASS") {
      log.debug({ chatId }, "Initiative cycle passed (no action needed).");
      return false;
    }

    log.info({ chatId, textLength: response.text?.length }, "Initiative cycle acted autonomously!");

    // If the agent actually did something and responded, we send it to the user.
    if (response.text) {
      const msg = `⚡ *Acción Proactiva Autónoma:*\\n\\n${response.text}`;
      // Send the result to the user. The agent might have also sent files directly via executeTool
      // but those aren't captured here natively unless we also loop over `response.files`
      // Wait, let's look if we need to escape markdown or just send plain text to Telegram.
      // We will send it to the default thread for this chat.
      await bot.api.sendMessage(chatId, msg, { parse_mode: "MarkdownV2" }).catch(async () => {
        // Fallback to plain text if markdown fails
        await bot.api.sendMessage(chatId, msg.replace(/[\\*_{}\[\]()>#+\-.!|]/g, ''));
      });
      
      // Send any files generated during the initiative
      if (response.files && response.files.length > 0) {
        const { InputFile } = await import("grammy");
        for (const file of response.files) {
          try {
            await bot.api.sendDocument(chatId, new InputFile(file.buffer, file.filename));
          } catch (fileErr) {
            log.error({ fileErr, filename: file.filename }, "Failed to send initiative file");
          }
        }
      }
    }
    
    return true;
  } catch (err: any) {
    log.error({ err, chatId }, "Error running initiative cycle");
    return false;
  }
}
