import { registerTool } from "../tools/registry.js";
import { SchemaType } from "@google/generative-ai";
import { log } from "../logger.js";
import {
  listMessages,
  getMessage,
  sendEmail,
  replyToMessage,
  listAttachments,
  downloadAttachment,
  resolveAccount,
  getInitializedAccounts,
  getAccountConfig,
  type GmailAccountName,
} from "./client.js";

// ── Register Gmail Tools ────────────────────────────────

export function registerGmailTools(): void {
  const accounts = getInitializedAccounts();

  if (accounts.length === 0) {
    log.warn("Gmail tools not registered — no accounts configured");
    return;
  }

  const accountList = accounts
    .map((name) => {
      const config = getAccountConfig(name);
      return `"${name}" (${config?.email})`;
    })
    .join(", ");

  registerTool({
    name: "gmail_read",
    description: `Read recent emails from Santiago's Gmail. Available accounts: ${accountList}. If no account specified, uses the first available.`,
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: {
          type: SchemaType.STRING,
          description:
            'Account to read from: "personal1", "personal2", or "work". Can also use fuzzy terms like "trabajo", "principal".',
        },
        count: {
          type: SchemaType.NUMBER,
          description: "Number of emails to read (default: 5, max: 10)",
        },
        unread_only: {
          type: SchemaType.BOOLEAN,
          description: "Only show unread emails (default: false)",
        },
      },
    },
    handler: async (args) => {
      const accountName = resolveAccount(args.account as string | undefined);
      if (!accountName) {
        return { result: `Unknown account "${args.account}". Available: ${accountList}` };
      }

      const count = Math.min(Number(args.count) || 5, 10);
      const unreadOnly = Boolean(args.unread_only);

      const result = await listMessages(accountName, {
        maxResults: count,
        unreadOnly,
      });

      return { result };
    },
  });

  registerTool({
    name: "gmail_search",
    description: `Search Santiago's Gmail. Uses Gmail search syntax. Available accounts: ${accountList}.`,
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: {
          type: SchemaType.STRING,
          description: 'Account to search: "personal1", "personal2", or "work".',
        },
        query: {
          type: SchemaType.STRING,
          description: "Search query (Gmail syntax: from:, subject:, has:attachment, etc.)",
        },
        count: {
          type: SchemaType.NUMBER,
          description: "Max results (default: 5)",
        },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const accountName = resolveAccount(args.account as string | undefined);
      if (!accountName) {
        return { result: `Unknown account "${args.account}". Available: ${accountList}` };
      }

      const result = await listMessages(accountName, {
        maxResults: Math.min(Number(args.count) || 5, 10),
        query: String(args.query),
      });

      return { result };
    },
  });

  registerTool({
    name: "gmail_send",
    description: `Send an email from Santiago's Gmail account. Available accounts: ${accountList}.`,
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: {
          type: SchemaType.STRING,
          description: 'Account to send from: "personal1", "personal2", or "work".',
        },
        to: {
          type: SchemaType.STRING,
          description: "Recipient email address",
        },
        subject: {
          type: SchemaType.STRING,
          description: "Email subject line",
        },
        body: {
          type: SchemaType.STRING,
          description: "Email body text",
        },
      },
      required: ["to", "subject", "body"],
    },
    requiresConfirmation: true,
    handler: async (args) => {
      const accountName = resolveAccount(args.account as string | undefined);
      if (!accountName) {
        return { result: `Unknown account "${args.account}". Available: ${accountList}` };
      }

      const result = await sendEmail(
        accountName,
        String(args.to),
        String(args.subject),
        String(args.body)
      );

      return { result };
    },
  });

  registerTool({
    name: "gmail_reply",
    description: `Reply to a specific email in Santiago's Gmail. Requires the message ID from a previous gmail_read or gmail_search.`,
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: {
          type: SchemaType.STRING,
          description: 'Account: "personal1", "personal2", or "work".',
        },
        message_id: {
          type: SchemaType.STRING,
          description: "The message ID to reply to (from gmail_read results)",
        },
        body: {
          type: SchemaType.STRING,
          description: "Reply text",
        },
      },
      required: ["message_id", "body"],
    },
    requiresConfirmation: true,
    handler: async (args) => {
      const accountName = resolveAccount(args.account as string | undefined);
      if (!accountName) {
        return { result: `Unknown account "${args.account}". Available: ${accountList}` };
      }

      const result = await replyToMessage(
        accountName,
        String(args.message_id),
        String(args.body)
      );

      return { result };
    },
  });

  // ── Attachment Tools ──────────────────────────────────────

  registerTool({
    name: "gmail_get_attachments",
    description: `List all attachments in a specific email from Santiago's Gmail. Use message_id from gmail_read or gmail_search results. Returns attachment IDs needed for downloading.`,
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: {
          type: SchemaType.STRING,
          description: 'Account: "personal1", "personal2", or "work".',
        },
        message_id: {
          type: SchemaType.STRING,
          description: "The message ID (from gmail_read or gmail_search results)",
        },
      },
      required: ["message_id"],
    },
    handler: async (args) => {
      const accountName = resolveAccount(args.account as string | undefined);
      if (!accountName) {
        return { result: `Unknown account "${args.account}". Available: ${accountList}` };
      }

      const { result } = await listAttachments(accountName, String(args.message_id));
      return { result };
    },
  });

  registerTool({
    name: "gmail_download_attachment",
    description: `Download a specific attachment from an email in Santiago's Gmail. Use attachment_id from gmail_get_attachments results. The file is saved to workspace and sent to the user via Telegram.`,
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        account: {
          type: SchemaType.STRING,
          description: 'Account: "personal1", "personal2", or "work".',
        },
        message_id: {
          type: SchemaType.STRING,
          description: "The message ID containing the attachment",
        },
        attachment_id: {
          type: SchemaType.STRING,
          description: "The attachment ID (from gmail_get_attachments results)",
        },
        filename: {
          type: SchemaType.STRING,
          description: "Optional custom filename to save as (overrides original name)",
        },
      },
      required: ["message_id", "attachment_id"],
    },
    handler: async (args) => {
      const accountName = resolveAccount(args.account as string | undefined);
      if (!accountName) {
        return { result: `Unknown account "${args.account}". Available: ${accountList}` };
      }

      const { result, file } = await downloadAttachment(
        accountName,
        String(args.message_id),
        String(args.attachment_id),
        args.filename ? String(args.filename) : undefined
      );

      return { result, file };
    },
  });

  log.info(
    { accounts: accounts.length, tools: 6 },
    "Gmail tools registered"
  );
}
