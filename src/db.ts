import pg from "pg";
import { config } from "./config.js";
import { log } from "./logger.js";

const { Pool } = pg;

// ── Connection Pool ─────────────────────────────────────

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10, // max connections in pool
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err: Error) => {
  log.error({ err }, "Unexpected database pool error");
});

// ── Schema ──────────────────────────────────────────────

const SCHEMA_SQL = `
  -- Enable pgvector extension
  CREATE EXTENSION IF NOT EXISTS vector;

  -- Conversation messages (persistent history)
  CREATE TABLE IF NOT EXISTS messages (
    id          SERIAL PRIMARY KEY,
    chat_id     BIGINT       NOT NULL,
    role        VARCHAR(20)  NOT NULL,
    content     TEXT         NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );

  -- Index for fast lookups by chat
  CREATE INDEX IF NOT EXISTS idx_messages_chat_id
    ON messages (chat_id, created_at DESC);

  -- Semantic memories (vector embeddings)
  -- gemini-embedding-001 returns 3072 dimensions
  CREATE TABLE IF NOT EXISTS memories (
    id          SERIAL PRIMARY KEY,
    chat_id     BIGINT       NOT NULL,
    content     TEXT         NOT NULL,
    embedding   vector(3072) NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );

  -- Index for fast vector similarity search
  CREATE INDEX IF NOT EXISTS idx_memories_chat_id
    ON memories (chat_id);

  -- Reminders (scheduled messages)
  CREATE TABLE IF NOT EXISTS reminders (
    id          SERIAL PRIMARY KEY,
    chat_id     BIGINT       NOT NULL,
    message     TEXT         NOT NULL,
    due_at      TIMESTAMPTZ  NOT NULL,
    delivered   BOOLEAN      NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_reminders_due
    ON reminders (due_at) WHERE delivered = false;

  -- Lessons (self-learning from corrections)
  CREATE TABLE IF NOT EXISTS lessons (
    id          SERIAL PRIMARY KEY,
    chat_id     BIGINT        NOT NULL,
    context     TEXT          NOT NULL,
    correction  TEXT          NOT NULL,
    lesson      TEXT          NOT NULL,
    embedding   vector(3072)  NOT NULL,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_lessons_chat_id
    ON lessons (chat_id);
`;

// ── Public API ──────────────────────────────────────────

/**
 * Initialize database — creates tables and extensions.
 * Safe to call multiple times (idempotent).
 */
export async function initDatabase(): Promise<void> {
  log.info("Initializing database...");

  try {
    await pool.query(SCHEMA_SQL);
    log.info("✅ Database initialized successfully");
  } catch (err) {
    log.fatal({ err }, "Failed to initialize database");
    throw err;
  }
}

/**
 * Execute a query against the pool.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

/**
 * Gracefully close the connection pool.
 */
export async function shutdown(): Promise<void> {
  log.info("Closing database pool...");
  await pool.end();
}
