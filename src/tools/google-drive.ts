import { google } from "googleapis";
import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";
import { log } from "../logger.js";
import { getGoogleOAuthClient, resolveGoogleAccount } from "../google/auth.js";

export function registerGoogleDriveTools(): void {
  registerTool({
    name: "google_drive_list",
    description: "Search and list files in Google Drive.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: {
          type: SchemaType.STRING,
          description: "Google account name (e.g., 'personal1', 'work')",
        },
        query: {
          type: SchemaType.STRING,
          description: "Search query (e.g., 'name contains \"project\"')",
        },
        count: {
          type: SchemaType.NUMBER,
          description: "Maximum number of files to return (default: 10)",
        },
      },
    },
    handler: async (args) => {
      const accountName = resolveGoogleAccount(args.account ? String(args.account) : undefined);
      if (!accountName) return { result: "Google account not found or not configured." };

      const auth = getGoogleOAuthClient(accountName);
      if (!auth) return { result: `Google Auth not found for account: ${accountName}` };

      const drive = google.drive({ version: "v3", auth });
      const q = args.query ? String(args.query) : "trashed = false";
      const pageSize = Math.min(Number(args.count) || 10, 50);

      try {
        const res = await drive.files.list({
          q,
          pageSize,
          fields: "files(id, name, mimeType, modifiedTime)",
          orderBy: "modifiedTime desc",
        });

        const files = res.data.files || [];
        if (files.length === 0) return { result: "No files found." };

        const list = files.map((f, i) => `${i + 1}. 📄 ${f.name}\n   ID: ${f.id}\n   Type: ${f.mimeType}\n   Modified: ${f.modifiedTime}`).join("\n\n");
        return { result: `Found ${files.length} files:\n\n${list}` };
      } catch (err: any) {
        log.error({ err }, "Google Drive list error");
        return { result: `Failed to list Drive files: ${err.message}` };
      }
    },
  });

  registerTool({
    name: "google_drive_read",
    description: "Read the text content of a Google Doc or plain text file in Drive.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: {
          type: SchemaType.STRING,
          description: "Google account name",
        },
        fileId: {
          type: SchemaType.STRING,
          description: "The ID of the file to read",
        },
      },
      required: ["fileId"],
    },
    handler: async (args) => {
      const accountName = resolveGoogleAccount(args.account ? String(args.account) : undefined);
      if (!accountName) return { result: "Google account not found or not configured." };

      const auth = getGoogleOAuthClient(accountName);
      if (!auth) return { result: `Google Auth not found for account: ${accountName}` };

      const drive = google.drive({ version: "v3", auth });
      const fileId = String(args.fileId);

      try {
        const metadata = await drive.files.get({ fileId, fields: "name, mimeType" });
        const { name, mimeType } = metadata.data;

        let content = "";

        if (mimeType === "application/vnd.google-apps.document") {
          // Export Google Doc as plain text
          const res = await drive.files.export({ fileId, mimeType: "text/plain" }, { responseType: "text" });
          content = String(res.data);
        } else if (mimeType?.startsWith("text/") || mimeType === "application/json") {
          // Download raw text file
          const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
          content = String(res.data);
        } else {
          return { result: `Cannot read file type: ${mimeType}. Only Google Docs and text files are supported.` };
        }

        return { result: `📄 Content of "${name}":\n\n${content.slice(0, 5000)}... (truncated if too long)` };
      } catch (err: any) {
        log.error({ err }, "Google Drive read error");
        return { result: `Failed to read file: ${err.message}` };
      }
    },
  });

  registerTool({
    name: "google_drive_create",
    description: "Create a new Google Doc in Drive.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: {
          type: SchemaType.STRING,
          description: "Google account name",
        },
        name: {
          type: SchemaType.STRING,
          description: "Name of the new document",
        },
        text: {
          type: SchemaType.STRING,
          description: "Initial text content",
        },
      },
      required: ["name", "text"],
    },
    handler: async (args) => {
      const accountName = resolveGoogleAccount(args.account ? String(args.account) : undefined);
      if (!accountName) return { result: "Google account not found or not configured." };

      const auth = getGoogleOAuthClient(accountName);
      if (!auth) return { result: `Google Auth not found for account: ${accountName}` };

      const drive = google.drive({ version: "v3", auth });
      const docs = google.docs({ version: "v1", auth });
      const name = String(args.name);
      const text = String(args.text);

      try {
        // Create an empty doc first
        const doc = await docs.documents.create({
          requestBody: { title: name },
        });

        const documentId = doc.data.documentId!;

        // Insert the text using docs API
        await docs.documents.batchUpdate({
          documentId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text,
                },
              },
            ],
          },
        });

        return { result: `✅ Created Google Doc "${name}"\nID: ${documentId}\nLink: https://docs.google.com/document/d/${documentId}/edit` };
      } catch (err: any) {
        log.error({ err }, "Google Drive create error");
        return { result: `Failed to create file: ${err.message}` };
      }
    },
  });
}
