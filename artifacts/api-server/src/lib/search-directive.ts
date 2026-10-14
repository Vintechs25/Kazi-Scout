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
  allowedCountries: z.array(z.string()).default(["Kenya"]),
  allowedCities: z.array(z.string()).default(["Nairobi"]),
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
  suitableExperienceLevels: z.array(z.string()).default(["Entry Level", "Junior", "0-2 years"]),
  maxExperienceYears: z.number().int().min(0).max(30).default(2),
  seniorityExclusions: z.array(z.string()).default([
    "senior",
    "lead",
    "principal",
    "staff",
    "head of",
    "director",
    "vp",
    "chief",
    "cto",
    "architect",
    "manager",
  ]),
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
 */
export function generateDeterministicDirective(
  profile: any,
  evidenceFingerprint: string,
  searchProfiles: any[],
  cacheKey: string,
  cvVerified = false,
): SearchDirective {
  const roles: string[] = [];
  if (profile?.targetRoles && Array.isArray(profile.targetRoles)) {
    roles.push(...profile.targetRoles);
  }
  for (const sp of searchProfiles) {
    if (sp.name && !roles.includes(sp.name)) roles.push(sp.name);
    for (const kw of sp.keywords || []) {
      if (kw && !roles.includes(kw)) roles.push(kw);
    }
  }

  const initialRoleFamilies = [
    "IT Support Specialist / IT Support Engineer",
    "ICT Officer / ICT Support",
    "Desktop Support / Technical Support",
    "Junior Systems Administrator",
    "Junior Software Developer / Web Developer / Full-Stack Developer",
  ];

  const targetRoleFamilies = Array.from(new Set([...roles, ...initialRoleFamilies])).slice(0, 8);
  const yearsExp = typeof profile?.yearsExperience === "number" ? profile.yearsExperience : 1;
  const maxYears = Math.max(2, yearsExp + 1);

  const skills: string[] = Array.isArray(profile?.skills) ? profile.skills : [];
  const techs: string[] = Array.isArray(profile?.technologies) ? profile.technologies : [];
  const combinedSkills = Array.from(new Set([...skills, ...techs]));

  return {
    targetRoleFamilies,
    alternativeJobTitles: [
      "Help Desk Specialist",
      "Systems Support Specialist",
      "Technical Solutions Associate",
      "Junior Network Administrator",
      "IT Operations Technician",
      "Junior Web Developer",
      "Junior Full-Stack Developer",
    ],
    searchQueries: [
      "IT Support Technician",
      "ICT Officer",
      "Desktop Support Technician",
      "Junior Systems Administrator",
      "Junior Software Developer",
      "Full Stack Developer Entry Level",
      "Technical Support Specialist Nairobi",
    ],
    requiredSkills: combinedSkills.slice(0, 10),
    preferredSkills: combinedSkills.slice(10, 25),
    suitableExperienceLevels: ["Entry Level", "Junior", "0-2 years"],
    maxExperienceYears: maxYears,
    seniorityExclusions: [
      "senior",
      "sr",
      "lead",
      "principal",
      "staff",
      "head of",
      "director",
      "vp",
      "chief",
      "cto",
      "architect",
      "manager",
    ],
    locationRestrictions: {
      allowedCountries: ["Kenya"],
      allowedCities: ["Nairobi"],
      allowWorldwideRemote: true,
      blockedRegions: ["US only", "USA only", "UK only", "EU only", "Canada only"],
    },
    workAuthorizationNotes: null,
    disqualificationRules: [
      "Executive, director, or C-level positions (CTO, VP, Director)",
      `Positions requiring more than ${maxYears} years of experience`,
      "Non-technology occupational families (sales, legal, healthcare/medical practice, finance/accounting, driving)",
      "Strict geographic restrictions excluding Kenya (US-only, UK-only, EU-only, Canada-only)",
    ],
    searchExpansionStrategies: [
      "Target adjacent IT Operations, Junior DevOps, and Help Desk roles",
      "Search entry-level web and full-stack development roles with React/Node/Python stack",
      "Include hospital and enterprise ICT support vacancies with EMR/LAN requirements",
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
      return JSON.parse(rawText);
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
          "You are a precision AI job search agent. Respond ONLY with a valid JSON object matching the requested schema.",
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
  return JSON.parse(rawText);
}

/**
 * Main entry point: Get cached or generate fresh CV-aware Search Directive (Phase 3 AI Search Planner)
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

  // Check available AI integrations (Gemini preferred, OpenAI fallback)
  const integrations = await db.select().from(integrationSettingsTable);
  const geminiConfig = integrations.find((i) => i.provider === "gemini" && i.model);
  const openAiConfig = integrations.find((i) => i.provider === "openai" && i.model);

  const prompt = `You are a precision AI Career Matchmaker and Search Planner.
Generate a comprehensive, targeted AI Search Plan based STRICTLY on the candidate's verified evidence profile and actual master CV.

CANDIDATE EVIDENCE DOSSIER (VERIFIED FROM MASTER CV):
- Full Name: ${evidence.fullName}
- Verified Years of Experience: ${evidence.yearsExperience} year(s) (Junior / Entry-Level)
- Target Role Families: ${JSON.stringify(evidence.targetRoleFamilies)}
- Demonstrated Technical Skills: ${JSON.stringify(evidence.demonstratedTechnicalSkills)}
- Self-Reported Skills: ${JSON.stringify(evidence.selfReportedSkills)}
- Verified Work Experience: ${JSON.stringify(evidence.verifiedWorkExperience)}
- Education: ${JSON.stringify(evidence.education)}
- Certifications: ${JSON.stringify(evidence.certifications)}
- Known Limitations / Guardrails: ${JSON.stringify(evidence.limitationsOrMissingInfo)}

CANDIDATE SEARCH PREFERENCES:
- Candidate Location: ${profile?.city || "Nairobi"}, ${profile?.country || "Kenya"}
- Preferred Locations: ${JSON.stringify(profile?.preferredLocations || ["Nairobi", "Kenya", "Worldwide Remote"])}

PLANNING DIRECTIVES:
1. Target Role Families: Encompass IT Support Specialist, ICT Officer, Desktop Support, Junior Systems Administrator, Junior Software / Full-Stack Developer.
2. Alternative Job Titles: Identify suitable roles with different titles but compatible responsibilities (e.g. Help Desk Specialist, Systems Support Associate, Technical Support Engineer, Junior Network Administrator, IT Operations Assistant). Do NOT rely exclusively on fixed titles.
3. Targeted Search Queries: Formulate high-precision queries for Kenya-based vacancies and genuinely worldwide-remote roles.
4. Experience Bounds: Candidate has 1 year of experience. Set maxExperienceYears to 2. Suitable levels: ["Entry Level", "Junior", "0-2 years"].
5. Seniority Exclusions: Disqualify senior, lead, principal, staff, head of, director, vp, chief, cto, architect, manager.
6. Geographic Restrictions:
   - Allowed Countries: ["Kenya"]
   - Allowed Cities: ["Nairobi"]
   - Allow Worldwide Remote: true
   - Blocked Regions: ["US only", "USA only", "UK only", "EU only", "Canada only"]
7. Disqualification Rules: Explicit rules to reject out-of-scope roles (seniority, non-IT domains, geographic locks).
8. Search Expansion Strategies: Practical strategies for finding adjacent junior opportunities.

Output MUST be a single JSON object strictly matching this schema:
{
  "targetRoleFamilies": ["string"],
  "alternativeJobTitles": ["string"],
  "searchQueries": ["string"],
  "requiredSkills": ["string"],
  "preferredSkills": ["string"],
  "suitableExperienceLevels": ["Entry Level", "Junior", "0-2 years"],
  "maxExperienceYears": 2,
  "seniorityExclusions": ["senior", "lead", "director", "manager", "cto", ...],
  "locationRestrictions": {
    "allowedCountries": ["Kenya"],
    "allowedCities": ["Nairobi"],
    "allowWorldwideRemote": true,
    "blockedRegions": ["US only", "USA only", "UK only", "EU only", "Canada only"]
  },
  "workAuthorizationNotes": null,
  "disqualificationRules": ["string"],
  "searchExpansionStrategies": ["string"]
}`;

  // Try Gemini
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

  // Fallback to OpenAI
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
