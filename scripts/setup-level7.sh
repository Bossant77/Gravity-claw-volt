#!/bin/bash
# ──────────────────────────────────────────────
# Gravity Claw Level 7 — Server Setup Script
# Run on Hetzner as molt_user
# ──────────────────────────────────────────────

set -e

echo "⚡ Gravity Claw Level 7 — Server Setup"
echo "──────────────────────────────────────"

# 1. Install Gemini CLI
echo "📦 Installing Gemini CLI..."
npm install -g @google/gemini-cli

# 2. Install Codex CLI (OpenAI)
echo "📦 Installing Codex CLI..."
npm install -g @openai/codex

# 3. Create projects workspace
echo "📁 Creating workspace..."
mkdir -p ~/projects
mkdir -p ~/.gemini

# 4. Create Gemini CLI settings with MCP servers
echo "⚙️ Creating Gemini CLI settings..."
cat > ~/.gemini/settings.json << 'EOF'
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
EOF

# 5. Clone gravity-claw if not exists
if [ ! -d ~/projects/gravity-claw ]; then
  echo "📥 Cloning gravity-claw..."
  cd ~/projects
  git clone https://github.com/Bossant77/Gravity-claw-volt.git gravity-claw
fi

# 6. Setup bridge bot
echo "🌉 Setting up Gemini Bridge Bot..."
cd ~/gravity-claw/gemini-bridge
npm install
npm run build

# 7. Create systemd service for bridge bot
echo "🔧 Creating systemd service..."
sudo tee /etc/systemd/system/gemini-bridge.service > /dev/null << EOF
[Unit]
Description=Gemini Dev Bot — Telegram Bridge
After=network.target

[Service]
Type=simple
User=molt_user
WorkingDirectory=/home/molt_user/gravity-claw/gemini-bridge
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable gemini-bridge

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Create a NEW bot with @BotFather for the bridge"
echo "2. Copy .env.example to .env and fill in values:"
echo "   cd ~/gravity-claw/gemini-bridge && cp .env.example .env && nano .env"
echo "3. Authenticate Gemini CLI: gemini auth login"
echo "4. Set GITHUB_TOKEN: export GITHUB_TOKEN=your-token"
echo "5. Start the bridge: sudo systemctl start gemini-bridge"
echo "6. Check logs: journalctl -u gemini-bridge -f"
