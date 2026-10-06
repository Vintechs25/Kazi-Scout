import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { GetSettingsResponse } from "@workspace/api-zod";
import { db, systemStateTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/settings", async (_req, res): Promise<void> => {
  const [state] = await db
    .select()
    .from(systemStateTable)
    .where(eq(systemStateTable.id, "agent"))
    .limit(1);

  res.json(
    GetSettingsResponse.parse({
      providers: [
        { provider: "openai", status: "NOT_CONNECTED", detail: "No provider credentials configured." },
        { provider: "gemini", status: "NOT_CONNECTED", detail: "No provider credentials configured." },
        { provider: "gmail", status: "NOT_CONNECTED", detail: "Google OAuth is not configured." },
      ],
      applicationMode: state?.applicationMode ?? "approval",
      duplicateProtection: true,
    }),
  );
});

export default router;
