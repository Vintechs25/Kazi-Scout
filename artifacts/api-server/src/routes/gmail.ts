import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  DisconnectGmailResponse,
  GmailOAuthCallbackQueryParams,
  SaveGmailOAuthConfigBody,
  SaveGmailOAuthConfigResponse,
} from "@workspace/api-zod";
import { db, integrationSettingsTable } from "@workspace/db";
import {
  decryptCredentials,
  encryptCredentials,
} from "../lib/credential-encryption";
import {
  gmailRedirectUri,
  settingsRedirectUri,
} from "../lib/gmail-oauth-utils";

const gmailRouter: IRouter = Router();
export const gmailCallbackRouter: IRouter = Router();
const stateCookieName = "gmail_oauth_state";
const gmailReadOnlyScope = "https://www.googleapis.com/auth/gmail.readonly";

type GmailCredentials = {
  clientSecret: string;
  refreshToken?: string | null;
};

function oauthStateSignature(state: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return createHmac("sha256", secret)
    .update(`gmail-oauth:${state}`)
    .digest("base64url");
}

function validOAuthState(state: unknown, signedCookie: unknown): state is string {
  if (typeof state !== "string" || typeof signedCookie !== "string") return false;
  const [cookieState, signature, extra] = signedCookie.split(".");
  if (extra || cookieState !== state || !signature) return false;
  const expected = Buffer.from(oauthStateSignature(state));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function clearStateCookie(req: Request, res: Response): void {
  res.clearCookie(stateCookieName, {
    httpOnly: true,
    path: "/api/integrations/gmail",
    sameSite: "lax",
    secure: req.secure,
  });
}

function connectionResponse(
  status: "CONFIGURED" | "CONNECTED" | "ERROR",
  clientId: string | null,
  connectedEmail: string | null,
) {
  const detail =
    status === "CONNECTED"
      ? connectedEmail
        ? `Read-only Gmail is connected as ${connectedEmail}.`
        : "Read-only Gmail is connected."
      : status === "ERROR"
        ? "Gmail authorization failed. Review the OAuth setup and try again."
        : "OAuth client credentials are saved. Connect Gmail to grant read-only access.";
  return {
    provider: "gmail" as const,
    status,
    detail,
    configured: true,
    model: null,
    clientId,
    connectedEmail,
  };
}

async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(12_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

gmailRouter.put("/settings/gmail", async (req, res): Promise<void> => {
  const body = SaveGmailOAuthConfigBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Enter a Google OAuth client ID and client secret." });
    return;
  }

  const [previous] = await db
    .select()
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.provider, "gmail"))
    .limit(1);
  if (previous) {
    try {
      const credentials = decryptCredentials<GmailCredentials>(
        previous.encryptedCredentials,
      );
      if (credentials.refreshToken) {
        await revokeGoogleToken(credentials.refreshToken);
      }
    } catch {
      // Replacing the client credentials also clears any unreadable saved token.
    }
  }

  const updatedAt = new Date();
  const [row] = await db
    .insert(integrationSettingsTable)
    .values({
      provider: "gmail",
      encryptedCredentials: encryptCredentials({
        clientSecret: body.data.clientSecret,
        refreshToken: null,
      } satisfies GmailCredentials),
      model: null,
      clientId: body.data.clientId.trim(),
      status: "CONFIGURED",
      connectedEmail: null,
      updatedAt,
      testedAt: null,
    })
    .onConflictDoUpdate({
      target: integrationSettingsTable.provider,
      set: {
        encryptedCredentials: encryptCredentials({
          clientSecret: body.data.clientSecret,
          refreshToken: null,
        } satisfies GmailCredentials),
        model: null,
        clientId: body.data.clientId.trim(),
        status: "CONFIGURED",
        connectedEmail: null,
        updatedAt,
        testedAt: null,
      },
    })
    .returning();

  res.json(
    SaveGmailOAuthConfigResponse.parse(
      connectionResponse(row.status, row.clientId, row.connectedEmail),
    ),
  );
});

gmailRouter.delete("/settings/gmail", async (req, res): Promise<void> => {
  const [row] = await db
    .select()
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.provider, "gmail"))
    .limit(1);

  let googleRevocationConfirmed = false;
  if (row) {
    try {
      const credentials = decryptCredentials<GmailCredentials>(
        row.encryptedCredentials,
      );
      if (credentials.refreshToken) {
        googleRevocationConfirmed = await revokeGoogleToken(
          credentials.refreshToken,
        );
      }
    } catch {
      req.log.warn({ provider: "gmail" }, "Could not open Gmail credentials for revocation");
    }
    await db
      .delete(integrationSettingsTable)
      .where(eq(integrationSettingsTable.provider, "gmail"));
  }

  res.json(
    DisconnectGmailResponse.parse({
      localCredentialsRemoved: true,
      googleRevocationConfirmed,
      message: googleRevocationConfirmed
        ? "Gmail credentials were removed and Google confirmed revocation."
        : "Gmail credentials were removed locally. Google revocation could not be confirmed; review third-party app access in your Google Account.",
    }),
  );
});

gmailRouter.get("/integrations/gmail/connect", async (req, res): Promise<void> => {
  const [row] = await db
    .select()
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.provider, "gmail"))
    .limit(1);
  if (!row?.clientId) {
    res.status(409).json({ error: "Save Google OAuth client credentials first." });
    return;
  }

  let credentials: GmailCredentials;
  try {
    credentials = decryptCredentials<GmailCredentials>(row.encryptedCredentials);
  } catch {
    res.status(409).json({ error: "Saved Google credentials could not be opened. Enter them again." });
    return;
  }

  const state = randomBytes(32).toString("base64url");
  const secure = req.secure;
  res.cookie(stateCookieName, `${state}.${oauthStateSignature(state)}`, {
    httpOnly: true,
    maxAge: 5 * 60 * 1000,
    path: "/api/integrations/gmail",
    sameSite: "lax",
    secure,
  });

  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    access_type: "offline",
    client_id: row.clientId,
    include_granted_scopes: "true",
    prompt: "consent",
    redirect_uri: gmailRedirectUri(req),
    response_type: "code",
    scope: `openid email ${gmailReadOnlyScope}`,
    state,
  }).toString();
  res.redirect(authorizationUrl.toString());
});

gmailCallbackRouter.get(
  "/integrations/gmail/callback",
  async (req, res): Promise<void> => {
    const query = GmailOAuthCallbackQueryParams.safeParse(req.query);
    if (!query.success) {
      clearStateCookie(req, res);
      res.redirect(settingsRedirectUri(req, "error"));
      return;
    }
    const validState = validOAuthState(
      query.data.state,
      req.cookies?.[stateCookieName],
    );
    clearStateCookie(req, res);
    if (!validState) {
      res.redirect(settingsRedirectUri(req, "error"));
      return;
    }
    if (query.data.error) {
      res.redirect(settingsRedirectUri(req, "cancelled"));
      return;
    }
    if (!query.data.code) {
      res.redirect(settingsRedirectUri(req, "error"));
      return;
    }

    const [row] = await db
      .select()
      .from(integrationSettingsTable)
      .where(eq(integrationSettingsTable.provider, "gmail"))
      .limit(1);
    if (!row?.clientId) {
      res.redirect(settingsRedirectUri(req, "error"));
      return;
    }

    let credentials: GmailCredentials;
    try {
      credentials = decryptCredentials<GmailCredentials>(row.encryptedCredentials);
    } catch {
      res.redirect(settingsRedirectUri(req, "error"));
      return;
    }

    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: row.clientId,
          client_secret: credentials.clientSecret,
          code: query.data.code,
          grant_type: "authorization_code",
          redirect_uri: gmailRedirectUri(req),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!tokenResponse.ok) {
        res.redirect(settingsRedirectUri(req, "error"));
        return;
      }

      const tokenPayload = (await tokenResponse.json()) as {
        access_token?: unknown;
        refresh_token?: unknown;
        scope?: unknown;
      };
      if (
        typeof tokenPayload.access_token !== "string" ||
        typeof tokenPayload.scope !== "string" ||
        !tokenPayload.scope.split(" ").includes(gmailReadOnlyScope)
      ) {
        res.redirect(settingsRedirectUri(req, "error"));
        return;
      }

      const refreshToken =
        typeof tokenPayload.refresh_token === "string"
          ? tokenPayload.refresh_token
          : credentials.refreshToken;
      if (!refreshToken) {
        res.redirect(settingsRedirectUri(req, "error"));
        return;
      }

      const profileResponse = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        {
          headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (!profileResponse.ok) {
        res.redirect(settingsRedirectUri(req, "error"));
        return;
      }
      const profile = (await profileResponse.json()) as {
        emailAddress?: unknown;
      };
      const updatedAt = new Date();
      await db
        .update(integrationSettingsTable)
        .set({
          encryptedCredentials: encryptCredentials({
            clientSecret: credentials.clientSecret,
            refreshToken,
          } satisfies GmailCredentials),
          status: "CONNECTED",
          connectedEmail:
            typeof profile.emailAddress === "string" ? profile.emailAddress : null,
          updatedAt,
          testedAt: updatedAt,
        })
        .where(eq(integrationSettingsTable.provider, "gmail"));
      res.redirect(settingsRedirectUri(req, "connected"));
    } catch {
      req.log.warn({ provider: "gmail" }, "Gmail OAuth callback failed");
      res.redirect(settingsRedirectUri(req, "error"));
    }
  },
);

export default gmailRouter;
