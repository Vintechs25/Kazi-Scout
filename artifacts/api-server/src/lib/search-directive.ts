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
import { desc, eq, or, and, isNull } from "drizzle-orm";
import { decryptCredentials } from "./credential-encryption";
import { extractCvText } from "./cv-text-extraction";
import { detectProvider, normalizeModelName } from "./provider-services";
import { getVerifiedMasterCv } from "./cv-storage";
import { getOrGenerateCandidateEvidence, type CandidateEvidenceProfile } from "./candidate-evidence";
import { getUserEnabledRoles } from "./discovery-role-approval";

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

const inMemoryCachedDirectiveMap = new Map<string, SearchDirective>();

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
  activeRoles?: string[],
): SearchDirective {
  const roles: string[] = [];
  if (activeRoles && Array.isArray(activeRoles) && activeRoles.length > 0) {
    roles.push(...activeRoles.filter(Boolean));
  } else {
    if (profile?.targetRoles && Array.isArray(profile.targetRoles)) {
      for (const r of profile.targetRoles) {
        if (r && !roles.includes(r)) roles.push(r);
      }
    }
    for (const sp of searchProfiles) {
      if (sp.name && !roles.includes(sp.name)) roles.push(sp.name);
      for (const kw of sp.keywords || []) {
        if (kw && !roles.includes(kw)) roles.push(kw);
      }
    }
  }

  // If no target roles found anywhere, fallback to generic role title
  if (roles.length === 0) {
    roles.push("Professional Specialist");
  }

  const targetRoleFamilies = Array.from(new Set(roles)).slice(0, 10);
  
  // Detect seniority from active requested roles
  const isSeniorRequested = targetRoleFamilies.some(r =>
    /consultant|surgeon|specialist|senior|lead|director|chief|head|doctor|physician|principal/i.test(r)
  );

  let yearsExp = typeof profile?.yearsExperience === "number" ? profile.yearsExperience : 3;
  if (isSeniorRequested && yearsExp < 8) {
    yearsExp = 10;
  }
  const maxYears = Math.max(yearsExp + 5, isSeniorRequested ? 25 : 5);

  const skills: string[] = Array.isArray(profile?.skills) ? profile.skills : [];
  const techs: string[] = Array.isArray(profile?.technologies) ? profile.technologies : [];

  // Derive contextual domain skills and keywords from requested roles
  const domainSkills: string[] = [];
  for (const r of targetRoleFamilies) {
    const rLower = r.toLowerCase();
    // Healthcare & Medical
    if (/surgeon|surgery/i.test(rLower)) {
      domainSkills.push("surgery", "surgeon", "surgical procedures", "patient care", "clinical consultation", "theatre", "general surgery", "operating room");
    }
    if (/doctor|physician|medical|clinical/i.test(rLower)) {
      domainSkills.push("clinical medicine", "diagnosis", "medical practice", "healthcare", "patient management", "medical doctor", "physician");
    }
    // Finance & Accounting
    if (/account|finance|audit|tax/i.test(rLower)) {
      domainSkills.push("financial reporting", "accounting", "auditing", "taxation", "budgeting", "compliance", "financial analysis");
    }
    // Legal
    if (/legal|advocate|lawyer|counsel/i.test(rLower)) {
      domainSkills.push("legal research", "litigation", "compliance", "contract drafting", "advocacy", "corporate law");
    }
    // Engineering
    if (/engineer|civil|mechanical|electrical/i.test(rLower)) {
      domainSkills.push("engineering design", "project supervision", "technical specifications", "quality assurance", "infrastructure");
    }
    // Add individual substantive role tokens (e.g. "surgeon", "doctor", "specialist")
    const words = rLower.split(/\s+/).filter(w => w.length >= 4);
    domainSkills.push(...words);
  }

  const combinedSkills = (activeRoles && activeRoles.length > 0 && domainSkills.length > 0)
    ? Array.from(new Set(domainSkills))
    : Array.from(new Set([...domainSkills, ...skills, ...techs]));

  // Seniority levels tailored to candidate's genuine years of experience or requested seniority
  const suitableLevels: string[] = [];
  const seniorityExclusions: string[] = [];

  if (isSeniorRequested || yearsExp >= 8) {
    suitableLevels.push("Consultant", "Specialist", "Senior", "Lead", "Director", "5-8 years", "10+ years");
    // Do NOT exclude consultant, senior, lead, director
  } else if (yearsExp >= 3) {
    suitableLevels.push("Mid-Level", "Intermediate", "Experienced", "3-5 years");
    seniorityExclusions.push("managing director", "chief executive officer");
  } else {
    suitableLevels.push("Entry Level", "Junior", "Associate", "0-2 years");
    seniorityExclusions.push("managing director", "chief executive officer");
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

  let res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok && res.status === 400 && payload.response_format) {
    delete payload.response_format;
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  }

  if (!res.ok) {
    throw new Error(`${isOpenRouter ? "OpenRouter" : "OpenAI"} error (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  const rawText = data.choices?.[0]?.message?.content;
  if (!rawText) throw new Error(`Empty response from ${isOpenRouter ? "OpenRouter" : "OpenAI"}`);
  const cleaned = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned);
}

/**
 * Main entry point: Get cached or generate fresh CV-aware Search Directive (Phase 3 AI Search Planner)
 * Works for ANY profession (Healthcare, Medicine, Law, Finance, Engineering, Technology, Education, etc.)
 */
export async function getOrGenerateSearchDirective(
  forceRefreshOrAccount?: boolean | string,
  activeRolesOrRefresh?: string[] | boolean,
  activeRolesParam?: string[],
): Promise<SearchDirective> {
  let accountId = "local";
  let forceRefresh = false;
  let activeRoles: string[] | undefined = undefined;

  if (typeof forceRefreshOrAccount === "string") {
    accountId = forceRefreshOrAccount;
    forceRefresh = typeof activeRolesOrRefresh === "boolean" ? activeRolesOrRefresh : false;
    activeRoles = Array.isArray(activeRolesParam) ? activeRolesParam : Array.isArray(activeRolesOrRefresh) ? activeRolesOrRefresh : undefined;
  } else {
    forceRefresh = Boolean(forceRefreshOrAccount);
    activeRoles = Array.isArray(activeRolesOrRefresh) ? activeRolesOrRefresh : undefined;
  }

  // Automatically fetch enabled roles if not provided
  if (!activeRoles || activeRoles.length === 0) {
    try {
      const enabledRoleData = await getUserEnabledRoles(accountId);
      if (enabledRoleData && Array.isArray(enabledRoleData.roles) && enabledRoleData.roles.length > 0) {
        activeRoles = enabledRoleData.roles;
      }
    } catch (roleErr) {
      console.warn("[SearchDirective] Could not load user enabled roles:", roleErr);
    }
  }

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

  // 1. Retrieve verified Master CV and verified candidate evidence profile
  const cvDossier = await getVerifiedMasterCv(accountId);
  const evidence = await getOrGenerateCandidateEvidence(accountId, forceRefresh);

  const spAccountFilter = accountId === "local"
    ? or(eq(searchProfilesTable.accountId, "local"), isNull(searchProfilesTable.accountId))
    : eq(searchProfilesTable.accountId, accountId);

  const searchProfiles = await db
    .select()
    .from(searchProfilesTable)
    .where(and(spAccountFilter, eq(searchProfilesTable.enabled, true)));

  const spHash = searchProfiles.map((p) => `${p.id}-${p.name}`).join(",");
  const rolesHash = Array.isArray(activeRoles) && activeRoles.length > 0 ? activeRoles.join(",") : "";
  const cacheKey = computeCacheKey(
    profile?.updatedAt || null,
    evidence.evidenceFingerprint,
    `${spHash}__roles:${rolesHash}`,
  );

  const cachedDirective = inMemoryCachedDirectiveMap.get(accountId);
  if (!forceRefresh && cachedDirective && cachedDirective.cacheKey === cacheKey) {
    return cachedDirective;
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

CANDIDATE TARGET ROLES & EVIDENCE DOSSIER (VERIFIED FROM MASTER CV):
- Primary Target Roles: ${JSON.stringify(activeRoles && activeRoles.length > 0 ? activeRoles : evidence.targetRoleFamilies)}
- Full Name: ${evidence.fullName}
- Verified Years of Experience: ${evidence.yearsExperience} year(s)
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
          inMemoryCachedDirectiveMap.set(accountId, parsed.data);
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
          inMemoryCachedDirectiveMap.set(accountId, parsed.data);
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
          inMemoryCachedDirectiveMap.set(accountId, parsed.data);
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
    activeRoles,
  );
  inMemoryCachedDirectiveMap.set(accountId, deterministic);
  return deterministic;
}

export function invalidateSearchDirective(accountId?: string): void {
  if (accountId) {
    inMemoryCachedDirectiveMap.delete(accountId);
  } else {
    inMemoryCachedDirectiveMap.clear();
  }
}
