import { google } from "googleapis";
import { log } from "../logger.js";

export type GoogleAccountName = "personal1" | "personal2" | "work";

export interface GoogleAccountConfig {
  name: GoogleAccountName;
  email: string;
  refreshToken: string;
}

const oauthClients = new Map<GoogleAccountName, any>();
const accounts = new Map<GoogleAccountName, GoogleAccountConfig>();

/**
 * Initialize Google OAuth2 clients for all configured accounts.
 * Falls back to GMAIL_* variables for backwards compatibility.
 */
export function initGoogleAuth(): GoogleAccountName[] {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    log.warn("Google API not configured — missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
    return [];
  }

  const accountConfigs: GoogleAccountConfig[] = [
    {
      name: "personal1",
      email: process.env.GOOGLE_PERSONAL1_EMAIL || process.env.GMAIL_PERSONAL1_EMAIL || "",
      refreshToken: process.env.GOOGLE_PERSONAL1_REFRESH_TOKEN || process.env.GMAIL_PERSONAL1_REFRESH_TOKEN || "",
    },
    {
      name: "personal2",
      email: process.env.GOOGLE_PERSONAL2_EMAIL || process.env.GMAIL_PERSONAL2_EMAIL || "",
      refreshToken: process.env.GOOGLE_PERSONAL2_REFRESH_TOKEN || process.env.GMAIL_PERSONAL2_REFRESH_TOKEN || "",
    },
    {
      name: "work",
      email: process.env.GOOGLE_WORK_EMAIL || process.env.GMAIL_WORK_EMAIL || "",
      refreshToken: process.env.GOOGLE_WORK_REFRESH_TOKEN || process.env.GMAIL_WORK_REFRESH_TOKEN || "",
    },
  ];

  const initialized: GoogleAccountName[] = [];

  for (const account of accountConfigs) {
    if (!account.email || !account.refreshToken) continue;

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: account.refreshToken });

    oauthClients.set(account.name, oauth2);
    accounts.set(account.name, account);
    initialized.push(account.name);

    log.info({ account: account.name, email: account.email }, "Google OAuth account initialized");
  }

  return initialized;
}

/**
 * Get an OAuth2 client by account name.
 */
export function getGoogleOAuthClient(name: GoogleAccountName) {
  return oauthClients.get(name);
}

/**
 * Get account config by name.
 */
export function getGoogleAccountConfig(name: GoogleAccountName): GoogleAccountConfig | undefined {
  return accounts.get(name);
}

/**
 * Get all initialized account names.
 */
export function getInitializedGoogleAccounts(): GoogleAccountName[] {
  return Array.from(oauthClients.keys());
}

/**
 * Resolve account name from user input (fuzzy matching).
 */
export function resolveGoogleAccount(input?: string): GoogleAccountName | undefined {
  if (!input) {
    // Default to first available
    const first = getInitializedGoogleAccounts()[0];
    return first;
  }

  const lower = input.toLowerCase().trim();

  // Direct match
  if (oauthClients.has(lower as GoogleAccountName)) {
    return lower as GoogleAccountName;
  }

  // Fuzzy match
  if (lower.includes("trabajo") || lower.includes("work") || lower.includes("oficina")) {
    return oauthClients.has("work") ? "work" : undefined;
  }
  if (lower.includes("personal") || lower.includes("1") || lower.includes("principal")) {
    return oauthClients.has("personal1") ? "personal1" : undefined;
  }
  if (lower.includes("2") || lower.includes("segunda") || lower.includes("otro")) {
    return oauthClients.has("personal2") ? "personal2" : undefined;
  }

  // Match by email
  for (const [name, config] of accounts.entries()) {
    if (config.email.toLowerCase().includes(lower)) {
      return name;
    }
  }

  return undefined;
}
