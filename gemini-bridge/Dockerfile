FROM node:20-slim

# Install Gemini CLI and Codex CLI globally
RUN npm install -g @google/gemini-cli @openai/codex 2>/dev/null || true

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

RUN npm prune --omit=dev

CMD ["node", "dist/index.js"]
