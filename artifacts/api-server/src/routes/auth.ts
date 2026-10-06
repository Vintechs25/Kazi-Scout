import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  GetAuthStatusResponse,
  LoginLocalAccountBody,
  LoginLocalAccountResponse,
  LogoutLocalAccountResponse,
  SetupLocalAccountBody,
  SetupLocalAccountResponse,
} from "@workspace/api-zod";
import { accountsTable, db } from "@workspace/db";
import {
  createSessionCookie,
  expiredSessionCookie,
  getAuthenticatedAccountId,
  sessionCookieName,
} from "../lib/auth";

const router: IRouter = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();
const windowMs = 5 * 60 * 1000;
const maxAttempts = 10;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const current = attempts.get(ip);
  if (!current || current.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  return current.count > maxAttempts;
}

function passwordDigest(password: string, salt: string): Buffer {
  return scryptSync(password, salt, 64);
}

async function accountExists(): Promise<boolean> {
  const [account] = await db.select({ id: accountsTable.id }).from(accountsTable).limit(1);
  return Boolean(account);
}

function sendSession(res: Response, accountId: string): void {
  res.setHeader("Set-Cookie", createSessionCookie(accountId));
}

router.get("/auth/status", async (req, res): Promise<void> => {
  const [account] = await db.select({ id: accountsTable.id }).from(accountsTable).limit(1);
  const authenticated =
    Boolean(account) &&
    getAuthenticatedAccountId(req.cookies?.[sessionCookieName]) === account?.id;
  res.json(
    GetAuthStatusResponse.parse({
      setupRequired: !account,
      authenticated,
    }),
  );
});

router.post("/auth/setup", async (req, res): Promise<void> => {
  const parsed = SetupLocalAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a password with at least 12 characters." });
    return;
  }
  if (await accountExists()) {
    res.status(409).json({ error: "Local account setup is already complete." });
    return;
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = passwordDigest(parsed.data.password, salt).toString("hex");
  try {
    await db.insert(accountsTable).values({
      id: "local",
      passwordSalt: salt,
      passwordHash,
    });
  } catch {
    res.status(409).json({ error: "Local account setup is already complete." });
    return;
  }

  sendSession(res, "local");
  res.json(
    SetupLocalAccountResponse.parse({ setupRequired: false, authenticated: true }),
  );
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many sign-in attempts. Try again in a few minutes." });
    return;
  }
  const parsed = LoginLocalAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your local account password." });
    return;
  }
  const [account] = await db.select().from(accountsTable).limit(1);
  if (!account) {
    res.status(409).json({ error: "Set up the local account before signing in." });
    return;
  }
  const attempted = passwordDigest(parsed.data.password, account.passwordSalt);
  const stored = Buffer.from(account.passwordHash, "hex");
  if (attempted.length !== stored.length || !timingSafeEqual(attempted, stored)) {
    res.status(401).json({ error: "Password did not match." });
    return;
  }

  attempts.delete(ip);
  sendSession(res, account.id);
  res.json(LoginLocalAccountResponse.parse({ setupRequired: false, authenticated: true }));
});

router.post("/auth/logout", (_req, res): void => {
  res.setHeader("Set-Cookie", expiredSessionCookie());
  res.status(204).end();
  LogoutLocalAccountResponse.parse(undefined);
});


export default router;
