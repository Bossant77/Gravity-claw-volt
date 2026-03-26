import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";
import { config } from "../config.js";
import { log } from "../logger.js";
import { Client } from "@notionhq/client";

export function registerNotionTools(): void {
  if (!config.notionApiKey) {
    log.warn("Notion tools not registered — NOTION_API_KEY not configured");
    return;
  }

  const notion = new Client({ auth: config.notionApiKey });

  registerTool({
    name: "notion_search",
    description: "Search across all shared pages and databases in Santiago's Notion workspace.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: "Text to search for in page/database titles",
        },
      },
    },
    handler: async (args) => {
      try {
        const query = args.query ? String(args.query) : undefined;
        const response = await notion.search({
          query,
          sort: {
            direction: "descending",
            timestamp: "last_edited_time",
          },
          page_size: 10,
        });

        if (response.results.length === 0) {
          return { result: "No results found in Notion." };
        }

        const formatted = response.results.map((r: any) => {
          let title = "Untitled";
          if (r.object === "database" && r.title && r.title.length > 0) {
            title = r.title[0].plain_text;
          } else if (r.object === "page" && r.properties) {
            // Find a property of type title
            for (const key in r.properties) {
              if (r.properties[key].type === "title" && r.properties[key].title.length > 0) {
                title = r.properties[key].title[0].plain_text;
                break;
              }
            }
          }
          return `[${r.object.toUpperCase()}] ID: ${r.id} | Title: "${title}" | URL: ${r.url || 'N/A'}`;
        });

        return { result: `Notion Search Results:\\n\\n${formatted.join("\\n")}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Notion Error: ${msg}` };
      }
    },
  });

  registerTool({
    name: "notion_read_blocks",
    description: "Read the blocks (content) of a Notion page using its ID.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        page_id: {
          type: SchemaType.STRING,
          description: "The Notion page ID to read",
        },
      },
      required: ["page_id"],
    },
    handler: async (args) => {
      try {
        const blockId = String(args.page_id);
        const response = await notion.blocks.children.list({
          block_id: blockId,
          page_size: 50,
        });

        if (response.results.length === 0) {
          return { result: "Page is empty or has no supported blocks." };
        }

        const lines = response.results.map((block: any) => {
          const type = block.type;
          const content = block[type]?.rich_text?.map((t: any) => t.plain_text).join("") || "";
          switch (type) {
            case "paragraph": return content;
            case "heading_1": return `# ${content}`;
            case "heading_2": return `## ${content}`;
            case "heading_3": return `### ${content}`;
            case "bulleted_list_item": return `- ${content}`;
            case "numbered_list_item": return `1. ${content}`;
            case "to_do": return block.to_do.checked ? `[x] ${content}` : `[ ] ${content}`;
            default: return `[${type}] ${content}`;
          }
        });

        return { result: lines.join("\\n") };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Notion Error: ${msg}` };
      }
    },
  });

  registerTool({
    name: "notion_append_text",
    description: "Append a simple paragraph or task at the bottom of a Notion page.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        page_id: {
          type: SchemaType.STRING,
          description: "The ID of the Notion page to append to",
        },
        content: {
          type: SchemaType.STRING,
          description: "The text content to append",
        },
        type: {
          type: SchemaType.STRING,
          description: "Type of block: 'paragraph' or 'to_do'",
          format: "enum",
          enum: ["paragraph", "to_do"],
        },
      },
      required: ["page_id", "content", "type"],
    },
    requiresConfirmation: true,
    handler: async (args) => {
      try {
        const blockId = String(args.page_id);
        const text = String(args.content);
        const type = String(args.type) as "paragraph" | "to_do";

        const children: any[] = [];
        if (type === "to_do") {
          children.push({
            object: "block",
            type: "to_do",
            to_do: { rich_text: [{ type: "text", text: { content: text } }] },
          });
        } else {
          children.push({
            object: "block",
            type: "paragraph",
            paragraph: { rich_text: [{ type: "text", text: { content: text } }] },
          });
        }

        await notion.blocks.children.append({
          block_id: blockId,
          children,
        });

        return { result: `Successfully appended ${type} to Notion page ${blockId}.` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Notion Error: ${msg}` };
      }
    },
  });

  log.info("Notion tools registered");
}
