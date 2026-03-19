import puppeteer from "puppeteer";
import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";
import { log } from "../logger.js";

export function registerBrowserTool(): void {
  registerTool({
    name: "browse_page",
    description:
      "Open a web page in a headless browser and extract its text content. Use this for pages that require JavaScript rendering or for getting the full page content. Returns the visible text content of the page.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        url: {
          type: SchemaType.STRING,
          description: "The URL to browse (must start with http:// or https://)",
        },
        wait_seconds: {
          type: SchemaType.NUMBER,
          description: "Seconds to wait for page to fully load (default: 3, max: 15)",
        },
      },
      required: ["url"],
    },
    handler: async (args) => {
      const url = String(args.url);
      const waitSeconds = Math.min(Number(args.wait_seconds) || 3, 15);

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return { result: "Error: URL must start with http:// or https://" };
      }

      let browser;
      try {
        browser = await puppeteer.launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
          ],
        });

        const page = await browser.newPage();
        await page.setUserAgent("GravityClaw/1.0 (Personal AI Agent)");
        await page.setViewport({ width: 1280, height: 800 });

        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        });

        // Wait for content to render
        await new Promise((r) => setTimeout(r, waitSeconds * 1000));

        // Extract text content
        const text = await page.evaluate(() => {
          // Remove script, style, and hidden elements
          const remove = document.querySelectorAll("script, style, noscript, [hidden]");
          remove.forEach((el) => el.remove());
          return document.body?.innerText ?? "(no content)";
        });

        // Get page title
        const title = await page.title();

        let result = `Page: ${title}\nURL: ${url}\n\n${text}`;

        if (result.length > 8000) {
          result = result.slice(0, 8000) + "\n\n[...truncated]";
        }

        return { result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err, url }, "Browser tool error");
        return { result: `Error browsing page: ${msg}` };
      } finally {
        if (browser) {
          await browser.close().catch(() => {});
        }
      }
    },
  });

  registerTool({
    name: "take_screenshot",
    description: "Take a screenshot of a web page and save it to the workspace.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        url: {
          type: SchemaType.STRING,
          description: "The URL to screenshot",
        },
        filename: {
          type: SchemaType.STRING,
          description: "Filename for the screenshot (e.g. 'screenshot.png')",
        },
      },
      required: ["url"],
    },
    handler: async (args) => {
      const url = String(args.url);
      const filename = String(args.filename || "screenshot.png");

      let browser;
      try {
        browser = await puppeteer.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(url, { waitUntil: "networkidle2", timeout: 20_000 });

        const screenshotBuffer = await page.screenshot({ fullPage: false });
        const buffer = Buffer.from(screenshotBuffer);

        // Save to workspace
        const fs = await import("fs/promises");
        const path = await import("path");
        const filePath = path.join("/home/claw/workspace", filename);
        await fs.writeFile(filePath, buffer);

        return {
          result: `Screenshot saved: ${filename}`,
          file: { buffer, filename, mimeType: "image/png" },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Screenshot error: ${msg}` };
      } finally {
        if (browser) {
          await browser.close().catch(() => {});
        }
      }
    },
  });
}
