import { createHash } from "node:crypto";
import { z } from "@workspace/api-zod";
import { db, candidateProfilesTable, integrationSettingsTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { getVerifiedMasterCv } from "./cv-storage";
import { decryptCredentials } from "./credential-encryption";
import { normalizeModelName, normalizeAgentRouterBaseUrl, parseAiJsonResponse, buildAgentRouterHeaders } from "./provider-services";

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

const cachedEvidenceMap = new Map<string, { fingerprint: string; profile: CandidateEvidenceProfile }>();

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

export async function callAgentRouterCandidateEvidence(
  apiKey: string,
  modelName: string,
  prompt: string,
  baseUrl?: string | null,
): Promise<unknown> {
  const cleanModel = normalizeModelName(modelName);
  const rootUrl = normalizeAgentRouterBaseUrl(baseUrl);
  const res = await fetch(`${rootUrl}/chat/completions`, {
    method: "POST",
    headers: {
      ...buildAgentRouterHeaders(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cleanModel,
      messages: [
        { role: "system", content: "You are a certified Lead Talent Assessor. Respond with valid JSON matching the requested schema." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (errText.trim().startsWith("<") || res.headers.get("content-type")?.includes("text/html")) {
      throw new Error(`Agent Router returned an HTML error page (${res.status}). Ensure your Base URL ends with /v1 (e.g. ${rootUrl}).`);
    }
    throw new Error(`AgentRouter evidence error (${res.status}): ${errText.slice(0, 300)}`);
  }
  const data = (await parseAiJsonResponse(res, "Agent Router")) as any;
  const rawText = data?.choices?.[0]?.message?.content;
  if (!rawText) throw new Error("Empty response from AgentRouter");
  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  return { ...parsed, modelUsed: cleanModel };
}

export async function callOpenAiCandidateEvidence(
  apiKey: string,
  modelName: string,
  prompt: string,
): Promise<unknown> {
  const cleanModel = normalizeModelName(modelName);
  const isOpenRouter = apiKey.trim().startsWith("sk-or-v1-") || cleanModel.includes("/");
  const endpoint = isOpenRouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";

  const isReasoning = cleanModel.startsWith("o1") || cleanModel.startsWith("o3");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey.trim()}`,
    "Content-Type": "application/json",
  };
  if (isOpenRouter) {
    headers["HTTP-Referer"] = "https://kaziscout.vintechsystems.store";
    headers["X-Title"] = "KaziScout AI Brain";
  }

  const payload: any = {
    model: cleanModel,
    messages: [
      { role: isReasoning ? "developer" : "system", content: "You are a certified Lead Talent Assessor. Respond with valid JSON matching the requested schema." },
      { role: "user", content: prompt },
    ],
  };
  if (!isReasoning) {
    payload.temperature = 0.1;
    payload.response_format = { type: "json_object" };
  }

  let res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  // If OpenRouter rejected response_format, retry without it
  if (!res.ok && res.status === 400 && payload.response_format) {
    delete payload.response_format;
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  }

  if (!res.ok) throw new Error(`${isOpenRouter ? "OpenRouter" : "OpenAI"} evidence error (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as any;
  const rawText = data?.choices?.[0]?.message?.content;
  if (!rawText) throw new Error(`Empty response from ${isOpenRouter ? "OpenRouter" : "OpenAI"}`);
  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  return { ...parsed, modelUsed: cleanModel };
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

  const skills = Array.isArray(profile?.skills) ? profile.skills : [];
  const techs = Array.isArray(profile?.technologies) ? profile.technologies : [];
  const combinedSkills = Array.from(new Set([...skills, ...techs]));

  return {
    fullName: profile?.fullName || "Candidate",
    yearsExperience: calculatedYears ?? 1,
    targetRoleFamilies: roles,
    demonstratedTechnicalSkills: combinedSkills,
    selfReportedSkills: combinedSkills,
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
/**
 * Generates or retrieves the verified candidate evidence profile
 */
export async function getOrGenerateCandidateEvidence(
  accountIdOrForce?: string | boolean,
  maybeForceRefresh?: boolean,
): Promise<CandidateEvidenceProfile> {
  const accountId = typeof accountIdOrForce === "string" ? accountIdOrForce : "local";
  const forceRefresh = typeof accountIdOrForce === "boolean" ? accountIdOrForce : Boolean(maybeForceRefresh);

  let [profile] = await db
    .select()
    .from(candidateProfilesTable)
    .where(eq(candidateProfilesTable.id, accountId))
    .limit(1);

  if (!profile && (accountId === "local" || accountId === "primary")) {
    const [fallback] = await db
      .select()
      .from(candidateProfilesTable)
      .where(or(eq(candidateProfilesTable.id, "primary"), eq(candidateProfilesTable.id, "local")))
      .limit(1);
    profile = fallback;
  }

  const dossier = await getVerifiedMasterCv(accountId);
  if (!dossier.loaded || !dossier.cvRecord) {
    const rawKey = `${accountId}:no-cv:${profile?.updatedAt?.toISOString() || "no-update"}`;
    const evidenceFingerprint = createHash("sha256").update(rawKey).digest("hex");
    const cached = cachedEvidenceMap.get(accountId);
    if (!forceRefresh && cached && cached.fingerprint === evidenceFingerprint) {
      return cached.profile;
    }
    const fallback = buildDeterministicEvidence(
      profile,
      "",
      "no-cv",
      "No Master CV Uploaded",
      evidenceFingerprint,
    );
    cachedEvidenceMap.set(accountId, { fingerprint: evidenceFingerprint, profile: fallback });
    return fallback;
  }

  const rawKey = `${accountId}:${dossier.fingerprint}:${profile?.updatedAt?.toISOString() || "no-update"}`;
  const evidenceFingerprint = createHash("sha256").update(rawKey).digest("hex");

  const cached = cachedEvidenceMap.get(accountId);
  if (!forceRefresh && cached && cached.fingerprint === evidenceFingerprint) {
    return cached.profile;
  }

  // Check all available AI integrations (AgentRouter, Gemini, OpenAI)
  const integrations = await db.select().from(integrationSettingsTable);
  const prompt = `You are a certified Lead Talent Assessor.
Extract and compile an objective, rigorously VERIFIED CANDIDATE EVIDENCE PROFILE from the candidate's actual master CV and profile.
The candidate can belong to ANY professional field (Medicine & Healthcare, Law, Finance, Engineering, Technology, Education, Trades, Operations, etc.).

STRICT VERIFICATION DIRECTIVES:
1. Ground all facts strictly in the provided CV text. Do NOT invent, assume, or hallucinate credentials, degrees, or experience.
2. Extract the candidate's authentic career field and genuine qualifications.
3. List demonstrated skills explicitly evidenced in the CV.
4. List self-reported skills from the candidate profile that are not directly mentioned in the CV.
5. Identify any explicit limitations or stated geographical constraints.

Candidate Master CV Text (VERIFIED FROM STORAGE):
${dossier.text.slice(0, 7000)}

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

  const agentRouterRow = integrations.find((i) => i.provider === "agentrouter" && i.model);
  const geminiRow = integrations.find((i) => i.provider === "gemini" && i.model);
  const openAiRow = integrations.find((i) => i.provider === "openai" && i.model);

  // 1. Try Agent Router
  if (agentRouterRow?.encryptedCredentials && agentRouterRow?.model) {
    try {
      const creds = decryptCredentials<{ apiKey?: string }>(agentRouterRow.encryptedCredentials);
      if (creds.apiKey) {
        const rawJson = (await callAgentRouterCandidateEvidence(creds.apiKey, agentRouterRow.model, prompt, agentRouterRow.baseUrl)) as any;
        const parsed = candidateEvidenceProfileSchema.safeParse({
          ...(typeof rawJson === "object" && rawJson !== null ? rawJson : {}),
          evidenceFingerprint,
          cvDocumentId: dossier.cvRecord.id,
          cvFileName: dossier.cvRecord.fileName,
          generatedAt: new Date().toISOString(),
          source: "ai",
          providerUsed: "agentrouter",
          modelUsed: rawJson?.modelUsed || agentRouterRow.model,
        });
        if (parsed.success) {
          cachedEvidenceMap.set(accountId, { fingerprint: evidenceFingerprint, profile: parsed.data });
          return parsed.data;
        }
      }
    } catch (arErr) {
      console.warn("[CandidateEvidence] AgentRouter note:", arErr);
    }
  }

  // 2. Try Gemini
  if (geminiRow?.encryptedCredentials && geminiRow?.model) {
    try {
      const creds = decryptCredentials<{ apiKey?: string }>(geminiRow.encryptedCredentials);
      if (creds.apiKey) {
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
          cachedEvidenceMap.set(accountId, { fingerprint: evidenceFingerprint, profile: parsed.data });
          return parsed.data;
        }
      }
    } catch (geminiErr) {
      console.warn("[CandidateEvidence] Gemini note:", geminiErr);
    }
  }

  // 3. Try OpenAI
  if (openAiRow?.encryptedCredentials && openAiRow?.model) {
    try {
      const creds = decryptCredentials<{ apiKey?: string }>(openAiRow.encryptedCredentials);
      if (creds.apiKey) {
        const rawJson = (await callOpenAiCandidateEvidence(creds.apiKey, openAiRow.model, prompt)) as any;
        const parsed = candidateEvidenceProfileSchema.safeParse({
          ...(typeof rawJson === "object" && rawJson !== null ? rawJson : {}),
          evidenceFingerprint,
          cvDocumentId: dossier.cvRecord.id,
          cvFileName: dossier.cvRecord.fileName,
          generatedAt: new Date().toISOString(),
          source: "ai",
          providerUsed: "openai",
          modelUsed: rawJson?.modelUsed || openAiRow.model,
        });
        if (parsed.success) {
          cachedEvidenceMap.set(accountId, { fingerprint: evidenceFingerprint, profile: parsed.data });
          return parsed.data;
        }
      }
    } catch (openAiErr) {
      console.warn("[CandidateEvidence] OpenAI note:", openAiErr);
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
  cachedEvidenceMap.set(accountId, { fingerprint: evidenceFingerprint, profile: fallback });
  return fallback;
}

/**
 * Invalidate evidence cache when underlying CV or profile changes
 */
export function invalidateEvidenceCache(accountId?: string): void {
  if (accountId) {
    cachedEvidenceMap.delete(accountId);
  } else {
    cachedEvidenceMap.clear();
  }
}

export const invalidateCandidateEvidence = invalidateEvidenceCache;

/**
 * Save user review corrections to candidate evidence profile
 */
export function saveCandidateEvidenceOverride(
  updatedProfile: CandidateEvidenceProfile,
  accountId = "local",
): CandidateEvidenceProfile {
  const validated = candidateEvidenceProfileSchema.parse(updatedProfile);
  cachedEvidenceMap.set(accountId, {
    fingerprint: validated.evidenceFingerprint,
    profile: validated,
  });
  return validated;
}

/**
 * Provides safe diagnostic info showing document identifier, fingerprint, and verification status
 * without revealing API keys, OAuth secrets, or full private CV text.
 */
export async function getCandidateEvidenceDiagnostics(accountId = "local"): Promise<{
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
  const dossier = await getVerifiedMasterCv(accountId);
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

  const evidence = await getOrGenerateCandidateEvidence(accountId);

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
