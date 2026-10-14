import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  GetCandidateProfileResponse,
  SaveCandidateProfileBody,
  SaveCandidateProfileResponse,
} from "@workspace/api-zod";
import { activityTable, candidateProfilesTable, db } from "@workspace/db";

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

router.get("/candidate-profile", async (_req, res): Promise<void> => {
  const [profile] = await db
    .select()
    .from(candidateProfilesTable)
    .where(eq(candidateProfilesTable.id, "primary"))
    .limit(1);
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
  const updatedAt = new Date();
  const [profile] = await db
    .insert(candidateProfilesTable)
    .values({ id: "primary", ...parsed.data, updatedAt })
    .onConflictDoUpdate({
      target: candidateProfilesTable.id,
      set: { ...parsed.data, updatedAt },
    })
    .returning();

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
