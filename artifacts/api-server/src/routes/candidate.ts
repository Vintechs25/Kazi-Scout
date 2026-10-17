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
  const accountId = res.locals.accountId || getAuthenticatedAccountId(req) || "local";

  const [profile] = await db
    .select()
    .from(candidateProfilesTable)
    .where(eq(candidateProfilesTable.id, accountId))
    .limit(1);

  if (!profile) {
    // For single-tenant desktop or initial seed fallback
    if (accountId === "local" || accountId === "primary") {
      const [fallback] = await db
        .select()
        .from(candidateProfilesTable)
        .where(or(eq(candidateProfilesTable.id, "primary"), eq(candidateProfilesTable.id, "local")))
        .limit(1);
      if (fallback) {
        res.json(
          GetCandidateProfileResponse.parse({
            ...fallback,
            updatedAt: fallback.updatedAt?.toISOString() ?? null,
          }),
        );
        return;
      }
    }
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
  const accountId = res.locals.accountId || getAuthenticatedAccountId(req) || "local";
  const updatedAt = new Date();

  const [profile] = await db
    .insert(candidateProfilesTable)
    .values({ id: accountId, ...parsed.data, updatedAt })
    .onConflictDoUpdate({
      target: candidateProfilesTable.id,
      set: { ...parsed.data, updatedAt },
    })
    .returning();

  // Dynamically sync updated target roles directly to discovery role queue strictly for this account
  const targetRoles = Array.isArray(parsed.data.targetRoles) ? parsed.data.targetRoles : [];
  if (targetRoles.length > 0) {
    try {
      await db
        .delete(userRolePreferencesTable)
        .where(eq(userRolePreferencesTable.accountId, accountId))
        .catch(() => {});

      for (let i = 0; i < targetRoles.length; i++) {
        const roleTitle = targetRoles[i];
        if (!roleTitle || typeof roleTitle !== "string" || !roleTitle.trim()) continue;
        await db
          .insert(userRolePreferencesTable)
          .values({
            id: crypto.randomUUID(),
            accountId,
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
    } catch (err) {
      console.warn("[Candidate] Failed to sync target roles to userRolePreferences:", err);
    }
  }

  await db.insert(activityTable).values({
    id: crypto.randomUUID(),
    accountId,
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

router.get("/candidate-profile/evidence", async (req, res): Promise<void> => {
  try {
    const accountId = getAuthenticatedAccountId(req) || "local";
    const { getOrGenerateCandidateEvidence, getCandidateEvidenceDiagnostics } = await import(
      "../lib/candidate-evidence"
    );
    const evidence = await getOrGenerateCandidateEvidence(accountId);
    const diagnostics = await getCandidateEvidenceDiagnostics(accountId);
    res.json({ evidence, diagnostics });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to load candidate evidence profile" });
  }
});

router.post("/candidate-profile/evidence/refresh", async (req, res): Promise<void> => {
  try {
    const accountId = getAuthenticatedAccountId(req) || "local";
    const { getOrGenerateCandidateEvidence, getCandidateEvidenceDiagnostics } = await import(
      "../lib/candidate-evidence"
    );
    const evidence = await getOrGenerateCandidateEvidence(accountId, true);
    const diagnostics = await getCandidateEvidenceDiagnostics(accountId);
    res.json({ evidence, diagnostics });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to refresh candidate evidence profile" });
  }
});

router.put("/candidate-profile/evidence", async (req, res): Promise<void> => {
  try {
    const accountId = getAuthenticatedAccountId(req) || "local";
    const { saveCandidateEvidenceOverride, getCandidateEvidenceDiagnostics } = await import(
      "../lib/candidate-evidence"
    );
    const saved = saveCandidateEvidenceOverride(req.body, accountId);
    const diagnostics = await getCandidateEvidenceDiagnostics(accountId);
    res.json({ evidence: saved, diagnostics });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Invalid candidate evidence profile update" });
  }
});

router.get("/candidate-profile/diagnostics", async (req, res): Promise<void> => {
  try {
    const accountId = getAuthenticatedAccountId(req) || "local";
    const { getCandidateEvidenceDiagnostics } = await import("../lib/candidate-evidence");
    const diagnostics = await getCandidateEvidenceDiagnostics(accountId);
    res.json(diagnostics);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to get CV diagnostics" });
  }
});

export default router;
