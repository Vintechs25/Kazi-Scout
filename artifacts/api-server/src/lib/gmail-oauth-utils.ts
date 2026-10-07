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
