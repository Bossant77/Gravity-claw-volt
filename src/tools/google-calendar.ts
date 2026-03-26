import { google } from "googleapis";
import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";
import { log } from "../logger.js";
import { getGoogleOAuthClient, resolveGoogleAccount } from "../google/auth.js";

export function registerGoogleCalendarTools(): void {
  registerTool({
    name: "google_calendar_list_events",
    description: "List upcoming events from Google Calendar.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: {
          type: SchemaType.STRING,
          description: "Google account name",
        },
        maxResults: {
          type: SchemaType.NUMBER,
          description: "Maximum number of events to return (default: 5)",
        },
        query: {
          type: SchemaType.STRING,
          description: "Free text search terms to find events",
        },
      },
    },
    handler: async (args) => {
      const accountName = resolveGoogleAccount(args.account ? String(args.account) : undefined);
      if (!accountName) return { result: "Google account not found or not configured." };

      const auth = getGoogleOAuthClient(accountName);
      if (!auth) return { result: `Google Auth not found for account: ${accountName}` };

      const calendar = google.calendar({ version: "v3", auth });
      const maxResults = Math.min(Number(args.maxResults) || 5, 20);

      try {
        const res = await calendar.events.list({
          calendarId: "primary",
          timeMin: new Date().toISOString(),
          maxResults,
          singleEvents: true,
          orderBy: "startTime",
          q: args.query ? String(args.query) : undefined,
        });

        const events = res.data.items || [];
        if (events.length === 0) {
          return { result: "No upcoming events found." };
        }

        const list = events.map((event, i) => {
          const start = event.start?.dateTime || event.start?.date;
          const end = event.end?.dateTime || event.end?.date;
          return `${i + 1}. 📅 ${event.summary}\n   Start: ${start}\n   End: ${end}\n   Link: ${event.htmlLink}`;
        }).join("\n\n");

        return { result: `Upcoming events:\n\n${list}` };
      } catch (err: any) {
        log.error({ err }, "Google Calendar list error");
        return { result: `Failed to list Calendar events: ${err.message}` };
      }
    },
  });

  registerTool({
    name: "google_calendar_create_event",
    description: "Create a new event in Google Calendar.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: {
          type: SchemaType.STRING,
          description: "Google account name",
        },
        summary: {
          type: SchemaType.STRING,
          description: "Title of the event",
        },
        description: {
          type: SchemaType.STRING,
          description: "Description of the event",
        },
        startDateTime: {
          type: SchemaType.STRING,
          description: "Start time in ISO 8601 format (e.g., '2024-05-20T10:00:00-06:00')",
        },
        endDateTime: {
          type: SchemaType.STRING,
          description: "End time in ISO 8601 format",
        },
      },
      required: ["summary", "startDateTime", "endDateTime"],
    },
    handler: async (args) => {
      const accountName = resolveGoogleAccount(args.account ? String(args.account) : undefined);
      if (!accountName) return { result: "Google account not found or not configured." };

      const auth = getGoogleOAuthClient(accountName);
      if (!auth) return { result: `Google Auth not found for account: ${accountName}` };

      const calendar = google.calendar({ version: "v3", auth });

      try {
        const event = {
          summary: String(args.summary),
          description: args.description ? String(args.description) : undefined,
          start: { dateTime: String(args.startDateTime) },
          end: { dateTime: String(args.endDateTime) },
        };

        const res = await calendar.events.insert({
          calendarId: "primary",
          requestBody: event,
        });

        return { result: `✅ Event created: "${res.data.summary}"\nLink: ${res.data.htmlLink}` };
      } catch (err: any) {
        log.error({ err }, "Google Calendar create error");
        return { result: `Failed to create Calendar event: ${err.message}` };
      }
    },
  });
}
