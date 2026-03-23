import { log } from "../logger.js";
import type { Bot } from "grammy";
import { getDirective } from "../directives.js";
import {
  getInitializedAccounts,
  getGmailClient,
  getAccountConfig,
  type GmailAccountName,
} from "./client.js";

// ── Gmail Notifications via Polling ─────────────────────
// Note: Full Pub/Sub requires a public HTTPS endpoint.
// For Docker deployment, we use lightweight polling instead.
// Can be upgraded to Pub/Sub when a webhook endpoint is available.

let bot: Bot | null = null;
let chatId: number = 0;
let pollInterval: ReturnType<typeof setInterval> | null = null;
const lastHistoryIds = new Map<GmailAccountName, string>();

/**
 * Set the bot reference for sending notifications.
 */
export function setGmailNotificationBot(b: Bot, targetChatId: number): void {
  bot = b;
  chatId = targetChatId;
}

/**
 * Start polling for new emails across all accounts.
 */
export function startGmailNotifications(intervalMs: number = 60_000): void {
  if (!bot || chatId === 0) {
    log.warn("Gmail notifications not started — bot or chatId not set");
    return;
  }

  const accounts = getInitializedAccounts();
  if (accounts.length === 0) return;

  // Initialize history IDs
  for (const account of accounts) {
    initHistoryId(account);
  }

  pollInterval = setInterval(async () => {
    for (const account of accounts) {
      await checkNewEmails(account);
    }
  }, intervalMs);

  log.info(
    { accounts: accounts.length, intervalMs },
    "📬 Gmail notification polling started"
  );
}

/**
 * Stop polling.
 */
export function stopGmailNotifications(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * Initialize the history ID for an account.
 */
async function initHistoryId(accountName: GmailAccountName): Promise<void> {
  const gmail = getGmailClient(accountName);
  if (!gmail) return;

  try {
    const profile = await gmail.users.getProfile({ userId: "me" });
    const historyId = profile.data.historyId;
    if (historyId) {
      lastHistoryIds.set(accountName, historyId);
      log.info({ account: accountName, historyId }, "Gmail history ID initialized");
    }
  } catch (err) {
    log.error({ account: accountName, err }, "Failed to get Gmail history ID");
  }
}

/**
 * Check for new emails since last history ID.
 */
async function checkNewEmails(accountName: GmailAccountName): Promise<void> {
  const gmail = getGmailClient(accountName);
  const lastHistoryId = lastHistoryIds.get(accountName);
  if (!gmail || !lastHistoryId || !bot || chatId === 0) return;

  // Check if email notifications are disabled via directive
  try {
    const directive = await getDirective("email_notifications");
    if (directive?.active && directive.content.toLowerCase().includes("disabled")) {
      return; // Notifications disabled by directive — skip silently
    }
  } catch {
    // If directive check fails, proceed with notifications as normal
  }

  try {
    const history = await gmail.users.history.list({
      userId: "me",
      startHistoryId: lastHistoryId,
      historyTypes: ["messageAdded"],
      labelId: "INBOX",
    });

    // Update history ID
    if (history.data.historyId) {
      lastHistoryIds.set(accountName, history.data.historyId);
    }

    const records = history.data.history || [];
    if (records.length === 0) return;

    // Collect new message IDs
    const newMessageIds: string[] = [];
    for (const record of records) {
      for (const added of record.messagesAdded || []) {
        if (added.message?.id && added.message?.labelIds?.includes("INBOX")) {
          newMessageIds.push(added.message.id);
        }
      }
    }

    if (newMessageIds.length === 0) return;

    // Notify for each new message (max 3 to avoid spam)
    const toNotify = newMessageIds.slice(0, 3);
    for (const msgId of toNotify) {
      try {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: msgId,
          format: "metadata",
          metadataHeaders: ["From", "Subject"],
        });

        const headers = msg.data.payload?.headers || [];
        const from = headers.find((h) => h.name === "From")?.value || "unknown";
        const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
        const account = getAccountConfig(accountName);

        await bot.api.sendMessage(
          chatId,
          `📬 *Nuevo email* (${accountName})\n` +
            `📧 ${account?.email}\n` +
            `👤 De: ${from}\n` +
            `📌 ${subject}`,
          { parse_mode: "Markdown" }
        );

        log.info({ account: accountName, from, subject }, "Gmail notification sent");
      } catch {
        // Ignore individual message errors
      }
    }

    if (newMessageIds.length > 3) {
      const account = getAccountConfig(accountName);
      await bot.api.sendMessage(
        chatId,
        `📬 y ${newMessageIds.length - 3} emails más en ${account?.email}`,
      );
    }
  } catch (err: any) {
    // 404 means history expired, re-init
    if (err?.code === 404) {
      await initHistoryId(accountName);
    } else {
      log.error({ account: accountName, err }, "Gmail notification check failed");
    }
  }
}
