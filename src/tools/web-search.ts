import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";

/**
 * Web Search tool — uses fetch to get page content.
 * Gemini's built-in grounding handles general searches.
 * This tool is for fetching specific URLs.
 */
export function registerWebSearchTool(): void {
  registerTool({
    name: "fetch_url",
    description:
      "Fetch and read the text content of a web page given its URL. Use this to read articles, documentation, or any web page the user asks about.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        url: {
          type: SchemaType.STRING,
          description: "The full URL to fetch (must start with http:// or https://)",
        },
      },
      required: ["url"],
    },
    handler: async (args) => {
      const url = String(args.url);

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return { result: "Error: URL must start with http:// or https://" };
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);

        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "GravityClaw/1.0 (Personal AI Agent)",
          },
        });
        clearTimeout(timeout);

        if (!res.ok) {
          return { result: `Error: HTTP ${res.status} ${res.statusText}` };
        }

        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("text") && !contentType.includes("json")) {
          return { result: `Page returned non-text content: ${contentType}` };
        }

        let text = await res.text();
        // Strip HTML tags for cleaner output
        text = text
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        // Truncate to avoid overwhelming the LLM
        if (text.length > 8000) {
          text = text.slice(0, 8000) + "\n\n[...truncated]";
        }

        return { result: text };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Error fetching URL: ${msg}` };
      }
    },
  });
}
