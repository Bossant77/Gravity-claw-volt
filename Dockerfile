FROM node:20-slim

# Install system dependencies for Puppeteer + LibreOffice + PDF tools + SSH
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    libreoffice-core \
    libreoffice-writer \
    poppler-utils \
    fonts-liberation \
    fonts-noto \
    ca-certificates \
    git \
    openssh-client \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Gemini CLI, Codex CLI, and MCP servers globally
RUN npm install -g \
    @google/gemini-cli \
    @openai/codex \
    @modelcontextprotocol/server-github \
    @modelcontextprotocol/server-filesystem \
    2>/dev/null || true

# Tell Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium

# Create workspace for file operations
RUN mkdir -p /home/claw/workspace && chmod 777 /home/claw/workspace

WORKDIR /app

# Install ALL dependencies (including dev — TypeScript needed at runtime for self-edit sandbox)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# NOTE: We keep devDependencies (especially TypeScript) for runtime self-edit
# compilation checks via `tsc --noEmit`. The ~20MB overhead is worth the
# ability for Volt to validate code changes in a sandbox before applying them.

CMD ["node", "dist/index.js"]
