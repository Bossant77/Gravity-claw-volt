import { google } from "googleapis";
import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";
import { log } from "../logger.js";
import { getGoogleOAuthClient, resolveGoogleAccount } from "../google/auth.js";

export function registerGoogleTasksTools(): void {
  registerTool({
    name: "google_tasks_list",
    description: "List pending tasks from Google Tasks.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: {
          type: SchemaType.STRING,
          description: "Google account name",
        },
        maxResults: {
          type: SchemaType.NUMBER,
          description: "Maximum number of tasks to return (default: 10)",
        },
      },
    },
    handler: async (args) => {
      const accountName = resolveGoogleAccount(args.account ? String(args.account) : undefined);
      if (!accountName) return { result: "Google account not found or not configured." };

      const auth = getGoogleOAuthClient(accountName);
      if (!auth) return { result: `Google Auth not found for account: ${accountName}` };

      const tasks = google.tasks({ version: "v1", auth });
      const maxResults = Math.min(Number(args.maxResults) || 10, 50);

      try {
        const res = await tasks.tasks.list({
          tasklist: "@default",
          maxResults,
          showCompleted: false,
          showHidden: false,
        });

        const items = res.data.items || [];
        if (items.length === 0) {
          return { result: "No pending tasks found." };
        }

        const list = items.map((task, i) => `${i + 1}. [ ] ${task.title}${task.due ? ` (Due: ${task.due})` : ""}`).join("\n");

        return { result: `Pending tasks:\n\n${list}` };
      } catch (err: any) {
        log.error({ err }, "Google Tasks list error");
        return { result: `Failed to list Tasks: ${err.message}` };
      }
    },
  });

  registerTool({
    name: "google_tasks_create",
    description: "Create a new task in Google Tasks.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: {
          type: SchemaType.STRING,
          description: "Google account name",
        },
        title: {
          type: SchemaType.STRING,
          description: "Title of the task",
        },
        notes: {
          type: SchemaType.STRING,
          description: "Description or notes for the task",
        },
        due: {
          type: SchemaType.STRING,
          description: "Due date in RFC 3339 format (e.g., '2024-05-20T00:00:00.000Z')",
        },
      },
      required: ["title"],
    },
    handler: async (args) => {
      const accountName = resolveGoogleAccount(args.account ? String(args.account) : undefined);
      if (!accountName) return { result: "Google account not found or not configured." };

      const auth = getGoogleOAuthClient(accountName);
      if (!auth) return { result: `Google Auth not found for account: ${accountName}` };

      const tasks = google.tasks({ version: "v1", auth });

      try {
        const task = {
          title: String(args.title),
          notes: args.notes ? String(args.notes) : undefined,
          due: args.due ? String(args.due) : undefined,
        };

        const res = await tasks.tasks.insert({
          tasklist: "@default",
          requestBody: task,
        });

        return { result: `✅ Task created: "${res.data.title}"` };
      } catch (err: any) {
        log.error({ err }, "Google Tasks create error");
        return { result: `Failed to create Task: ${err.message}` };
      }
    },
  });
}
