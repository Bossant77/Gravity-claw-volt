import { config } from "../config.js";

// ── MCP Server Configurations ───────────────────────────

export interface McpServerConfig {
  /** Display name for logging */
  name: string;
  /** NPX package or command to run */
  command: string;
  /** Arguments to pass */
  args: string[];
  /** Environment variables for the server */
  env?: Record<string, string>;
  /** Whether this server is enabled */
  enabled: boolean;
}

/**
 * All configured MCP servers.
 * Each server is spawned as a child process and communicates via stdio.
 */
export function getMcpServers(): McpServerConfig[] {
  return [
    {
      name: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
      },
      enabled: !!process.env.GITHUB_TOKEN,
    },
    {
      name: "filesystem",
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/home/claw/workspace",
      ],
      enabled: true,
    },
    {
      name: "google-calendar",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-google-calendar"],
      env: {
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
        GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN || "",
      },
      enabled: !!(
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REFRESH_TOKEN
      ),
    },
    {
      name: "google-drive",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-gdrive"],
      env: {
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
        GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN || "",
      },
      enabled: !!(
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REFRESH_TOKEN
      ),
    },
  ];
}
