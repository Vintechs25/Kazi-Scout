import type { Request } from "express";

function requestOrigin(req: Request): string {
  const configuredOrigin = process.env.PUBLIC_ORIGIN?.trim();
  if (configuredOrigin) {
    return new URL(configuredOrigin).origin;
  }

  const host =
    req.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    req.get("host") ??
    "localhost";
  const protocol =
    req.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? req.protocol;
  return new URL(`${protocol}://${host}`).origin;
}

export function gmailRedirectUri(req: Request): string {
  return new URL("/api/integrations/gmail/callback", requestOrigin(req)).toString();
}

export function settingsRedirectUri(req: Request, result: string): string {
  const url = new URL("/settings", requestOrigin(req));
  url.searchParams.set("gmail", result);
  return url.toString();
}

// Gmail scopes for read-write access (comma-separated)
export const GMAIL_SCOPES = {
  READ_ONLY: "https://www.googleapis.com/auth/gmail.readonly",
  READ_WRITE: "https://www.googleapis.com/auth/gmail.modify",
  SEND: "https://www.googleapis.com/auth/gmail.send",
  FULL: "https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send",
} as const;

// Get the appropriate scope based on application mode
export function getGmailScope(applicationMode: string): string {
  // If application mode allows automatic sending, use send scope
  if (applicationMode === "automatic") {
    return GMAIL_SCOPES.FULL;
  }
  // For approval mode, read-only is sufficient for now
  return GMAIL_SCOPES.READ_ONLY;
}
