FROM node:20-slim

# Install system dependencies for Puppeteer + LibreOffice + PDF tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    libreoffice-core \
    libreoffice-writer \
    poppler-utils \
    fonts-liberation \
    fonts-noto \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Gemini CLI and Codex CLI globally
RUN npm install -g @google/gemini-cli @openai/codex

# Tell Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium

# Create workspace for file operations
RUN mkdir -p /home/claw/workspace && chmod 777 /home/claw/workspace

WORKDIR /app

# Install ALL dependencies (including dev for build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --omit=dev

CMD ["node", "dist/index.js"]
