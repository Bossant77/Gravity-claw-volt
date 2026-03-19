import pino from "pino";
import { config } from "./config.js";

export const log = pino({
  level: config.logLevel,
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino/file", options: { destination: 1 } } // stdout
      : undefined,
  redact: {
    paths: [
      "*.token",
      "*.apiKey",
      "*.secret",
      "*.password",
      "*.key",
      "telegramBotToken",
      "geminiApiKey",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});
