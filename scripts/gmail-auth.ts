#!/usr/bin/env node
/**
 * Gmail OAuth2 Token Helper
 * 
 * Usage:
 *   1. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET as env vars (or edit below)
 *   2. Run: npx tsx scripts/gmail-auth.ts
 *   3. Browser opens → sign in with your Gmail account
 *   4. Copy the refresh token and add it to your .env
 * 
 * Repeat for each Gmail account (personal1, personal2, work).
 */

import http from "http";
import { google } from "googleapis";
import { URL } from "url";

// ── Config ──────────────────────────────────────────────

const CLIENT_ID = process.env.GMAIL_CLIENT_ID || "YOUR_CLIENT_ID";
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "YOUR_CLIENT_SECRET";
const REDIRECT_URI = "http://localhost:3000/callback";
const PORT = 3000;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

// ── Main ────────────────────────────────────────────────

if (CLIENT_ID === "YOUR_CLIENT_ID") {
  console.error("❌ Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET first!");
  console.error("   export GMAIL_CLIENT_ID=your-id");
  console.error("   export GMAIL_CLIENT_SECRET=your-secret");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

console.log("\n🔑 Gmail OAuth2 Token Helper\n");
console.log("Opening browser for authorization...\n");

// Try to open browser
const openCmd =
  process.platform === "win32" ? "start" :
  process.platform === "darwin" ? "open" : "xdg-open";

import("child_process").then(({ exec }) => {
  exec(`${openCmd} "${authUrl}"`);
});

console.log("If browser doesn't open, visit this URL:\n");
console.log(authUrl);
console.log("\nWaiting for callback on http://localhost:3000 ...\n");

// ── Local Server ────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/callback")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");

  if (!code) {
    res.writeHead(400);
    res.end("No authorization code received");
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html>
        <body style="font-family: monospace; padding: 40px; background: #1a1a2e; color: #00ff88;">
          <h1>✅ Authorization successful!</h1>
          <p>Check your terminal for the refresh token.</p>
          <p>You can close this tab.</p>
        </body>
      </html>
    `);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ SUCCESS! Here are your tokens:\n");
    console.log(`REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`\nAccess Token: ${tokens.access_token?.slice(0, 20)}...`);
    console.log(`Expiry: ${tokens.expiry_date}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\nAdd this to your .env file:");
    console.log(`GMAIL_PERSONAL1_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\n(Change PERSONAL1 to PERSONAL2 or WORK for other accounts)\n");

    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 2000);
  } catch (err) {
    res.writeHead(500);
    res.end("Token exchange failed");
    console.error("❌ Token exchange failed:", err);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}...`);
});
