import "dotenv/config";

// ── Required ────────────────────────────────────────────
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`❌ Missing required env var: ${name}  — see .env.example`);
  }
  return value;
}

// ── Optional with defaults ──────────────────────────────
function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

// ── Config Object ───────────────────────────────────────
export const config = {
  /** Telegram bot token from @BotFather */
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),

  /** Whitelisted Telegram user IDs (numbers) */
  allowedUserIds: required("ALLOWED_USER_IDS")
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((id) => !Number.isNaN(id)),

  /** Google AI Studio API key */
  geminiApiKey: required("GEMINI_API_KEY"),

  /** PostgreSQL connection string */
  databaseUrl: required("DATABASE_URL"),

  /** Gemini model name */
  geminiModel: optional("GEMINI_MODEL", "gemini-3-flash-preview"),

  /** Max agentic loop iterations (safety limit) */
  maxIterations: Number(optional("MAX_ITERATIONS", "25")),

  /** Log level */
  logLevel: optional("LOG_LEVEL", "info") as
    | "debug"
    | "info"
    | "warn"
    | "error",

  /** Agent's own email identity (optional) */
  agentEmail: process.env.AGENT_EMAIL ?? "",
  agentEmailPassword: process.env.AGENT_EMAIL_PASSWORD ?? "",

  /** Chat ID to send proactive heartbeat messages to */
  heartbeatChatId: Number(process.env.HEARTBEAT_CHAT_ID || "0") || 0,

  /** Timezone for scheduling (IANA format) */
  timezone: optional("TIMEZONE", "America/Monterrey"),

  /** Code self-edit feature flag */
  codeEditEnabled: optional("CODE_EDIT_ENABLED", "true") === "true",

  /** Git config for self-edit commits */
  gitRepoUrl: optional("GIT_REPO_URL", "git@github.com:Bossant77/Gravity-claw-volt.git"),
  gitUserName: optional("GIT_USER_NAME", "Volt ⚡"),
  gitUserEmail: optional("GIT_USER_EMAIL", "volt@gravityclaw.ai"),

  /** VPS SSH config for code_deploy */
  vpsSshHost: optional("VPS_SSH_HOST", "91.99.225.220"),
  vpsSshUser: optional("VPS_SSH_USER", "molt_user"),
} as const;

// ── Validate ────────────────────────────────────────────
if (config.allowedUserIds.length === 0) {
  throw new Error(
    "❌ ALLOWED_USER_IDS must contain at least one valid numeric Telegram user ID"
  );
}

export type Config = typeof config;
