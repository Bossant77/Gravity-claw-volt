import { google, type gmail_v1 } from "googleapis";
import { log } from "../logger.js";

// ── Types ───────────────────────────────────────────────

export type GmailAccountName = "personal1" | "personal2" | "work";

export interface GmailAccountConfig {
  name: GmailAccountName;
  email: string;
  refreshToken: string;
}

// ── Multi-Account Client ────────────────────────────────

const clients = new Map<GmailAccountName, gmail_v1.Gmail>();
const accounts = new Map<GmailAccountName, GmailAccountConfig>();

/**
 * Initialize Gmail clients for all configured accounts.
 */
export function initGmailClients(): GmailAccountName[] {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    log.warn("Gmail not configured — missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET");
    return [];
  }

  const accountConfigs: GmailAccountConfig[] = [
    {
      name: "personal1",
      email: process.env.GMAIL_PERSONAL1_EMAIL || "",
      refreshToken: process.env.GMAIL_PERSONAL1_REFRESH_TOKEN || "",
    },
    {
      name: "personal2",
      email: process.env.GMAIL_PERSONAL2_EMAIL || "",
      refreshToken: process.env.GMAIL_PERSONAL2_REFRESH_TOKEN || "",
    },
    {
      name: "work",
      email: process.env.GMAIL_WORK_EMAIL || "",
      refreshToken: process.env.GMAIL_WORK_REFRESH_TOKEN || "",
    },
  ];

  const initialized: GmailAccountName[] = [];

  for (const account of accountConfigs) {
    if (!account.email || !account.refreshToken) continue;

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: account.refreshToken });

    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    clients.set(account.name, gmail);
    accounts.set(account.name, account);
    initialized.push(account.name);

    log.info({ account: account.name, email: account.email }, "Gmail account initialized");
  }

  return initialized;
}

/**
 * Get a Gmail client by account name.
 */
export function getGmailClient(name: GmailAccountName): gmail_v1.Gmail | undefined {
  return clients.get(name);
}

/**
 * Get account config by name.
 */
export function getAccountConfig(name: GmailAccountName): GmailAccountConfig | undefined {
  return accounts.get(name);
}

/**
 * Get all initialized account names.
 */
export function getInitializedAccounts(): GmailAccountName[] {
  return Array.from(clients.keys());
}

/**
 * Resolve account name from user input (fuzzy matching).
 */
export function resolveAccount(input?: string): GmailAccountName | undefined {
  if (!input) {
    // Default to first available
    const first = getInitializedAccounts()[0];
    return first;
  }

  const lower = input.toLowerCase().trim();

  // Direct match
  if (clients.has(lower as GmailAccountName)) {
    return lower as GmailAccountName;
  }

  // Fuzzy match
  if (lower.includes("trabajo") || lower.includes("work") || lower.includes("oficina")) {
    return clients.has("work") ? "work" : undefined;
  }
  if (lower.includes("personal") || lower.includes("1") || lower.includes("principal")) {
    return clients.has("personal1") ? "personal1" : undefined;
  }
  if (lower.includes("2") || lower.includes("segunda") || lower.includes("otro")) {
    return clients.has("personal2") ? "personal2" : undefined;
  }

  // Match by email
  for (const [name, config] of accounts.entries()) {
    if (config.email.toLowerCase().includes(lower)) {
      return name;
    }
  }

  return undefined;
}

// ── Gmail Operations ────────────────────────────────────

/**
 * List recent messages from an account.
 */
export async function listMessages(
  accountName: GmailAccountName,
  options: { maxResults?: number; query?: string; unreadOnly?: boolean } = {}
): Promise<string> {
  const gmail = getGmailClient(accountName);
  if (!gmail) return `Account "${accountName}" not configured.`;

  const { maxResults = 5, query, unreadOnly } = options;
  let q = query || "";
  if (unreadOnly) q = q ? `${q} is:unread` : "is:unread";

  try {
    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults,
      q: q || undefined,
    });

    const messages = res.data.messages || [];
    if (messages.length === 0) {
      return unreadOnly ? "No unread emails." : "No emails found.";
    }

    const details: string[] = [];
    for (const msg of messages.slice(0, maxResults)) {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      });

      const headers = detail.data.payload?.headers || [];
      const from = headers.find((h) => h.name === "From")?.value || "unknown";
      const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
      const date = headers.find((h) => h.name === "Date")?.value || "";
      const snippet = detail.data.snippet || "";
      const isUnread = detail.data.labelIds?.includes("UNREAD") ? "🔵" : "✅";

      details.push(
        `${isUnread} From: ${from}\n📌 ${subject}\n📅 ${date}\n${snippet}\n---`
      );
    }

    const account = getAccountConfig(accountName);
    return `📬 ${account?.email} (${accountName}):\n\n${details.join("\n\n")}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Gmail error: ${msg}`;
  }
}

/**
 * Get full message content.
 */
export async function getMessage(
  accountName: GmailAccountName,
  messageId: string
): Promise<string> {
  const gmail = getGmailClient(accountName);
  if (!gmail) return `Account "${accountName}" not configured.`;

  try {
    const res = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const headers = res.data.payload?.headers || [];
    const from = headers.find((h) => h.name === "From")?.value || "unknown";
    const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
    const date = headers.find((h) => h.name === "Date")?.value || "";

    // Extract body text
    let body = "";
    const parts = res.data.payload?.parts || [];
    if (parts.length > 0) {
      const textPart = parts.find((p) => p.mimeType === "text/plain");
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, "base64").toString("utf-8");
      }
    } else if (res.data.payload?.body?.data) {
      body = Buffer.from(res.data.payload.body.data, "base64").toString("utf-8");
    }

    return `📧 From: ${from}\n📌 ${subject}\n📅 ${date}\n\n${body.slice(0, 2000)}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Gmail error: ${msg}`;
  }
}

/**
 * Send an email.
 */
export async function sendEmail(
  accountName: GmailAccountName,
  to: string,
  subject: string,
  body: string
): Promise<string> {
  const gmail = getGmailClient(accountName);
  const account = getAccountConfig(accountName);
  if (!gmail || !account) return `Account "${accountName}" not configured.`;

  try {
    const raw = Buffer.from(
      `From: ${account.email}\r\n` +
        `To: ${to}\r\n` +
        `Subject: ${subject}\r\n` +
        `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
        body
    ).toString("base64url");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    return `✅ Email sent from ${account.email} to ${to}: "${subject}"`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Gmail send error: ${msg}`;
  }
}

/**
 * Reply to a message.
 */
export async function replyToMessage(
  accountName: GmailAccountName,
  messageId: string,
  body: string
): Promise<string> {
  const gmail = getGmailClient(accountName);
  const account = getAccountConfig(accountName);
  if (!gmail || !account) return `Account "${accountName}" not configured.`;

  try {
    // Get original message for headers
    const original = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Message-ID"],
    });

    const headers = original.data.payload?.headers || [];
    const to = headers.find((h) => h.name === "From")?.value || "";
    const subject = headers.find((h) => h.name === "Subject")?.value || "";
    const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
    const inReplyTo = headers.find((h) => h.name === "Message-ID")?.value || "";
    const threadId = original.data.threadId || "";

    const raw = Buffer.from(
      `From: ${account.email}\r\n` +
        `To: ${to}\r\n` +
        `Subject: ${replySubject}\r\n` +
        `In-Reply-To: ${inReplyTo}\r\n` +
        `References: ${inReplyTo}\r\n` +
        `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
        body
    ).toString("base64url");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId },
    });

    return `✅ Reply sent from ${account.email} to ${to}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Gmail reply error: ${msg}`;
  }
}
