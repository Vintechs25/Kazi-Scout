import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { eq, or } from "drizzle-orm";
import {
  GetAuthStatusResponse,
  LoginLocalAccountBody,
  LoginLocalAccountResponse,
  LogoutLocalAccountResponse,
  SetupLocalAccountBody,
  SetupLocalAccountResponse,
} from "@workspace/api-zod";
import { accountsTable, candidateProfilesTable, db } from "@workspace/db";
import {
  createSessionCookie,
  expiredSessionCookie,
  getAuthenticatedAccountId,
  sessionCookieName,
} from "../lib/auth";

const router: IRouter = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();
const windowMs = 5 * 60 * 1000;
const maxAttempts = 20;

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

function sendSession(res: Response, accountId: string): void {
  res.setHeader("Set-Cookie", createSessionCookie(accountId));
}

/**
 * GET /api/auth/status
 * Returns authentication state and user details if signed in
 */
router.get("/auth/status", async (req, res): Promise<void> => {
  try {
    const accountId = getAuthenticatedAccountId(req.cookies?.[sessionCookieName]);
    let activeAccount: typeof accountsTable.$inferSelect | undefined;

    if (accountId) {
      const [found] = await db
        .select()
        .from(accountsTable)
        .where(eq(accountsTable.id, accountId))
        .limit(1);
      activeAccount = found;
    }

    const [anyAccount] = await db.select({ id: accountsTable.id }).from(accountsTable).limit(1);
    const authenticated = Boolean(activeAccount);

    res.json({
      setupRequired: !anyAccount,
      authenticated,
      user: activeAccount
        ? {
            id: activeAccount.id,
            email: activeAccount.email || "user@local.desk",
            name: activeAccount.name || "Candidate",
            profession: activeAccount.profession || null,
          }
        : null,
    });
  } catch (error) {
    console.error("[Auth Status Error]:", error instanceof Error ? error.message : String(error));
    res.status(500).json({
      error: "The request could not be completed.",
      details: error instanceof Error ? error.message : "Database unavailable",
    });
  }
});

/**
 * POST /api/auth/register
 * Universal registration endpoint for candidates across all career disciplines
 */
router.post("/auth/register", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many registration attempts. Please wait a few minutes." });
    return;
  }

  const { name, email, password, profession } = req.body || {};

  if (!name || typeof name !== "string" || name.trim().length < 2) {
    res.status(400).json({ error: "Please enter your full name (at least 2 characters)." });
    return;
  }

  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: "Please enter a valid email address." });
    return;
  }

  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Choose a secure password with at least 8 characters." });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // Check if email already registered
    const [existing] = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(eq(accountsTable.email, normalizedEmail))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: "An account with this email address already exists. Please sign in instead." });
      return;
    }

    const accountId = `acc_${randomBytes(12).toString("hex")}`;
    const salt = randomBytes(16).toString("hex");
    const passwordHash = passwordDigest(password, salt).toString("hex");

    await db.insert(accountsTable).values({
      id: accountId,
      email: normalizedEmail,
      name: name.trim(),
      profession: profession ? String(profession).trim() : null,
      passwordSalt: salt,
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Initialize candidate profile with identity and career preference
    try {
      await db.insert(candidateProfilesTable).values({
        id: accountId,
        fullName: name.trim(),
        email: normalizedEmail,
        targetRoles: profession ? [String(profession).trim()] : [],
        updatedAt: new Date(),
      });
    } catch (profErr) {
      console.warn("[Auth] Candidate profile pre-seed notice:", profErr);
    }

    attempts.delete(ip);
    sendSession(res, accountId);

    res.status(201).json({
      success: true,
      authenticated: true,
      setupRequired: false,
      user: {
        id: accountId,
        email: normalizedEmail,
        name: name.trim(),
        profession: profession ? String(profession).trim() : null,
      },
    });
  } catch (err: any) {
    console.error("[Auth Register Error]:", err);
    res.status(500).json({
      error: "Unable to create account. Please try again.",
      details: err?.message,
    });
  }
});

/**
 * POST /api/auth/login
 * Universal login endpoint supporting email/password or legacy password
 */
router.post("/auth/login", async (req, res): Promise<void> => {
  const ip = req.ip ?? "unknown";
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many sign-in attempts. Try again in a few minutes." });
    return;
  }

  const { email, username, password } = req.body || {};
  const identifier = (email || username || "").trim().toLowerCase();

  if (!password || typeof password !== "string") {
    res.status(400).json({ error: "Please enter your password." });
    return;
  }

  try {
    let account: typeof accountsTable.$inferSelect | undefined;

    if (identifier) {
      // Find by email or account ID
      const [found] = await db
        .select()
        .from(accountsTable)
        .where(or(eq(accountsTable.email, identifier), eq(accountsTable.id, identifier)))
        .limit(1);
      account = found;
    } else {
      // Legacy backward compatibility: find local or first account
      const [found] = await db
        .select()
        .from(accountsTable)
        .where(eq(accountsTable.id, "local"))
        .limit(1);
      if (found) {
        account = found;
      } else {
        const [first] = await db.select().from(accountsTable).limit(1);
        account = first;
      }
    }

    if (!account) {
      res.status(401).json({ error: "Invalid credentials. Please check your email and password." });
      return;
    }

    const attempted = passwordDigest(password, account.passwordSalt);
    const stored = Buffer.from(account.passwordHash, "hex");

    if (attempted.length !== stored.length || !timingSafeEqual(attempted, stored)) {
      res.status(401).json({ error: "Invalid credentials. Password did not match." });
      return;
    }

    attempts.delete(ip);
    sendSession(res, account.id);

    res.json({
      success: true,
      setupRequired: false,
      authenticated: true,
      user: {
        id: account.id,
        email: account.email || "user@local.desk",
        name: account.name || "Candidate",
        profession: account.profession || null,
      },
    });
  } catch (err: any) {
    console.error("[Auth Login Error]:", err);
    res.status(500).json({ error: "Login failed.", details: err?.message });
  }
});

/**
 * POST /api/auth/setup
 * Legacy workspace setup (backward compatibility)
 */
router.post("/auth/setup", async (req, res): Promise<void> => {
  const parsed = SetupLocalAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a password with at least 12 characters." });
    return;
  }

  const [existing] = await db.select({ id: accountsTable.id }).from(accountsTable).limit(1);
  if (existing) {
    res.status(409).json({ error: "Account setup is already complete. Please sign in." });
    return;
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = passwordDigest(parsed.data.password, salt).toString("hex");
  try {
    await db.insert(accountsTable).values({
      id: "local",
      email: "local@desk.workspace",
      name: "Workspace Owner",
      passwordSalt: salt,
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } catch {
    res.status(409).json({ error: "Account setup is already complete." });
    return;
  }

  sendSession(res, "local");
  res.json(SetupLocalAccountResponse.parse({ setupRequired: false, authenticated: true }));
});

/**
 * POST /api/auth/logout
 * Destroys session
 */
router.post("/auth/logout", (_req, res): void => {
  res.setHeader("Set-Cookie", expiredSessionCookie());
  res.status(200).json({ success: true, message: "Logged out successfully" });
});

export default router;
