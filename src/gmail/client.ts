import { google, type gmail_v1 } from "googleapis";
import { log } from "../logger.js";
import * as fs from "fs/promises";
import * as path from "path";
import { initGoogleAuth, getGoogleOAuthClient, getGoogleAccountConfig, getInitializedGoogleAccounts, resolveGoogleAccount, type GoogleAccountName, type GoogleAccountConfig } from "../google/auth.js";

const WORKSPACE = "/home/claw/workspace";

// ── Types ───────────────────────────────────────────────

export type GmailAccountName = GoogleAccountName;
export type GmailAccountConfig = GoogleAccountConfig;

// ── Multi-Account Client ────────────────────────────────

const clients = new Map<GmailAccountName, gmail_v1.Gmail>();

/**
 * Initialize Gmail clients for all configured accounts.
 */
export function initGmailClients(): GmailAccountName[] {
  const initialized = initGoogleAuth();

  for (const name of initialized) {
    const oauth2 = getGoogleOAuthClient(name);
    if (!oauth2) continue;

    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    clients.set(name, gmail);
    log.info({ account: name }, "Gmail API client created");
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
  return getGoogleAccountConfig(name);
}

/**
 * Get all initialized account names.
 */
export function getInitializedAccounts(): GmailAccountName[] {
  return getInitializedGoogleAccounts();
}

/**
 * Resolve account name from user input (fuzzy matching).
 */
export function resolveAccount(input?: string): GmailAccountName | undefined {
  return resolveGoogleAccount(input);
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
        format: "full",
        metadataHeaders: ["From", "Subject", "Date"],
      });

      const headers = detail.data.payload?.headers || [];
      const from = headers.find((h) => h.name === "From")?.value || "unknown";
      const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
      const date = headers.find((h) => h.name === "Date")?.value || "";
      const snippet = detail.data.snippet || "";
      const isUnread = detail.data.labelIds?.includes("UNREAD") ? "🔵" : "✅";

      // Count attachments from MIME parts
      const attachments = extractAttachmentParts(detail.data.payload ?? undefined);
      const attachmentInfo = attachments.length > 0
        ? `\n📎 ${attachments.length} attachment(s): ${attachments.map((a) => a.filename).join(", ")}`
        : "";

      details.push(
        `${isUnread} [ID: ${msg.id}] From: ${from}\n📌 ${subject}\n📅 ${date}\n${snippet}${attachmentInfo}\n---`
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

// ── Attachment Types ────────────────────────────────────

export interface AttachmentInfo {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
  partId: string;
}

// ── Attachment Helpers ──────────────────────────────────

/**
 * Recursively extract attachment parts from MIME payload.
 */
function extractAttachmentParts(
  payload?: gmail_v1.Schema$MessagePart
): AttachmentInfo[] {
  if (!payload) return [];

  const attachments: AttachmentInfo[] = [];

  // Check if this part is an attachment
  if (
    payload.body?.attachmentId &&
    payload.filename &&
    payload.filename.length > 0
  ) {
    attachments.push({
      filename: payload.filename,
      mimeType: payload.mimeType || "application/octet-stream",
      size: payload.body.size || 0,
      attachmentId: payload.body.attachmentId,
      partId: payload.partId || "",
    });
  }

  // Recurse into nested parts (multipart/mixed, multipart/alternative, etc.)
  if (payload.parts) {
    for (const part of payload.parts) {
      attachments.push(...extractAttachmentParts(part));
    }
  }

  return attachments;
}

/**
 * List all attachments in a specific message.
 */
export async function listAttachments(
  accountName: GmailAccountName,
  messageId: string
): Promise<{ result: string; attachments: AttachmentInfo[] }> {
  const gmail = getGmailClient(accountName);
  if (!gmail)
    return { result: `Account "${accountName}" not configured.`, attachments: [] };

  try {
    const res = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const headers = res.data.payload?.headers || [];
    const subject =
      headers.find((h) => h.name === "Subject")?.value || "(no subject)";
    const from =
      headers.find((h) => h.name === "From")?.value || "unknown";

    const attachments = extractAttachmentParts(res.data.payload ?? undefined);

    if (attachments.length === 0) {
      return {
        result: `📧 "${subject}" from ${from} — No attachments found.`,
        attachments: [],
      };
    }

    const lines = attachments.map(
      (a, i) =>
        `${i + 1}. 📎 ${a.filename} (${a.mimeType}, ${Math.round(a.size / 1024)}KB)\n   attachment_id: ${a.attachmentId}`
    );

    return {
      result: `📧 "${subject}" from ${from}\n📎 ${attachments.length} attachment(s):\n\n${lines.join("\n\n")}`,
      attachments,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { result: `Gmail error: ${msg}`, attachments: [] };
  }
}

/**
 * Download a specific attachment from a message.
 * Saves to workspace and returns the buffer.
 */
export async function downloadAttachment(
  accountName: GmailAccountName,
  messageId: string,
  attachmentId: string,
  filename?: string
): Promise<{
  result: string;
  file?: { buffer: Buffer; filename: string; mimeType: string };
}> {
  const gmail = getGmailClient(accountName);
  if (!gmail) return { result: `Account "${accountName}" not configured.` };

  try {
    // If no filename provided, look it up from the message
    let resolvedFilename = filename || "";
    let mimeType = "application/octet-stream";

    if (!resolvedFilename) {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });
      const attachments = extractAttachmentParts(msg.data.payload ?? undefined);
      const match = attachments.find((a) => a.attachmentId === attachmentId);
      if (match) {
        resolvedFilename = match.filename;
        mimeType = match.mimeType;
      } else {
        resolvedFilename = `attachment_${Date.now()}`;
      }
    }

    // Download the attachment data
    const res = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });

    if (!res.data.data) {
      return { result: "Attachment download returned empty data." };
    }

    // Gmail API returns base64url encoded data
    const buffer = Buffer.from(res.data.data, "base64url");

    // Save to workspace
    await fs.mkdir(WORKSPACE, { recursive: true });
    const filePath = path.join(WORKSPACE, resolvedFilename);
    await fs.writeFile(filePath, buffer);

    log.info(
      { account: accountName, messageId, filename: resolvedFilename, sizeKB: Math.round(buffer.length / 1024) },
      "Attachment downloaded"
    );

    return {
      result: `✅ Downloaded: ${resolvedFilename} (${Math.round(buffer.length / 1024)}KB) — saved to workspace`,
      file: { buffer, filename: resolvedFilename, mimeType },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, accountName, messageId, attachmentId }, "Attachment download failed");
    return { result: `Gmail attachment error: ${msg}` };
  }
}
