import { createHash } from "node:crypto";
import { z } from "@workspace/api-zod";
import { db, candidateProfilesTable, integrationSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getVerifiedMasterCv } from "./cv-storage";
import { decryptCredentials } from "./credential-encryption";
import { normalizeModelName } from "./provider-services";

export const verifiedWorkExperienceSchema = z.object({
  title: z.string(),
  company: z.string(),
  period: z.string().nullish().transform(v => v || "Not specified"),
  responsibilities: z.array(z.string()).default([]),
  technologiesUsed: z.array(z.string()).default([]),
  isProfessional: z.boolean().default(true),
});

export const educationItemSchema = z.object({
  institution: z.string(),
  qualification: z.string(),
  year: z.string().nullish(),
});

export const certificationItemSchema = z.object({
  name: z.string(),
  issuer: z.string().nullish().transform(v => v || "Verified"),
  year: z.string().nullish(),
});

export const projectItemSchema = z.object({
  name: z.string(),
  description: z.string().nullish().transform(v => v || ""),
  technologies: z.array(z.string()).default([]),
  role: z.string().nullish(),
});

export const candidateEvidenceProfileSchema = z.object({
  fullName: z.string(),
  yearsExperience: z.number(),
  targetRoleFamilies: z.array(z.string()),
  demonstratedTechnicalSkills: z.array(z.string()),
  selfReportedSkills: z.array(z.string()),
  verifiedWorkExperience: z.array(verifiedWorkExperienceSchema),
  education: z.array(educationItemSchema),
  certifications: z.array(certificationItemSchema),
  projectsAndPracticalExperience: z.array(projectItemSchema),
  transferableSkills: z.array(z.string()),
  limitationsOrMissingInfo: z.array(z.string()),
  evidenceFingerprint: z.string(),
  cvDocumentId: z.string(),
  cvFileName: z.string(),
  generatedAt: z.string(),
  source: z.enum(["ai", "deterministic_rules"]),
  providerUsed: z.string().optional(),
  modelUsed: z.string().optional(),
});

export type CandidateEvidenceProfile = z.infer<typeof candidateEvidenceProfileSchema>;

let cachedEvidence: { fingerprint: string; profile: CandidateEvidenceProfile } | null = null;

export async function callGeminiCandidateEvidence(
  apiKey: string,
  modelName: string,
  prompt: string,
): Promise<unknown> {
  const cleanModel = normalizeModelName(modelName);
  const candidateModels = Array.from(
    new Set([cleanModel, "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest"]),
  ).filter(Boolean);

  let lastError: Error | null = null;
  for (const m of candidateModels) {
    try {
      console.log(`[Gemini candidate evidence] Requesting model: ${m}`);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          m,
        )}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": apiKey.trim(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.1,
              maxOutputTokens: 4096,
            },
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 400 || res.status === 401 || errText.includes("API_KEY_INVALID")) {
          throw new Error(`Gemini API key is invalid (${res.status})`);
        }
        throw new Error(`Gemini candidate evidence API error (${res.status}): ${errText.slice(0, 300)}`);
      }

      const data = (await res.json()) as any;
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error("Empty candidate evidence response from Gemini");

      const parsed = JSON.parse(rawText);
      return { ...parsed, modelUsed: m };
    } catch (err: any) {
      console.warn(`[Gemini candidate evidence] ${m} attempt failed: ${err.message}`);
      lastError = err;
      if (err.message?.includes("API key is invalid")) {
        break; // Fast fail immediately to deterministic profile
      }
    }
  }
  throw lastError || new Error("Failed to call Gemini for candidate evidence");
}

export function buildDeterministicEvidence(
  profile: any,
  cvText: string,
  cvId: string,
  cvFileName: string,
  fingerprint: string,
): CandidateEvidenceProfile {
  // Extract career years if present
  const years = Array.from(cvText.matchAll(/\b(19[89]\d|20[012]\d)\b/g)).map((m) => Number(m[0]));
  let calculatedYears = profile?.yearsExperience ?? null;
  if (calculatedYears === null && years.length > 0) {
    const validYears = years.filter((y) => y >= 1990 && y <= 2026);
    if (validYears.length > 0) {
      calculatedYears = Math.max(1, 2026 - Math.min(...validYears));
    }
  }

  // Parse education lines from CV
  const eduLines = cvText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /bachelor|master|phd|doctor|mbbs|fwacs|diploma|degree|university|college|academy/i.test(l) && l.length > 5 && l.length < 150)
    .slice(0, 4);

  const parsedEducation = eduLines.length > 0
    ? eduLines.map((e) => ({ institution: e, qualification: e, year: "" }))
    : Array.isArray(profile?.education) && profile.education.length > 0
    ? profile.education.map((e: string) => ({ institution: e, qualification: e, year: "" }))
    : [];

  // Parse certification lines from CV
  const certLines = cvText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /certified|certificate|license|licensure|fellowship|fellow|member|council|board|cpa|pmp/i.test(l) && l.length > 5 && l.length < 150)
    .slice(0, 4);

  const parsedCertifications = certLines.length > 0
    ? certLines.map((c) => ({ name: c, issuer: "", year: "" }))
    : Array.isArray(profile?.certifications) && profile.certifications.length > 0
    ? profile.certifications.map((c: string) => ({ name: c, issuer: "", year: "" }))
    : [];

  const roles = Array.isArray(profile?.targetRoles) && profile.targetRoles.length > 0
    ? profile.targetRoles
    : [];

  const skills = Array.isArray(profile?.skills) && profile.skills.length > 0
    ? profile.skills
    : [];

  return {
    fullName: profile?.fullName || "Candidate",
    yearsExperience: calculatedYears ?? 1,
    targetRoleFamilies: roles,
    demonstratedTechnicalSkills: skills,
    selfReportedSkills: skills,
    verifiedWorkExperience: [],
    education: parsedEducation,
    certifications: parsedCertifications,
    projectsAndPracticalExperience: [],
    transferableSkills: [],
    limitationsOrMissingInfo: [],
    evidenceFingerprint: fingerprint,
    cvDocumentId: cvId,
    cvFileName: cvFileName,
    generatedAt: new Date().toISOString(),
    source: "deterministic_rules",
  };
}

/**
 * Generates or retrieves the verified candidate evidence profile
 */
export async function getOrGenerateCandidateEvidence(
  forceRefresh = false,
): Promise<CandidateEvidenceProfile> {
  const dossier = await getVerifiedMasterCv();
  if (!dossier.loaded || !dossier.cvRecord) {
    throw new Error(
      `Master CV verification failed: ${dossier.error || "Master CV not loaded"}. Discovery pipeline cannot run without verified CV evidence.`,
    );
  }

  const [profile] = await db
    .select()
    .from(candidateProfilesTable)
    .where(eq(candidateProfilesTable.id, "primary"))
    .limit(1);

  const rawKey = `${dossier.fingerprint}:${profile?.updatedAt?.toISOString() || "no-update"}`;
  const evidenceFingerprint = createHash("sha256").update(rawKey).digest("hex");

  if (!forceRefresh && cachedEvidence && cachedEvidence.fingerprint === evidenceFingerprint) {
    return cachedEvidence.profile;
  }

  // Check integration settings for Gemini
  const integrations = await db.select().from(integrationSettingsTable);
  const geminiRow = integrations.find((i) => i.provider === "gemini" && i.model);

  if (geminiRow?.encryptedCredentials && geminiRow?.model) {
    try {
      const creds = decryptCredentials<{ apiKey?: string }>(geminiRow.encryptedCredentials);
      if (creds.apiKey) {
        const prompt = `You are a certified Lead Talent Assessor.
Extract and compile an objective, rigorously VERIFIED CANDIDATE EVIDENCE PROFILE from the candidate's actual master CV and profile.

STRICT VERIFICATION DIRECTIVES:
1. Ground all facts strictly in the provided CV text. Do NOT invent, assume, or hallucinate credentials, degrees, or experience.
2. Extract the candidate's authentic career field (medical, legal, financial, engineering, technical, academic, etc.).
3. List demonstrated skills explicitly evidenced in the CV.
4. List self-reported skills from the candidate profile that are not directly mentioned in the CV.
5. Identify any explicit limitations or stated geographical constraints.

Candidate Master CV Text (VERIFIED FROM STORAGE):
${dossier.text.slice(0, 6000)}

Candidate Profile Record:
- Full Name: ${profile?.fullName || "Candidate"}
- Target Roles: ${JSON.stringify(profile?.targetRoles || [])}
- Listed Skills: ${JSON.stringify(profile?.skills || [])}
- Education: ${JSON.stringify(profile?.education || [])}
- Certifications: ${JSON.stringify(profile?.certifications || [])}

Output MUST be a single JSON object strictly matching this schema:
{
  "fullName": "${profile?.fullName || "Candidate"}",
  "yearsExperience": number,
  "targetRoleFamilies": string[],
  "demonstratedTechnicalSkills": string[],
  "selfReportedSkills": string[],
  "verifiedWorkExperience": [
    {
      "title": string,
      "company": string,
      "period": string,
      "responsibilities": string[],
      "technologiesUsed": string[],
      "isProfessional": boolean
    }
  ],
  "education": [
    { "institution": string, "qualification": string, "year": string }
  ],
  "certifications": [
    { "name": string, "issuer": string, "year": string }
  ],
  "projectsAndPracticalExperience": [
    { "name": string, "description": string, "technologies": string[] }
  ],
  "transferableSkills": string[],
  "limitationsOrMissingInfo": string[]
}`;

        const rawJson = (await callGeminiCandidateEvidence(creds.apiKey, geminiRow.model, prompt)) as any;
        const parsed = candidateEvidenceProfileSchema.safeParse({
          ...(typeof rawJson === "object" && rawJson !== null ? rawJson : {}),
          evidenceFingerprint,
          cvDocumentId: dossier.cvRecord.id,
          cvFileName: dossier.cvRecord.fileName,
          generatedAt: new Date().toISOString(),
          source: "ai",
          providerUsed: "gemini",
          modelUsed: rawJson?.modelUsed || geminiRow.model,
        });

        if (parsed.success) {
          cachedEvidence = { fingerprint: evidenceFingerprint, profile: parsed.data };
          return parsed.data;
        } else {
          console.warn("[CandidateEvidence] Schema validation error:", parsed.error.issues);
        }
      }
    } catch (geminiErr) {
      console.warn("[CandidateEvidence] Gemini extraction note:", geminiErr);
    }
  }

  // Fallback to deterministic evidence directly extracted from verified CV
  const fallback = buildDeterministicEvidence(
    profile,
    dossier.text,
    dossier.cvRecord.id,
    dossier.cvRecord.fileName,
    evidenceFingerprint,
  );
  cachedEvidence = { fingerprint: evidenceFingerprint, profile: fallback };
  return fallback;
}

/**
 * Invalidate evidence cache when underlying CV or profile changes
 */
export function invalidateEvidenceCache(): void {
  cachedEvidence = null;
}

/**
 * Save user review corrections to candidate evidence profile
 */
export function saveCandidateEvidenceOverride(
  updatedProfile: CandidateEvidenceProfile,
): CandidateEvidenceProfile {
  const validated = candidateEvidenceProfileSchema.parse(updatedProfile);
  cachedEvidence = {
    fingerprint: validated.evidenceFingerprint,
    profile: validated,
  };
  return validated;
}

/**
 * Provides safe diagnostic info showing document identifier, fingerprint, and verification status
 * without revealing API keys, OAuth secrets, or full private CV text.
 */
export async function getCandidateEvidenceDiagnostics(): Promise<{
  cvLoaded: boolean;
  cvDocumentId: string | null;
  cvFileName: string | null;
  cvBytes: number;
  extractedChars: number;
  evidenceFingerprint: string | null;
  isAiVerified: boolean;
  source: string;
  providerUsed: string | null;
  modelUsed: string | null;
  generatedAt: string | null;
  error?: string | null;
}> {
  const dossier = await getVerifiedMasterCv();
  if (!dossier.loaded || !dossier.cvRecord) {
    return {
      cvLoaded: false,
      cvDocumentId: null,
      cvFileName: null,
      cvBytes: 0,
      extractedChars: 0,
      evidenceFingerprint: null,
      isAiVerified: false,
      source: "none",
      providerUsed: null,
      modelUsed: null,
      generatedAt: null,
      error: dossier.error || "Master CV not loaded",
    };
  }

  const evidence = await getOrGenerateCandidateEvidence();

  return {
    cvLoaded: true,
    cvDocumentId: dossier.cvRecord.id,
    cvFileName: dossier.cvRecord.fileName,
    cvBytes: dossier.diagnostic.fileSize,
    extractedChars: dossier.text.length,
    evidenceFingerprint: evidence.evidenceFingerprint,
    isAiVerified: evidence.source === "ai",
    source: evidence.source,
    providerUsed: evidence.providerUsed || null,
    modelUsed: evidence.modelUsed || null,
    generatedAt: evidence.generatedAt,
  };
}
