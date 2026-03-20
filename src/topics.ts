// ── Topic Configuration ─────────────────────────────────
// Maps Telegram forum thread IDs to per-topic behavior.

export interface TopicConfig {
  threadId: number;
  name: string;
  emoji: string;
  /** Extra context appended to the system prompt when chatting in this topic */
  systemPromptOverride: string;
  /** Whether the Gemini Dev Bot (bridge) should respond here */
  allowGeminiBridge: boolean;
  /** If true, heartbeats/health logs are routed here */
  isLogTopic: boolean;
}

// ── Topic Definitions ───────────────────────────────────

export const TOPIC_CONFIGS: TopicConfig[] = [
  {
    threadId: 1,
    name: "General",
    emoji: "#",
    systemPromptOverride: `TOPIC: General
This is the main hub for casual conversation.
- Be your normal self — friendly, concise, helpful.
- This is Santiago's default chat space.
- Handle any topic naturally (questions, ideas, quick tasks, chitchat).
- Morning greetings go here.`,
    allowGeminiBridge: false,
    isLogTopic: false,
  },
  {
    threadId: 40,
    name: "Projects",
    emoji: "📁",
    systemPromptOverride: `TOPIC: Projects
This topic is for software projects, repos, and features.
- Act as a technical project manager and developer.
- Be structured: discuss architecture, tasks, milestones, blockers.
- Reference GitHub repos when relevant (owner: Bossant77).
- Suggest next steps, help plan sprints, track progress.
- Code assistance and technical discussions are expected here.
- The Gemini Dev Bot (coding agent) is also active in this topic.`,
    allowGeminiBridge: true,
    isLogTopic: false,
  },
  {
    threadId: 41,
    name: "peninsulawyers",
    emoji: "🏛️",
    systemPromptOverride: `TOPIC: peninsulawyers
This topic is for a legal-related business context.
- Be professional, formal, and precise.
- Help with business planning, client management, legal drafts, and strategy.
- Use proper business/legal language (but still in Spanish unless asked otherwise).
- Treat this as a professional workspace — no casual jokes here.`,
    allowGeminiBridge: false,
    isLogTopic: false,
  },
  {
    threadId: 42,
    name: "academia",
    emoji: "📝",
    systemPromptOverride: `TOPIC: Academia
This topic is Santiago's academic workspace.
- PRIMARY ROLE: Academic secretary — proactively remind about tasks, deadlines, exams, and events.
- Track homework assignments, project due dates, and exam schedules.
- Organize and summarize academic responsibilities.
- SECONDARY ROLE (only when explicitly asked): Tutor — explain concepts step by step (Java, C++, etc.).
- Be structured: use bullet points, checklists, and clear deadlines.
- The Gemini Dev Bot (coding agent) is also active here for coding assignments.`,
    allowGeminiBridge: true,
    isLogTopic: false,
  },
  {
    threadId: 43,
    name: "personal",
    emoji: "🧠",
    systemPromptOverride: `TOPIC: Personal
This topic is Santiago's personal space.
- Act as a personal assistant — notes, reminders, personal errands, ideas.
- Be warm, supportive, and attentive.
- Help organize personal life: appointments, shopping lists, travel plans.
- Remember personal preferences and details mentioned here.
- Keep things private and personal — this is not a work space.`,
    allowGeminiBridge: false,
    isLogTopic: false,
  },
  {
    threadId: 44,
    name: "logs y memoria",
    emoji: "🧠",
    systemPromptOverride: `TOPIC: Logs y Memoria
This is the system log topic.
- Health checks, daily summaries, and system alerts go here.
- If Santiago writes here, respond concisely about system status.
- Keep messages technical and to the point.
- This is NOT a conversation space — it's a monitoring channel.`,
    allowGeminiBridge: false,
    isLogTopic: true,
  },
  {
    threadId: 48,
    name: "desarrollo personal",
    emoji: "📈",
    systemPromptOverride: `TOPIC: Desarrollo Personal
This topic is for personal growth, habits, and self-improvement.
- Act as a motivational coach and accountability partner.
- Help track goals, habits, routines, and progress.
- Be encouraging but honest — push Santiago to improve.
- Suggest strategies for productivity, mindset, health, and skill development.
- Celebrate wins and help analyze setbacks constructively.`,
    allowGeminiBridge: false,
    isLogTopic: false,
  },
];

// ── Lookup Helpers ──────────────────────────────────────

/**
 * Get the topic config for a given thread ID.
 * Returns null if the thread ID is unknown or undefined (e.g. DM or unlisted topic).
 */
export function getTopicConfig(threadId: number | undefined): TopicConfig | null {
  if (threadId === undefined || threadId === null) return null;
  return TOPIC_CONFIGS.find((t) => t.threadId === threadId) ?? null;
}

/**
 * Get the thread ID for the log/heartbeat topic.
 */
export function getLogTopicThreadId(): number | undefined {
  return TOPIC_CONFIGS.find((t) => t.isLogTopic)?.threadId;
}

/**
 * Get the thread ID for the General topic (morning greetings).
 */
export function getGeneralTopicThreadId(): number | undefined {
  return TOPIC_CONFIGS.find((t) => t.name === "General")?.threadId;
}

/**
 * Check if the Gemini Dev Bot is allowed to respond in this thread.
 */
export function isGeminiBridgeAllowed(threadId: number | undefined): boolean {
  if (threadId === undefined || threadId === null) return false;
  const config = getTopicConfig(threadId);
  return config?.allowGeminiBridge ?? false;
}
