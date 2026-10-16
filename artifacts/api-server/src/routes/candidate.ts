import { Router, type IRouter } from "express";
import { desc, eq, or } from "drizzle-orm";
import {
  GetCandidateProfileResponse,
  SaveCandidateProfileBody,
  SaveCandidateProfileResponse,
} from "@workspace/api-zod";
import { activityTable, candidateProfilesTable, userRolePreferencesTable, db } from "@workspace/db";
import { getAuthenticatedAccountId, sessionCookieName } from "../lib/auth";

const router: IRouter = Router();

const emptyProfile = {
  fullName: "",
  email: "",
  phone: "",
  country: "",
  city: "",
  timezone: "",
  targetRoles: [],
  skills: [],
  technologies: [],
  yearsExperience: null,
  education: [],
  certifications: [],
  industries: [],
  languages: [],
  preferredLocations: [],
  workModes: [],
  relocation: false,
  visaSponsorship: false,
  minimumSalary: null,
  updatedAt: null,
};

router.get("/candidate-profile", async (req, res): Promise<void> => {
  const accountId = getAuthenticatedAccountId(req.cookies?.[sessionCookieName]);

  const conditions = [
    eq(candidateProfilesTable.id, "primary"),
    eq(candidateProfilesTable.id, "local"),
  ];
  if (accountId) {
    conditions.unshift(eq(candidateProfilesTable.id, accountId));
  }

  const profiles = await db
    .select()
    .from(candidateProfilesTable)
    .where(or(...conditions))
    .orderBy(desc(candidateProfilesTable.updatedAt))
    .limit(1);

  const profile = profiles[0];
  if (!profile) {
    res.json(GetCandidateProfileResponse.parse(emptyProfile));
    return;
  }
  res.json(
    GetCandidateProfileResponse.parse({
      ...profile,
      updatedAt: profile.updatedAt?.toISOString() ?? null,
    }),
  );
});

router.put("/candidate-profile", async (req, res): Promise<void> => {
  const parsed = SaveCandidateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const accountId = getAuthenticatedAccountId(req.cookies?.[sessionCookieName]);
  const updatedAt = new Date();

  const [profile] = await db
    .insert(candidateProfilesTable)
    .values({ id: "primary", ...parsed.data, updatedAt })
    .onConflictDoUpdate({
      target: candidateProfilesTable.id,
      set: { ...parsed.data, updatedAt },
    })
    .returning();

  if (accountId && accountId !== "primary") {
    await db
      .insert(candidateProfilesTable)
      .values({ id: accountId, ...parsed.data, updatedAt })
      .onConflictDoUpdate({
        target: candidateProfilesTable.id,
        set: { ...parsed.data, updatedAt },
      })
      .catch(() => {});
  }

  // Dynamically sync updated target roles directly to discovery role queue
  const targetRoles = Array.isArray(parsed.data.targetRoles) ? parsed.data.targetRoles : [];
  if (targetRoles.length > 0) {
    try {
      const accountsToSync = ["primary", "local"];
      if (accountId && !accountsToSync.includes(accountId)) {
        accountsToSync.push(accountId);
      }
      for (const accId of accountsToSync) {
        await db
          .delete(userRolePreferencesTable)
          .where(eq(userRolePreferencesTable.accountId, accId))
          .catch(() => {});

        for (let i = 0; i < targetRoles.length; i++) {
          const roleTitle = targetRoles[i];
          if (!roleTitle || typeof roleTitle !== "string" || !roleTitle.trim()) continue;
          await db
            .insert(userRolePreferencesTable)
            .values({
              id: crypto.randomUUID(),
              accountId: accId,
              roleTitle: roleTitle.trim(),
              source: "manual",
              enabled: i < 5,
              priority: i < 2 ? "high" : i < 4 ? "medium" : "low",
              weight: Math.max(100 - i * 15, 20),
              searchQueries: [roleTitle.trim(), `${roleTitle.trim()} Kenya`],
              keywords: (parsed.data.skills || []).slice(0, 5),
              exclusionKeywords: [],
              minSalary: parsed.data.minimumSalary ?? null,
              maxSalary: null,
              locationPreferences: [parsed.data.country || "Kenya", "Remote"],
              remoteOnly: false,
              experienceLevel: (parsed.data.yearsExperience || 0) >= 8 ? ["Senior", "Lead", "Consultant"] : ["Mid-Level", "Junior"],
              industryPreferences: parsed.data.industries || [],
              companySize: [],
              createdAt: updatedAt,
              updatedAt,
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      console.warn("[Candidate] Failed to sync target roles to userRolePreferences:", err);
    }
  }

  await db.insert(activityTable).values({
    id: crypto.randomUUID(),
    kind: "profile",
    message: "Updated candidate profile.",
    createdAt: updatedAt,
  });
  res.json(
    SaveCandidateProfileResponse.parse({
      ...profile,
      updatedAt: profile.updatedAt?.toISOString() ?? null,
    }),
  );
});

router.get("/candidate-profile/evidence", async (_req, res): Promise<void> => {
  try {
    const { getOrGenerateCandidateEvidence, getCandidateEvidenceDiagnostics } = await import(
      "../lib/candidate-evidence"
    );
    const evidence = await getOrGenerateCandidateEvidence();
    const diagnostics = await getCandidateEvidenceDiagnostics();
    res.json({ evidence, diagnostics });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to load candidate evidence profile" });
  }
});

router.post("/candidate-profile/evidence/refresh", async (_req, res): Promise<void> => {
  try {
    const { getOrGenerateCandidateEvidence, getCandidateEvidenceDiagnostics } = await import(
      "../lib/candidate-evidence"
    );
    const evidence = await getOrGenerateCandidateEvidence(true);
    const diagnostics = await getCandidateEvidenceDiagnostics();
    res.json({ evidence, diagnostics });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to refresh candidate evidence profile" });
  }
});

router.put("/candidate-profile/evidence", async (req, res): Promise<void> => {
  try {
    const { saveCandidateEvidenceOverride, getCandidateEvidenceDiagnostics } = await import(
      "../lib/candidate-evidence"
    );
    const saved = saveCandidateEvidenceOverride(req.body);
    const diagnostics = await getCandidateEvidenceDiagnostics();
    res.json({ evidence: saved, diagnostics });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Invalid candidate evidence profile update" });
  }
});

router.get("/candidate-profile/diagnostics", async (_req, res): Promise<void> => {
  try {
    const { getCandidateEvidenceDiagnostics } = await import("../lib/candidate-evidence");
    const diagnostics = await getCandidateEvidenceDiagnostics();
    res.json(diagnostics);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to get CV diagnostics" });
  }
});

export default router;
