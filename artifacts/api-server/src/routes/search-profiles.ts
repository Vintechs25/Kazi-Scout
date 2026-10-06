import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  CreateSearchProfileBody,
  CreateSearchProfileResponse,
  DeleteSearchProfileParams,
  ListSearchProfilesResponse,
  UpdateSearchProfileBody,
  UpdateSearchProfileParams,
  UpdateSearchProfileResponse,
} from "@workspace/api-zod";
import { db, searchProfilesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/search-profiles", async (_req, res): Promise<void> => {
  const profiles = await db
    .select()
    .from(searchProfilesTable)
    .orderBy(desc(searchProfilesTable.createdAt));
  res.json(
    ListSearchProfilesResponse.parse(
      profiles.map((profile) => ({
        ...profile,
        createdAt: profile.createdAt.toISOString(),
      })),
    ),
  );
});

router.post("/search-profiles", async (req, res): Promise<void> => {
  const parsed = CreateSearchProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [profile] = await db
    .insert(searchProfilesTable)
    .values({ id: crypto.randomUUID(), ...parsed.data, createdAt: new Date() })
    .returning();
  res.status(201).json(
    CreateSearchProfileResponse.parse({
      ...profile,
      createdAt: profile.createdAt.toISOString(),
    }),
  );
});

router.patch("/search-profiles/:id", async (req, res): Promise<void> => {
  const params = UpdateSearchProfileParams.safeParse(req.params);
  const body = UpdateSearchProfileBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid search profile update." });
    return;
  }
  const [profile] = await db
    .update(searchProfilesTable)
    .set(body.data)
    .where(eq(searchProfilesTable.id, params.data.id))
    .returning();
  if (!profile) {
    res.status(404).json({ error: "Search profile not found." });
    return;
  }
  res.json(
    UpdateSearchProfileResponse.parse({
      ...profile,
      createdAt: profile.createdAt.toISOString(),
    }),
  );
});

router.delete("/search-profiles/:id", async (req, res): Promise<void> => {
  const params = DeleteSearchProfileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(searchProfilesTable).where(eq(searchProfilesTable.id, params.data.id));
  res.status(204).end();
});

export default router;
