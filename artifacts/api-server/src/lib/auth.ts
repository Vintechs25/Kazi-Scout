import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const cookieName = "job_agent_session";
const sessionDurationMs = 12 * 60 * 60 * 1000;
export const sessionCookieName = "job_agent_session";
const secret = process.env.SESSION_SECRET ?? "";

if (!secret || secret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
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
  return `${sessionCookieName}=${encodeURIComponent(`${payload}.${sign(payload)}`)}; Path=/api; Max-Age=${sessionDurationMs / 1000}; HttpOnly; SameSite=Strict${secure}`;
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
    const host =
      req.get("x-forwarded-host")?.split(",")[0]?.trim() ?? req.get("host");
    const protocol =
      req.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? req.protocol;
    let matchesRequestOrigin = false;
    try {
      const parsedOrigin = new URL(origin);
      matchesRequestOrigin =
        parsedOrigin.host.toLowerCase() === host?.toLowerCase() &&
        parsedOrigin.protocol.replace(":", "") === protocol;
    } catch {
      matchesRequestOrigin = false;
    }
    if (!matchesRequestOrigin) {
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
  return `${sessionCookieName}=; Path=/api; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
}
