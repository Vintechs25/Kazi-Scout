import fs from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { Router, type IRouter } from "express";
import { eq, or, isNull } from "drizzle-orm";
import {
  GetSettingsResponse,
  RemoveAiProviderParams,
  RemoveAiProviderResponse,
  SaveAiProviderBody,
  SaveAiProviderParams,
  SaveAiProviderResponse,
  SetDefaultAiProviderBody,
  TestAiProviderParams,
  TestAiProviderResponse,
} from "@workspace/api-zod";
import {
  activityTable,
  applicationsTable,
  candidateProfilesTable,
  cvsTable,
  db,
  integrationSettingsTable,
  jobsTable,
  searchProfilesTable,
  systemStateTable,
  type IntegrationSettings,
} from "@workspace/db";
import { decryptCredentials, encryptCredentials } from "../lib/credential-encryption";
import { gmailRedirectUri } from "../lib/gmail-oauth-utils";
import { testAiProvider } from "../lib/provider-services";
import { getAuthenticatedAccountId } from "../lib/auth";

const router: IRouter = Router();

function getAccountId(req: any, res: any): string {
  return res?.locals?.accountId || getAuthenticatedAccountId(req) || "local";
}

function connectionDetail(
  provider: "openai" | "gemini" | "gmail" | "agentrouter" | "openrouter",
  row: IntegrationSettings | undefined,
): string {
  if (!row) {
    return provider === "gmail"
      ? "Google OAuth credentials are not configured."
      : "API credentials are not configured.";
  }
  if (row.status === "ERROR") {
    return "The last connection check failed. Review the saved credentials and try again.";
  }
  if (row.status === "CONNECTED") {
    if (provider === "gmail") {
      return row.connectedEmail
        ? `Read-only Gmail is connected as ${row.connectedEmail}.`
        : "Read-only Gmail is connected.";
    }
    if (provider === "agentrouter") {
      return `The Agent Router API key and ${row.model ?? "selected"} model were verified.`;
    }
    return `The API key and ${row.model ?? "selected"} model were verified.`;
  }
  return provider === "gmail"
    ? "OAuth client credentials are saved. Connect Gmail to grant read-only access."
    : `Credentials are saved for ${row.model ?? "the selected model"}. Test the connection before parsing a CV.`;
}

function providerConnection(
  provider: "openai" | "gemini" | "gmail" | "agentrouter" | "openrouter",
  row: IntegrationSettings | undefined,
  defaultAiProvider?: string,
) {
  return {
    provider,
    status: row?.status ?? "NOT_CONFIGURED",
    detail: connectionDetail(provider, row),
    configured: Boolean(row),
    model: row?.model ?? null,
    baseUrl: row?.baseUrl ?? null,
    clientId: row?.clientId ?? null,
    connectedEmail: row?.connectedEmail ?? null,
    isDefault: defaultAiProvider === provider,
  };
}

router.get("/settings", async (req, res): Promise<void> => {
  const [state] = await db.select().from(systemStateTable).where(eq(systemStateTable.id, "agent")).limit(1);
  const rows = await db.select().from(integrationSettingsTable);
  const byProvider = new Map(rows.map((row) => [row.provider, row]));

  res.json(
    GetSettingsResponse.parse({
      providers: [
        providerConnection("agentrouter", byProvider.get("agentrouter"), state?.defaultAiProvider),
        providerConnection("gemini", byProvider.get("gemini"), state?.defaultAiProvider),
        providerConnection("openai", byProvider.get("openai"), state?.defaultAiProvider),
        providerConnection("gmail", byProvider.get("gmail"), state?.defaultAiProvider),
      ],
      defaultAiProvider: state?.defaultAiProvider ?? "auto",
      applicationMode: state?.applicationMode ?? "approval",
      duplicateProtection: true,
      gmailRedirectUri: gmailRedirectUri(req),
    }),
  );
});

router.patch("/settings/default-provider", async (req, res): Promise<void> => {
  const body = SetDefaultAiProviderBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid default provider. Choose auto, agentrouter, gemini, or openai." });
    return;
  }

  const updatedAt = new Date();
  await db
    .update(systemStateTable)
    .set({
      defaultAiProvider: body.data.provider,
      updatedAt,
    })
    .where(eq(systemStateTable.id, "agent"));

  res.json({
    success: true,
    defaultAiProvider: body.data.provider,
  });
});

router.put("/settings/providers/:provider", async (req, res): Promise<void> => {
  const params = SaveAiProviderParams.safeParse(req.params);
  const body = SaveAiProviderBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Enter an API key and model for OpenAI, Gemini, or Agent Router." });
    return;
  }

  const updatedAt = new Date();
  const baseUrl = body.data.baseUrl?.trim() || null;
  const [row] = await db
    .insert(integrationSettingsTable)
    .values({
      provider: params.data.provider,
      encryptedCredentials: encryptCredentials({ apiKey: body.data.apiKey }),
      model: body.data.model.trim(),
      baseUrl,
      clientId: null,
      status: "CONFIGURED",
      connectedEmail: null,
      updatedAt,
      testedAt: null,
    })
    .onConflictDoUpdate({
      target: integrationSettingsTable.provider,
      set: {
        encryptedCredentials: encryptCredentials({ apiKey: body.data.apiKey }),
        model: body.data.model.trim(),
        baseUrl,
        clientId: null,
        status: "CONFIGURED",
        connectedEmail: null,
        updatedAt,
        testedAt: null,
      },
    })
    .returning();

  res.json(SaveAiProviderResponse.parse(providerConnection(params.data.provider, row)));
});

router.post("/settings/providers/:provider/test", async (req, res): Promise<void> => {
  const params = TestAiProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Choose OpenAI or Gemini." });
    return;
  }
  const [row] = await db
    .select()
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.provider, params.data.provider))
    .limit(1);
  if (!row) {
    res.status(409).json({ error: "Configure this provider before testing it." });
    return;
  }

  let apiKey: string;
  try {
    const credentials = decryptCredentials<{ apiKey?: unknown }>(row.encryptedCredentials);
    if (typeof credentials.apiKey !== "string" || !row.model) {
      throw new Error("Saved credentials are incomplete.");
    }
    apiKey = credentials.apiKey;
  } catch {
    res.status(409).json({ error: "Saved credentials could not be opened. Enter the API key again." });
    return;
  }

  const result = await testAiProvider(params.data.provider, apiKey, row.model, row.baseUrl);
  const testedAt = new Date();
  await db
    .update(integrationSettingsTable)
    .set({
      status: result.success ? "CONNECTED" : "ERROR",
      testedAt,
      updatedAt: testedAt,
    })
    .where(eq(integrationSettingsTable.provider, params.data.provider));

  res.json(
    TestAiProviderResponse.parse({
      ...result,
      testedAt: testedAt.toISOString(),
    }),
  );
});

router.delete("/settings/providers/:provider", async (req, res): Promise<void> => {
  const params = RemoveAiProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Choose OpenAI, Gemini, or Agent Router." });
    return;
  }
  await db
    .delete(integrationSettingsTable)
    .where(eq(integrationSettingsTable.provider, params.data.provider));
  res.status(204).send();
});

router.post("/settings/providers/:provider/models", async (req, res): Promise<void> => {
  const params = SaveAiProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Choose OpenAI, Gemini, or Agent Router." });
    return;
  }

  let { apiKey, baseUrl } = req.body as { apiKey?: string; baseUrl?: string };
  let dbBaseUrl: string | null = null;

  // If no apiKey in request body, retrieve saved credentials from database
  if (!apiKey || !apiKey.trim() || !baseUrl) {
    const [row] = await db
      .select()
      .from(integrationSettingsTable)
      .where(eq(integrationSettingsTable.provider, params.data.provider))
      .limit(1);

    if (row) {
      dbBaseUrl = row.baseUrl;
      if (!apiKey || !apiKey.trim()) {
        try {
          const credentials = decryptCredentials<{ apiKey?: unknown }>(row.encryptedCredentials);
          if (typeof credentials.apiKey === "string" && credentials.apiKey.trim()) {
            apiKey = credentials.apiKey.trim();
          }
        } catch {
          // Ignored
        }
      }
    }
  }

  if (!apiKey || !apiKey.trim()) {
    res.status(400).json({ error: "Enter an API key or save credentials first to list models." });
    return;
  }

  const { listModels } = await import("../lib/provider-services");
  const effectiveBaseUrl = baseUrl || dbBaseUrl;
  const result = await listModels(params.data.provider, apiKey, effectiveBaseUrl);

  if (!result.success) {
    res.status(400).json({ error: result.message || "Failed to list models." });
    return;
  }

  res.json({
    success: true,
    models: result.models,
  });
});

router.post("/settings/wipe-data", async (req, res): Promise<void> => {
  try {
    const accountId = getAccountId(req, res);
    const appAccountFilter = accountId === "local"
      ? or(eq(applicationsTable.accountId, "local"), isNull(applicationsTable.accountId))
      : eq(applicationsTable.accountId, accountId);
    const jobAccountFilter = accountId === "local"
      ? or(eq(jobsTable.accountId, "local"), isNull(jobsTable.accountId))
      : eq(jobsTable.accountId, accountId);
    const cvAccountFilter = accountId === "local"
      ? or(eq(cvsTable.accountId, "local"), isNull(cvsTable.accountId))
      : eq(cvsTable.accountId, accountId);
    const spAccountFilter = accountId === "local"
      ? or(eq(searchProfilesTable.accountId, "local"), isNull(searchProfilesTable.accountId))
      : eq(searchProfilesTable.accountId, accountId);
    const actAccountFilter = accountId === "local"
      ? or(eq(activityTable.accountId, "local"), isNull(activityTable.accountId))
      : eq(activityTable.accountId, accountId);
    const cpAccountFilter = accountId === "local"
      ? or(eq(candidateProfilesTable.id, "primary"), eq(candidateProfilesTable.id, "local"))
      : eq(candidateProfilesTable.id, accountId);

    // 0. Stop background agent so it doesn't immediately rediscover jobs
    try {
      const { handleAgentCommand } = await import("../lib/agent-worker");
      await handleAgentCommand("stop");
    } catch {
      // ignore
    }

    // 1. Delete user CVs and remove physical files from storage
    const allCvs = await db.select().from(cvsTable).where(cvAccountFilter);
    const custom = process.env.CV_STORAGE_PATH ?? (process.env.VERCEL ? "/tmp/cvs" : "storage/cvs");
    const storageDirCandidates = [
      path.resolve(process.cwd(), custom),
      path.resolve(process.cwd(), "..", custom),
      path.resolve(process.cwd(), "../..", custom),
    ];
    let resolvedStorageDir = path.resolve(process.cwd(), custom);
    for (const c of storageDirCandidates) {
      if (fs.existsSync(c)) {
        resolvedStorageDir = c;
        break;
      }
    }
    for (const cv of allCvs) {
      try {
        await unlink(path.join(resolvedStorageDir, cv.storageName));
      } catch {
        // ignore if already deleted
      }
    }

    // 2. Delete records belonging to this account
    await db.delete(applicationsTable).where(appAccountFilter);
    await db.delete(jobsTable).where(jobAccountFilter);
    await db.delete(cvsTable).where(cvAccountFilter);
    await db.delete(searchProfilesTable).where(spAccountFilter);
    await db.delete(candidateProfilesTable).where(cpAccountFilter);
    await db.delete(activityTable).where(actAccountFilter);

    // 3. Invalidate memory caches
    try {
      const { invalidateCandidateEvidence } = await import("../lib/candidate-evidence");
      const { invalidateSearchDirective } = await import("../lib/search-directive");
      invalidateCandidateEvidence(accountId);
      invalidateSearchDirective(accountId);
    } catch {
      // ignore
    }

    // 4. Insert initial fresh activity log entry for this account
    await db.insert(activityTable).values({
      id: crypto.randomUUID(),
      accountId,
      kind: "system",
      message: "Personal workspace data wiped by user. All API keys and connection settings remain safely preserved.",
      createdAt: new Date(),
    });

    res.json({
      success: true,
      message: "All personal data (profiles, CVs, jobs, applications, activity logs) was successfully wiped for your account. API keys and configuration settings were preserved.",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to wipe workspace data." });
  }
});

export default router;
