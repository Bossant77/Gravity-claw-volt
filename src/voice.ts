import { config } from "./config.js";
import { log } from "./logger.js";

/**
 * Download a voice/audio file from Telegram.
 * Returns the raw audio Buffer.
 */
export async function downloadTelegramFile(
  fileId: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  // Step 1: Get file path from Telegram API
  const fileInfoUrl = `https://api.telegram.org/bot${config.telegramBotToken}/getFile?file_id=${fileId}`;
  const fileInfoRes = await fetch(fileInfoUrl);
  const fileInfo = (await fileInfoRes.json()) as {
    ok: boolean;
    result: { file_path: string };
  };

  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error("Failed to get file path from Telegram");
  }

  // Step 2: Download the actual file
  const downloadUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${fileInfo.result.file_path}`;
  const fileRes = await fetch(downloadUrl);

  if (!fileRes.ok) {
    throw new Error(`Failed to download file: ${fileRes.status}`);
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Determine MIME type from file extension
  const filePath = fileInfo.result.file_path;
  const mimeType = getMimeType(filePath);

  log.debug(
    { fileId, filePath, mimeType, sizeKB: Math.round(buffer.length / 1024) },
    "Downloaded Telegram file"
  );

  return { buffer, mimeType };
}

/**
 * Infer MIME type from file path.
 */
function getMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ogg":
    case "oga":
      return "audio/ogg";
    case "mp3":
      return "audio/mp3";
    case "wav":
      return "audio/wav";
    case "m4a":
    case "aac":
      return "audio/aac";
    case "mp4":
      return "video/mp4";
    default:
      return "audio/ogg"; // Telegram voice messages are always OGG
  }
}
