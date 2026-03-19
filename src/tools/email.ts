import * as nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";
import { config } from "../config.js";
import { log } from "../logger.js";
import { simpleParser, type ParsedMail } from "mailparser";

export function registerEmailTool(): void {
  // Only register if email is configured
  if (!config.agentEmail || !config.agentEmailPassword) {
    log.warn("Email tools not registered — AGENT_EMAIL not configured");
    return;
  }

  registerTool({
    name: "send_email",
    description: "Send an email from the agent's own email account.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
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
    handler: async (args) => {
      const to = String(args.to);
      const subject = String(args.subject);
      const body = String(args.body);

      try {
        const transporter = nodemailer.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: {
            user: config.agentEmail,
            pass: config.agentEmailPassword,
          },
          connectionTimeout: 30_000,
          greetingTimeout: 30_000,
          socketTimeout: 30_000,
        });

        await transporter.sendMail({
          from: `Gravity Claw <${config.agentEmail}>`,
          to,
          subject,
          text: body,
        });

        return { result: `Email sent to ${to} with subject: "${subject}"` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Failed to send email: ${msg}` };
      }
    },
  });

  registerTool({
    name: "read_emails",
    description: "Read the most recent emails from the agent's inbox.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        count: {
          type: SchemaType.NUMBER,
          description: "Number of recent emails to read (default: 5, max: 10)",
        },
        unread_only: {
          type: SchemaType.BOOLEAN,
          description: "Only show unread emails (default: false)",
        },
      },
    },
    handler: async (args) => {
      const count = Math.min(Number(args.count) || 5, 10);
      const unreadOnly = Boolean(args.unread_only);

      try {
        const client = new ImapFlow({
          host: "imap.gmail.com",
          port: 993,
          secure: true,
          auth: {
            user: config.agentEmail,
            pass: config.agentEmailPassword,
          },
          logger: false,
        });

        await client.connect();
        const lock = await client.getMailboxLock("INBOX");

        try {
          const messages: string[] = [];
          const searchResult = await client.search(
            unreadOnly ? { seen: false } : { all: true },
            { uid: true }
          );

          // search can return false if no results
          const uids = Array.isArray(searchResult) ? searchResult : [];
          const recentUids = uids.slice(-count);

          if (recentUids.length === 0) {
            return { result: unreadOnly ? "No unread emails." : "Inbox is empty." };
          }

          for await (const msg of client.fetch(recentUids, {
            envelope: true,
            source: true,
            uid: true,
          })) {
            if (!msg.source) continue;
            const parsed: ParsedMail = await simpleParser(msg.source);
            const from = parsed.from?.text ?? "unknown";
            const subject = parsed.subject ?? "(no subject)";
            const date = parsed.date?.toLocaleDateString() ?? "";
            const bodyText = (parsed.text ?? "").slice(0, 500);

            messages.push(
              `📧 From: ${from}\n📅 ${date}\n📌 Subject: ${subject}\n${bodyText}\n---`
            );
          }

          return { result: messages.join("\n\n") || "No emails found." };
        } finally {
          lock.release();
          await client.logout();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err }, "Email read error");
        return { result: `Failed to read emails: ${msg}` };
      }
    },
  });

  registerTool({
    name: "search_emails",
    description: "Search emails by subject or sender.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: "Search term (searches in subject and sender)",
        },
        count: {
          type: SchemaType.NUMBER,
          description: "Max results to return (default: 5)",
        },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const searchQuery = String(args.query);
      const count = Math.min(Number(args.count) || 5, 10);

      try {
        const client = new ImapFlow({
          host: "imap.gmail.com",
          port: 993,
          secure: true,
          auth: {
            user: config.agentEmail,
            pass: config.agentEmailPassword,
          },
          logger: false,
        });

        await client.connect();
        const lock = await client.getMailboxLock("INBOX");

        try {
          const searchResult = await client.search(
            { or: [{ subject: searchQuery }, { from: searchQuery }] },
            { uid: true }
          );

          const uids = Array.isArray(searchResult) ? searchResult : [];
          const recentUids = uids.slice(-count);

          if (recentUids.length === 0) {
            return { result: `No emails found matching "${searchQuery}"` };
          }

          const messages: string[] = [];
          for await (const msg of client.fetch(recentUids, {
            envelope: true,
            source: true,
            uid: true,
          })) {
            if (!msg.source) continue;
            const parsed: ParsedMail = await simpleParser(msg.source);
            messages.push(
              `📧 From: ${parsed.from?.text ?? "unknown"}\n📌 ${parsed.subject ?? "(no subject)"}\n📅 ${parsed.date?.toLocaleDateString() ?? ""}`
            );
          }

          return { result: `Found ${messages.length} emails:\n\n${messages.join("\n\n")}` };
        } finally {
          lock.release();
          await client.logout();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Email search failed: ${msg}` };
      }
    },
  });
}
