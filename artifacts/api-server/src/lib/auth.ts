import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const cookieName = "job_agent_session";
const sessionDurationMs = 12 * 60 * 60 * 1000;
export const sessionCookieName = "job_agent_session";
let secret = process.env.SESSION_SECRET ?? "";

if (!secret || secret.length < 32) {
  secret = "dev_secret_key_1234567890abcdefghijklmnopqrstuv";
  process.env.SESSION_SECRET = secret;
}

function sign(payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionCookie(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: accountId, exp: Date.now() + sessionDurationMs }),
  ).toString("base64url");
  const secure =
    process.env.NODE_ENV === "production" && process.env.LOCAL_APP !== "true"
      ? "; Secure"
      : "";
  return `${sessionCookieName}=${encodeURIComponent(`${payload}.${sign(payload)}`)}; Path=/; Max-Age=${sessionDurationMs / 1000}; HttpOnly; SameSite=Lax${secure}`;
}

export function verifySession(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      typeof session.sub === "string" &&
      session.sub.length > 0 &&
      typeof session.exp === "number" &&
      session.exp > Date.now()
    ) {
      return session.sub;
    }
  } catch {
    return null;
  }
  return null;
}

export const requireSameOrigin: RequestHandler = (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }
  const origin = req.get("origin");
  if (origin) {
    let allowed = false;
    try {
      const parsedOrigin = new URL(origin);
      const originHost = parsedOrigin.hostname.toLowerCase();

      // Allow local development
      if (originHost === "localhost" || originHost === "127.0.0.1" || originHost.endsWith(".local")) {
        allowed = true;
      }

      // Allow Vintech Systems custom domains
      if (originHost === "vintechsystems.store" || originHost.endsWith(".vintechsystems.store")) {
        allowed = true;
      }

      // Allow Vercel deployment domains
      if (originHost === "vercel.app" || originHost.endsWith(".vercel.app")) {
        allowed = true;
      }

      // Match against request host and x-forwarded-host
      const rawHost = req.get("x-forwarded-host") || req.get("host") || "";
      const currentHosts = rawHost
        .split(",")
        .map((h) => h.trim().toLowerCase().split(":")[0]);

      if (currentHosts.includes(originHost)) {
        allowed = true;
      }

      // Match against Vercel project environment URLs
      const vercelHost = (process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "")
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .split("/")[0]
        .split(":")[0];
      if (vercelHost && originHost === vercelHost) {
        allowed = true;
      }
    } catch {
      allowed = false;
    }

    if (!allowed) {
      res.status(403).json({ error: "Cross-origin requests are not allowed." });
      return;
    }
  }
  next();
};

export const requireAuth: RequestHandler = (req, res, next) => {
  const accountId = verifySession(req.cookies?.[sessionCookieName]);
  if (!accountId) {
    res.status(401).json({ error: "Sign in to use the local job workspace." });
    return;
  }
  res.locals.accountId = accountId;
  next();
};

export function getAuthenticatedAccountId(cookieValue: unknown): string | null {
  return verifySession(cookieValue);
}

export function expiredSessionCookie(): string {
  const secure =
    process.env.NODE_ENV === "production" && process.env.LOCAL_APP !== "true"
      ? "; Secure"
      : "";
  return `${sessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}
