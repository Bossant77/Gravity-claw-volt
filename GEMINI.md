# Gravity Claw ⚡

## Project Context
- **Name**: Gravity Claw — Personal AI Agent
- **Stack**: TypeScript, grammY (Telegram), PostgreSQL + pgvector, Docker
- **Server**: Hetzner VPS (Ubuntu), Docker Compose
- **API**: Gemini API Tier 1, Google AI Ultra subscription
- **Owner**: Santiago
- **Language**: Spanish preferred, code comments in English
- **Repo**: https://github.com/Bossant77/Gravity-claw-volt

## Architecture
- `src/agent.ts` — Main agentic loop (Gemini + tool calling)
- `src/llm.ts` — LLM client, system prompt
- `src/tools/` — Registered tools (web, shell, files, email, delegate)
- `src/subagents/` — Multi-model sub-agent system (6 agents)
- `src/memory.ts` — Vector embeddings (pgvector)
- `src/learning.ts` — Self-learning from corrections

## Conventions
- Pure TypeScript with strict mode
- ES Modules (.js extensions in imports)
- Pino logger (not console.log)
- All tools follow ToolConfig interface from registry.ts
- Environment vars in config.ts (required/optional pattern)

## Available Models (Tier 1 API)
- gemini-3.1-pro-preview — complex reasoning
- gemini-3-flash-preview — fast + cheap
- gemini-3.1-flash-lite-preview — ultra-fast
- gemini-2.5-flash — stable creative
- deep-research-pro-preview — research agent
