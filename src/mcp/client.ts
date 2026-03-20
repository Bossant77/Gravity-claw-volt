import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { log } from "../logger.js";
import { registerTool } from "../tools/registry.js";
import { getMcpServers, type McpServerConfig } from "./config.js";

// ── Active MCP Connections ──────────────────────────────

interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  serverName: string;
}

const connections: McpConnection[] = [];

// ── Initialize MCP ──────────────────────────────────────

/**
 * Connect to all configured MCP servers, discover their tools,
 * and register them in the tool registry.
 */
export async function initMcp(): Promise<void> {
  const servers = getMcpServers();
  const enabled = servers.filter((s) => s.enabled);

  if (enabled.length === 0) {
    log.info("No MCP servers enabled (missing env vars)");
    return;
  }

  log.info({ count: enabled.length }, "Initializing MCP servers...");

  // Connect to each server in parallel
  const results = await Promise.allSettled(
    enabled.map((server) => connectServer(server))
  );

  let connected = 0;
  for (const result of results) {
    if (result.status === "fulfilled") connected++;
  }

  log.info({ connected, total: enabled.length }, "MCP initialization complete");
}

/**
 * Connect to a single MCP server and register its tools.
 */
async function connectServer(config: McpServerConfig): Promise<void> {
  log.info({ server: config.name }, "Connecting to MCP server...");

  try {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>,
    });

    const client = new Client({
      name: "gravity-claw",
      version: "0.8.0",
    });

    await client.connect(transport);

    connections.push({ client, transport, serverName: config.name });

    // Discover and register tools
    await discoverTools(client, config.name);

    log.info({ server: config.name }, "✅ MCP server connected");
  } catch (err) {
    log.error({ server: config.name, err }, "❌ Failed to connect MCP server");
    throw err;
  }
}

/**
 * Discover tools from an MCP server and register them in the tool registry.
 */
async function discoverTools(
  client: Client,
  serverName: string
): Promise<void> {
  const response = await client.listTools();

  if (!response.tools || response.tools.length === 0) {
    log.info({ server: serverName }, "MCP server has no tools");
    return;
  }

  for (const mcpTool of response.tools) {
    const toolName = `mcp_${serverName}_${mcpTool.name}`;

    // Convert MCP JSON Schema to Gemini parameter format
    const parameters = convertSchema(mcpTool.inputSchema);

    registerTool({
      name: toolName,
      description: `[MCP:${serverName}] ${mcpTool.description || mcpTool.name}`,
      parameters,
      handler: async (args) => {
        // Remove internal args before sending to MCP
        const cleanArgs = { ...args };
        delete cleanArgs.__chatId;

        try {
          const result = await client.callTool({
            name: mcpTool.name,
            arguments: cleanArgs,
          });

          // Extract text from result content
          const text = Array.isArray(result.content)
            ? result.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n")
            : String(result.content);

          return { result: text || "Tool executed successfully (no output)" };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { result: `MCP tool error: ${msg}` };
        }
      },
    });

    log.info(
      { tool: toolName, server: serverName },
      "MCP tool registered"
    );
  }

  log.info(
    { server: serverName, toolCount: response.tools.length },
    "MCP tools discovered"
  );
}

/**
 * Convert MCP JSON Schema to Gemini FunctionDeclaration parameters.
 */
function convertSchema(schema: any): any {
  if (!schema || typeof schema !== "object") {
    return {
      type: "OBJECT",
      properties: {},
    };
  }

  return {
    type: "OBJECT",
    properties: convertProperties(schema.properties || {}),
    required: schema.required || [],
  };
}

/**
 * Recursively convert JSON Schema properties to Gemini format.
 */
function convertProperties(props: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(props)) {
    result[key] = convertProperty(value);
  }

  return result;
}

function convertProperty(prop: any): any {
  if (!prop) return { type: "STRING" };

  const typeMap: Record<string, string> = {
    string: "STRING",
    number: "NUMBER",
    integer: "INTEGER",
    boolean: "BOOLEAN",
    array: "ARRAY",
    object: "OBJECT",
  };

  const geminiType = typeMap[prop.type] || "STRING";

  const converted: any = {
    type: geminiType,
    description: prop.description || "",
  };

  if (prop.enum) {
    converted.enum = prop.enum;
  }

  if (geminiType === "ARRAY" && prop.items) {
    converted.items = convertProperty(prop.items);
  }

  if (geminiType === "OBJECT" && prop.properties) {
    converted.properties = convertProperties(prop.properties);
  }

  return converted;
}

/**
 * Gracefully close all MCP connections.
 */
export async function shutdownMcp(): Promise<void> {
  for (const conn of connections) {
    try {
      await conn.client.close();
      log.info({ server: conn.serverName }, "MCP server disconnected");
    } catch {
      // Ignore shutdown errors
    }
  }
  connections.length = 0;
}
