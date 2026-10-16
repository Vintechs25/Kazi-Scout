/**
 * Search Directive Generator (Phase 2)
 * Synthesizes a structured, validated search directive using configured AI providers
 * (Gemini preferred, OpenAI fallback, or deterministic rules when AI is unavailable).
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "@workspace/api-zod";
import {
  db,
  candidateProfilesTable,
  cvsTable,
  integrationSettingsTable,
  searchProfilesTable,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { decryptCredentials } from "./credential-encryption";
import { extractCvText } from "./cv-text-extraction";
import { detectProvider, normalizeModelName } from "./provider-services";
import { getVerifiedMasterCv } from "./cv-storage";
import { getOrGenerateCandidateEvidence, type CandidateEvidenceProfile } from "./candidate-evidence";

export const locationRestrictionsSchema = z.object({
  allowedCountries: z.array(z.string()).default([]),
  allowedCities: z.array(z.string()).default([]),
  allowWorldwideRemote: z.boolean().default(true),
  blockedRegions: z.array(z.string()).default([
    "US only",
    "USA only",
    "UK only",
    "EU only",
    "Canada only",
  ]),
});

export const searchDirectiveSchema = z.object({
  targetRoleFamilies: z.array(z.string()).min(1),
  alternativeJobTitles: z.array(z.string()).default([]),
  searchQueries: z.array(z.string()).min(1),
  requiredSkills: z.array(z.string()).default([]),
  preferredSkills: z.array(z.string()).default([]),
  suitableExperienceLevels: z.array(z.string()).default([]),
  maxExperienceYears: z.number().int().min(0).max(50).default(10),
  seniorityExclusions: z.array(z.string()).default([]),
  locationRestrictions: locationRestrictionsSchema,
  workAuthorizationNotes: z.string().nullable().default(null),
  disqualificationRules: z.array(z.string()).default([]),
  searchExpansionStrategies: z.array(z.string()).default([]),
  source: z.enum(["ai", "deterministic_fallback"]),
  providerUsed: z.string().optional(),
  modelUsed: z.string().optional(),
  generatedAt: z.string(),
  cacheKey: z.string(),
  cvVerified: z.boolean(),
  candidateEvidenceFingerprint: z.string().optional(),
  candidateSummary: z.object({
    fullName: z.string(),
    yearsExperience: numberOrZero(1),
    primaryRoles: z.array(z.string()),
  }),
});

function numberOrZero(defaultVal: number) {
  return z.number().nullable().transform((v: number | null | undefined) => (v !== null && v !== undefined ? v : defaultVal));
}

export type LocationRestrictions = z.infer<typeof locationRestrictionsSchema>;
export type SearchDirective = z.infer<typeof searchDirectiveSchema>;

let inMemoryCachedDirective: SearchDirective | null = null;

function computeCacheKey(
  profileUpdatedAt: Date | null,
  cvFingerprint: string,
  searchProfilesHash: string,
): string {
  const payload = [
    profileUpdatedAt?.toISOString() || "no-profile",
    cvFingerprint || "no-cv",
    searchProfilesHash,
  ].join(":");
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Deterministic directive fallback when AI providers are unavailable
 * Grounded 100% in candidate's actual profile, roles, and skills
 */
export function generateDeterministicDirective(
  profile: any,
  evidenceFingerprint = "",
  searchProfiles: any[] = [],
  cacheKey = "default",
  cvVerified = false,
): SearchDirective {
  const roles: string[] = [];
  if (profile?.targetRoles && Array.isArray(profile.targetRoles)) {
    roles.push(...profile.targetRoles.filter(Boolean));
  }
  for (const sp of searchProfiles) {
    if (sp.name && !roles.includes(sp.name)) roles.push(sp.name);
    for (const kw of sp.keywords || []) {
      if (kw && !roles.includes(kw)) roles.push(kw);
    }
  }

  // If no target roles found anywhere, fallback to generic role title
  if (roles.length === 0) {
    roles.push("Professional Specialist");
  }

  const targetRoleFamilies = Array.from(new Set(roles)).slice(0, 8);
  const yearsExp = typeof profile?.yearsExperience === "number" ? profile.yearsExperience : 3;
  const maxYears = Math.max(yearsExp + 3, 3);

  const skills: string[] = Array.isArray(profile?.skills) ? profile.skills : [];
  const techs: string[] = Array.isArray(profile?.technologies) ? profile.technologies : [];
  const combinedSkills = Array.from(new Set([...skills, ...techs]));

  // Seniority levels tailored to candidate's genuine years of experience
  const suitableLevels: string[] = [];
  const seniorityExclusions: string[] = [];

  if (yearsExp >= 10) {
    suitableLevels.push("Consultant", "Director", "Lead", "Senior", "10+ years");
  } else if (yearsExp >= 6) {
    suitableLevels.push("Senior", "Lead", "Specialist", "5-8 years");
    seniorityExclusions.push("chief executive officer", "managing director");
  } else if (yearsExp >= 3) {
    suitableLevels.push("Mid-Level", "Intermediate", "Experienced", "3-5 years");
    seniorityExclusions.push("principal", "director", "head of", "chief");
  } else {
    suitableLevels.push("Entry Level", "Junior", "Associate", "0-2 years");
    seniorityExclusions.push("senior", "lead", "principal", "director", "head of", "chief", "manager");
  }

  // Generate high-intent queries from candidate's actual roles and skills
  const searchQueries: string[] = [];
  for (const r of targetRoleFamilies.slice(0, 5)) {
    searchQueries.push(r);
    if (profile?.city) searchQueries.push(`${r} ${profile.city}`);
    if (profile?.country) searchQueries.push(`${r} ${profile.country}`);
  }
  searchQueries.push(...targetRoleFamilies.slice(0, 3).map(r => `${r} Remote`));

  const allowedCountries = [
    profile?.country,
    ...(profile?.preferredLocations || []).filter((l: string) => l && !/remote|worldwide|any/i.test(l)),
  ].filter(Boolean);

  const allowedCities = [
    profile?.city,
  ].filter(Boolean);

  return {
    targetRoleFamilies,
    alternativeJobTitles: targetRoleFamilies.map(r => `${r} Specialist`),
    searchQueries: Array.from(new Set(searchQueries)).slice(0, 8),
    requiredSkills: combinedSkills.slice(0, 10),
    preferredSkills: combinedSkills.slice(10, 25),
    suitableExperienceLevels: suitableLevels,
    maxExperienceYears: maxYears,
    seniorityExclusions,
    locationRestrictions: {
      allowedCountries: allowedCountries.length > 0 ? Array.from(new Set(allowedCountries)) : ["Worldwide"],
      allowedCities: allowedCities.length > 0 ? Array.from(new Set(allowedCities)) : [],
      allowWorldwideRemote: true,
      blockedRegions: ["US only", "USA only", "UK only", "EU only", "Canada only"],
    },
    workAuthorizationNotes: null,
    disqualificationRules: [
      `Positions requiring more than ${maxYears} years of experience`,
      "Occupational families unrelated to candidate's target roles and verified qualifications",
      "Strict geographic restrictions excluding candidate's location and worldwide remote",
    ],
    searchExpansionStrategies: [
      "Target adjacent titles directly utilizing verified skills and education",
      "Search worldwide remote and country-wide opportunities matching target roles",
    ],
    source: "deterministic_fallback",
    generatedAt: new Date().toISOString(),
    cacheKey,
    cvVerified,
    candidateEvidenceFingerprint: evidenceFingerprint,
    candidateSummary: {
      fullName: profile?.fullName || "Candidate",
      yearsExperience: yearsExp,
      primaryRoles: targetRoleFamilies.slice(0, 4),
    },
  };
}

/**
 * Call AgentRouter to generate structured directive
 */
async function callAgentRouterDirective(
  apiKey: string,
  modelName: string,
  prompt: string,
  baseUrl?: string | null,
): Promise<unknown> {
  const cleanModel = normalizeModelName(modelName);
  const rootUrl = (baseUrl?.trim() || "https://agentrouter.org/v1").replace(/\/$/, "");
  const res = await fetch(`${rootUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cleanModel,
      messages: [
        {
          role: "system",
          content:
            "You are a universal AI career and job search planner. Respond ONLY with a valid JSON object matching the requested schema.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`AgentRouter error (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  const rawText = data.choices?.[0]?.message?.content;
  if (!rawText) throw new Error("Empty response from AgentRouter");
  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned);
}

/**
 * Call Gemini to generate structured directive
 */
async function callGeminiDirective(
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
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = new Error(`Gemini ${m} error (${res.status}): ${text}`);
        continue;
      }

      const data = (await res.json()) as any;
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;
      const cleaned = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
      return JSON.parse(cleaned);
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error("Failed to generate directive with Gemini");
}

/**
 * Call OpenAI to generate structured directive (fallback)
 */
async function callOpenAiDirective(
  apiKey: string,
  modelName: string,
  prompt: string,
): Promise<unknown> {
  const cleanModel = normalizeModelName(modelName);
  const isReasoning = cleanModel.startsWith("o1") || cleanModel.startsWith("o3");

  const payload: any = {
    model: cleanModel,
    messages: [
      {
        role: isReasoning ? "developer" : "system",
        content:
          "You are a universal AI career and job search planner. Respond ONLY with a valid JSON object matching the requested schema.",
      },
      { role: "user", content: prompt },
    ],
  };

  if (!isReasoning) {
    payload.temperature = 0.1;
    payload.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`OpenAI error (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  const rawText = data.choices?.[0]?.message?.content;
  if (!rawText) throw new Error("Empty response from OpenAI");
  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned);
}

/**
 * Main entry point: Get cached or generate fresh CV-aware Search Directive (Phase 3 AI Search Planner)
 * Works for ANY profession (Healthcare, Medicine, Law, Finance, Engineering, Technology, Education, etc.)
 */
export async function getOrGenerateSearchDirective(forceRefresh = false): Promise<SearchDirective> {
  const [profile] = await db
    .select()
    .from(candidateProfilesTable)
    .where(eq(candidateProfilesTable.id, "primary"))
    .limit(1);

  // 1. Retrieve verified Master CV and verified candidate evidence profile
  const cvDossier = await getVerifiedMasterCv();
  const evidence = await getOrGenerateCandidateEvidence(forceRefresh);

  const searchProfiles = await db
    .select()
    .from(searchProfilesTable)
    .where(eq(searchProfilesTable.enabled, true));

  const spHash = searchProfiles.map((p) => `${p.id}-${p.name}`).join(",");
  const cacheKey = computeCacheKey(
    profile?.updatedAt || null,
    evidence.evidenceFingerprint,
    spHash,
  );

  if (!forceRefresh && inMemoryCachedDirective && inMemoryCachedDirective.cacheKey === cacheKey) {
    return inMemoryCachedDirective;
  }

  // Load configured AI integrations
  const integrations = await db.select().from(integrationSettingsTable);
  const agentRouterConfig = integrations.find((i) => i.provider === "agentrouter" && i.model);
  const geminiConfig = integrations.find((i) => i.provider === "gemini" && i.model);
  const openAiConfig = integrations.find((i) => i.provider === "openai" && i.model);

  const candidateLocation = [profile?.city, profile?.country].filter(Boolean).join(", ") || "Worldwide";
  const preferredLocs = Array.isArray(profile?.preferredLocations) && profile.preferredLocations.length > 0
    ? profile.preferredLocations
    : [candidateLocation, "Worldwide Remote"].filter(Boolean);

  const prompt = `You are a precision AI Career Matchmaker and Search Planner.
Generate a comprehensive, tailored AI Search Plan based STRICTLY on the candidate's verified evidence profile and actual master CV.
The candidate can be from ANY career domain or profession (Healthcare, Medicine & Surgery, Law, Accounting & Finance, Engineering, Technology, Education, Trades, Operations, Creative, etc.).

CANDIDATE EVIDENCE DOSSIER (VERIFIED FROM MASTER CV):
- Full Name: ${evidence.fullName}
- Verified Years of Experience: ${evidence.yearsExperience} year(s)
- Target Role Families: ${JSON.stringify(evidence.targetRoleFamilies)}
- Demonstrated Skills & Competencies: ${JSON.stringify(evidence.demonstratedTechnicalSkills)}
- Self-Reported Skills: ${JSON.stringify(evidence.selfReportedSkills)}
- Verified Employment / Professional Background: ${JSON.stringify(evidence.verifiedWorkExperience)}
- Education & Degrees: ${JSON.stringify(evidence.education)}
- Certifications & Licensures: ${JSON.stringify(evidence.certifications)}
- Known Limitations / Guardrails: ${JSON.stringify(evidence.limitationsOrMissingInfo)}

CANDIDATE SEARCH PREFERENCES:
- Candidate Location: ${candidateLocation}
- Preferred Locations: ${JSON.stringify(preferredLocs)}

PLANNING DIRECTIVES:
1. Target Role Families: Formulate realistic target job titles that directly leverage the candidate's actual profession, credentials, degrees, and verified skills.
2. Alternative Job Titles: Identify viable roles with alternative titles that match the candidate's genuine qualifications and seniority level.
3. Targeted Search Queries: Formulate high-precision job search queries matching their roles, location, and remote opportunities.
4. Experience Bounds: Reflect their verified experience (${evidence.yearsExperience} years). Allow an experience span appropriate to their background.
5. Seniority Exclusions: Only exclude seniority levels that are genuinely incompatible with their background (do NOT exclude senior/consultant/director roles if the candidate has substantial or senior experience!).
6. Geographic Restrictions:
   - Allowed Countries: ${JSON.stringify([profile?.country || "Any"].filter(Boolean))}
   - Allowed Cities: ${JSON.stringify([profile?.city].filter(Boolean))}
   - Allow Worldwide Remote: true
   - Blocked Regions: ["US only", "USA only", "UK only", "EU only", "Canada only"]
7. Disqualification Rules: Explicit rules to reject roles that are completely off-domain or exceed their experience.
8. Search Expansion Strategies: Practical strategies for discovering compatible opportunities across their field.

Output MUST be a single JSON object strictly matching this schema:
{
  "targetRoleFamilies": ["string"],
  "alternativeJobTitles": ["string"],
  "searchQueries": ["string"],
  "requiredSkills": ["string"],
  "preferredSkills": ["string"],
  "suitableExperienceLevels": ["string"],
  "maxExperienceYears": number,
  "seniorityExclusions": ["string"],
  "locationRestrictions": {
    "allowedCountries": ["string"],
    "allowedCities": ["string"],
    "allowWorldwideRemote": true,
    "blockedRegions": ["US only", "USA only", "UK only", "EU only", "Canada only"]
  },
  "workAuthorizationNotes": null,
  "disqualificationRules": ["string"],
  "searchExpansionStrategies": ["string"]
}`;

  // 1. Try Agent Router if configured
  if (agentRouterConfig?.encryptedCredentials && agentRouterConfig?.model) {
    try {
      const creds = decryptCredentials<{ apiKey?: string }>(agentRouterConfig.encryptedCredentials);
      if (creds.apiKey) {
        const rawJson = await callAgentRouterDirective(creds.apiKey, agentRouterConfig.model, prompt, agentRouterConfig.baseUrl);
        const rawObj = (typeof rawJson === "object" && rawJson !== null ? rawJson : {}) as Record<string, unknown>;
        const parsed = searchDirectiveSchema.safeParse({
          ...rawObj,
          source: "ai",
          providerUsed: "agentrouter",
          modelUsed: agentRouterConfig.model,
          generatedAt: new Date().toISOString(),
          cacheKey,
          cvVerified: cvDossier.loaded,
          candidateEvidenceFingerprint: evidence.evidenceFingerprint,
          candidateSummary: {
            fullName: evidence.fullName,
            yearsExperience: evidence.yearsExperience,
            primaryRoles: (rawObj as any)?.targetRoleFamilies?.slice(0, 4) || evidence.targetRoleFamilies.slice(0, 4),
          },
        });
        if (parsed.success) {
          inMemoryCachedDirective = parsed.data;
          return parsed.data;
        }
      }
    } catch (arErr) {
      console.warn("[SearchDirective] AgentRouter planning failed, trying next provider:", arErr);
    }
  }

  // 2. Try Gemini
  if (geminiConfig?.encryptedCredentials && geminiConfig?.model) {
    try {
      const creds = decryptCredentials<{ apiKey?: string }>(geminiConfig.encryptedCredentials);
      if (creds.apiKey) {
        const rawJson = await callGeminiDirective(creds.apiKey, geminiConfig.model, prompt);
        const rawObj = (typeof rawJson === "object" && rawJson !== null ? rawJson : {}) as Record<string, unknown>;
        const parsed = searchDirectiveSchema.safeParse({
          ...rawObj,
          source: "ai",
          providerUsed: "gemini",
          modelUsed: geminiConfig.model,
          generatedAt: new Date().toISOString(),
          cacheKey,
          cvVerified: cvDossier.loaded,
          candidateEvidenceFingerprint: evidence.evidenceFingerprint,
          candidateSummary: {
            fullName: evidence.fullName,
            yearsExperience: evidence.yearsExperience,
            primaryRoles: (rawObj as any)?.targetRoleFamilies?.slice(0, 4) || evidence.targetRoleFamilies.slice(0, 4),
          },
        });
        if (parsed.success) {
          inMemoryCachedDirective = parsed.data;
          return parsed.data;
        }
      }
    } catch (geminiErr) {
      console.warn("[SearchDirective] Gemini planning failed, checking fallback:", geminiErr);
    }
  }

  // 3. Fallback to OpenAI
  if (openAiConfig?.encryptedCredentials && openAiConfig?.model) {
    try {
      const creds = decryptCredentials<{ apiKey?: string }>(openAiConfig.encryptedCredentials);
      if (creds.apiKey) {
        const rawJson = await callOpenAiDirective(creds.apiKey, openAiConfig.model, prompt);
        const rawObj = (typeof rawJson === "object" && rawJson !== null ? rawJson : {}) as Record<string, unknown>;
        const parsed = searchDirectiveSchema.safeParse({
          ...rawObj,
          source: "ai",
          providerUsed: "openai",
          modelUsed: openAiConfig.model,
          generatedAt: new Date().toISOString(),
          cacheKey,
          cvVerified: cvDossier.loaded,
          candidateEvidenceFingerprint: evidence.evidenceFingerprint,
          candidateSummary: {
            fullName: evidence.fullName,
            yearsExperience: evidence.yearsExperience,
            primaryRoles: (rawObj as any)?.targetRoleFamilies?.slice(0, 4) || evidence.targetRoleFamilies.slice(0, 4),
          },
        });
        if (parsed.success) {
          inMemoryCachedDirective = parsed.data;
          return parsed.data;
        }
      }
    } catch (openAiErr) {
      console.warn("[SearchDirective] OpenAI planning failed:", openAiErr);
    }
  }

  // Fallback to Deterministic Directive
  const deterministic = generateDeterministicDirective(
    profile,
    evidence.evidenceFingerprint,
    searchProfiles,
    cacheKey,
    cvDossier.loaded,
  );
  inMemoryCachedDirective = deterministic;
  return deterministic;
}
