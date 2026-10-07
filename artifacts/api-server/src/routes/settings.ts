import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  GetSettingsResponse,
  RemoveAiProviderParams,
  RemoveAiProviderResponse,
  SaveAiProviderBody,
  SaveAiProviderParams,
  SaveAiProviderResponse,
  TestAiProviderParams,
  TestAiProviderResponse,
} from "@workspace/api-zod";
import {
  db,
  integrationSettingsTable,
  systemStateTable,
  type IntegrationSettings,
} from "@workspace/db";
import { decryptCredentials, encryptCredentials } from "../lib/credential-encryption";
import { gmailRedirectUri } from "../lib/gmail-oauth-utils";
import { testAiProvider } from "../lib/provider-services";

const router: IRouter = Router();

function connectionDetail(
  provider: "openai" | "gemini" | "gmail",
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
    return `The API key and ${row.model ?? "selected"} model were verified.`;
  }
  return provider === "gmail"
    ? "OAuth client credentials are saved. Connect Gmail to grant read-only access."
    : `Credentials are saved for ${row.model ?? "the selected model"}. Test the connection before parsing a CV.`;
}

function providerConnection(
  provider: "openai" | "gemini" | "gmail",
  row: IntegrationSettings | undefined,
) {
  return {
    provider,
    status: row?.status ?? "NOT_CONFIGURED",
    detail: connectionDetail(provider, row),
    configured: Boolean(row),
    model: row?.model ?? null,
    clientId: row?.clientId ?? null,
    connectedEmail: row?.connectedEmail ?? null,
  };
}

router.get("/settings", async (req, res): Promise<void> => {
  const [state] = await db.select().from(systemStateTable).where(eq(systemStateTable.id, "agent")).limit(1);
  const rows = await db.select().from(integrationSettingsTable);
  const byProvider = new Map(rows.map((row) => [row.provider, row]));

  res.json(
    GetSettingsResponse.parse({
      providers: [
        providerConnection("openai", byProvider.get("openai")),
        providerConnection("gemini", byProvider.get("gemini")),
        providerConnection("gmail", byProvider.get("gmail")),
      ],
      applicationMode: state?.applicationMode ?? "approval",
      duplicateProtection: true,
      gmailRedirectUri: gmailRedirectUri(req),
    }),
  );
});

router.put("/settings/providers/:provider", async (req, res): Promise<void> => {
  const params = SaveAiProviderParams.safeParse(req.params);
  const body = SaveAiProviderBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Enter an API key and model for OpenAI or Gemini." });
    return;
  }

  const updatedAt = new Date();
  const [row] = await db
    .insert(integrationSettingsTable)
    .values({
      provider: params.data.provider,
      encryptedCredentials: encryptCredentials({ apiKey: body.data.apiKey }),
      model: body.data.model.trim(),
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

  const result = await testAiProvider(params.data.provider, apiKey, row.model);
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
    res.status(400).json({ error: "Choose OpenAI or Gemini." });
    return;
  }
  await db
    .delete(integrationSettingsTable)
    .where(eq(integrationSettingsTable.provider, params.data.provider));
  res.status(204).send();
});

export default router;
