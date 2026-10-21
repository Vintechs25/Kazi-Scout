/**
 * AI Job-Fit Evaluator (Phase 4 & Phase 5)
 * Strict AI-driven job relevance evaluator. Every discovered job is evaluated
 * against the candidate's verified evidence profile and actual master CV.
 *
 * Requirements:
 * 1. Gemini evaluates jobs by default; OpenAI takes over if Gemini fails and is configured.
 * 2. Record provider, model, evaluation timestamp, and evidence fingerprint.
 * 3. Never allow unverified fallback results into the AI-verified view.
 * 4. A matching title must never be sufficient for a strong match.
 * 5. A high numerical score must never override a hard eligibility failure.
 * 6. Decisions: STRONG_MATCH, POTENTIAL_MATCH, NOT_A_MATCH, INSUFFICIENT_INFORMATION, INELIGIBLE.
 */

import { z } from "@workspace/api-zod";
import { db, integrationSettingsTable, jobsTable, systemStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptCredentials } from "./credential-encryption";
import { callAgentRouterEvaluation, normalizeModelName, normalizeAgentRouterBaseUrl } from "./provider-services";
import { evaluatePreIngestionGate } from "./pre-ingestion-gate";
import type { CandidateEvidenceProfile } from "./candidate-evidence";
import type { NormalizedJob } from "./job-search-service";
import type { JobRecord } from "@workspace/db";

export const aiEvaluationDecisionEnum = z.enum([
  "STRONG_MATCH",
  "POTENTIAL_MATCH",
  "NOT_A_MATCH",
  "INSUFFICIENT_INFORMATION",
  "INELIGIBLE",
]);

export type AiEvaluationDecision = z.infer<typeof aiEvaluationDecisionEnum>;

export const aiEvaluationSchema = z.object({
  decision: aiEvaluationDecisionEnum,
  matchScore: z.number().int().min(0).max(100),
  matchedSkills: z.array(z.string()).default([]),
  missingSkills: z.array(z.string()).default([]),
  experienceCompatibility: z.string(),
  responsibilityCompatibility: z.string(),
  locationEligibility: z.string(),
  hardEligibilityFailure: z.boolean().default(false),
  hardFailureReason: z.string().nullable().default(null),
  explanation: z.string(),
  uncertainties: z.array(z.string()).default([]),
  confidence: z.enum(["high", "medium", "low"]).default("high"),
  isAiVerified: z.boolean().default(false),
  providerUsed: z.string().optional(),
  modelUsed: z.string().optional(),
  evaluatedAt: z.string(),
  evidenceFingerprint: z.string().optional(),
});

export type AiEvaluation = z.infer<typeof aiEvaluationSchema>;

let aiEvaluationCallsCount = 0;

export function getAiEvaluationStats() {
  return { callsCount: aiEvaluationCallsCount };
}

/**
 * Builds rigorous evaluation prompt grounding judgment in actual candidate evidence
 */
function buildEvaluationPrompt(
  job: NormalizedJob | JobRecord,
  evidence: CandidateEvidenceProfile,
  cvSnippet: string,
): string {
  const maxAllowedExp = Math.max(evidence.yearsExperience + 3, 3);
  return `You are a precision AI Lead Talent Assessor and universal Career Matchmaker.
Evaluate whether the following job opportunity is a genuine fit for this candidate based STRICTLY on their verified CV evidence.

━━━ DOMAIN NEUTRALITY (MANDATORY) ━━━
This system evaluates candidates from ALL career domains equally:
Medicine/Surgery, Nursing, Pharmacy, Law, Finance/Accounting, Civil/Mechanical/Electrical Engineering,
Technology/Software, Education/Academia, Operations/Management, Creative/Design, Trades, NGO, Agriculture, and more.
Never apply IT/tech assumptions to a medical or legal candidate, and vice versa.

━━━ CANDIDATE EVIDENCE DOSSIER ━━━
- Full Name: ${evidence.fullName}
- Verified Experience: ${evidence.yearsExperience} year(s)
- Target Role Families: ${JSON.stringify(evidence.targetRoleFamilies)}
- Demonstrated Skills & Competencies: ${JSON.stringify(evidence.demonstratedTechnicalSkills)}
- Self-Reported Skills: ${JSON.stringify(evidence.selfReportedSkills)}
- Verified Employment / Professional Background: ${JSON.stringify(evidence.verifiedWorkExperience)}
- Education & Degrees: ${JSON.stringify(evidence.education)}
- Certifications & Licensures: ${JSON.stringify(evidence.certifications)}
- Limitations & Guardrails: ${JSON.stringify(evidence.limitationsOrMissingInfo)}
${cvSnippet ? `\nVERIFIED MASTER CV EXCERPT:\n${cvSnippet.slice(0, 2500)}` : ""}

━━━ OPPORTUNITY TO EVALUATE ━━━
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location || "Unspecified / Remote"}
- Remote: ${job.remote ? "Yes" : "No / Unspecified"}
- Source URL: ${job.sourceUrl || "N/A"}
- Full Description:
${(job.description || "").slice(0, 3500)}

━━━ EVALUATION RULES ━━━
1. EVIDENCE-GROUNDED ONLY: Ground every claim in candidate evidence. Do NOT invent qualifications.
2. TITLE MATCH IS INSUFFICIENT: Matching title ≠ strong match without matching qualifications and domain.
3. DOMAIN MATCHING: The job's required domain MUST match candidate's verified domain. Cross-domain mismatches (e.g., doctor applying for software engineering) are NOT_A_MATCH unless explicitly transitional.
4. HARD ELIGIBILITY FAILURES — Set hardEligibilityFailure=true, decision=INELIGIBLE, matchScore≤30 when:
   a. Role strictly requires experience significantly exceeding candidate's verified background (>${maxAllowedExp} years strictly required)
   b. Role strictly locks to a foreign country with no remote option or sponsorship pathway
   c. Role requires a mandatory license/credential (e.g., board certification, bar admission, PE license, medical registration) the candidate demonstrably lacks
   CRITICAL: A high matchScore MUST NEVER override a hard eligibility failure.
5. DECISION CATEGORIES:
   - STRONG_MATCH (80-100): Direct domain/qualification/experience alignment. Zero hard eligibility failures.
   - POTENTIAL_MATCH (50-79): Same domain, meets core requirements but lacks 1-2 secondary requirements, or reachable adjacent role.
   - NOT_A_MATCH (<50): Wrong domain, incompatible qualifications, or fundamentally wrong career level.
   - INSUFFICIENT_INFORMATION: Job description too vague for meaningful assessment.
   - INELIGIBLE: Hard eligibility failure present.
6. Output MUST be valid JSON matching the schema below.

JSON OUTPUT SCHEMA:
{
  "decision": "STRONG_MATCH" | "POTENTIAL_MATCH" | "NOT_A_MATCH" | "INSUFFICIENT_INFORMATION" | "INELIGIBLE",
  "matchScore": number (0-100),
  "matchedSkills": ["skill1", "skill2"],
  "missingSkills": ["missingSkill1"],
  "experienceCompatibility": "Detailed analysis of candidate's verified years vs job requirement",
  "responsibilityCompatibility": "Analysis of day-to-day duties vs demonstrated domain-specific competencies",
  "locationEligibility": "Analysis of location and remote eligibility",
  "hardEligibilityFailure": boolean,
  "hardFailureReason": string | null,
  "explanation": "Concise, evidence-grounded justification (2-3 sentences)",
  "uncertainties": ["Any ambiguous details in job post"],
  "confidence": "high" | "medium" | "low"
}`;
}

function cleanJsonText(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/**
 * Call Gemini to evaluate job
 */
async function callGeminiEvaluation(
  apiKey: string,
  modelName: string,
  prompt: string,
): Promise<{ data: unknown; modelUsed: string }> {
  const cleanModel = normalizeModelName(modelName);
  const candidateModels = Array.from(
    new Set(["gemini-3.1-flash-lite", cleanModel, "gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-latest"]),
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
          signal: AbortSignal.timeout(25_000),
        },
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let reason = "";
        try {
          const errObj = JSON.parse(text);
          reason = errObj.error?.message || errObj.error?.details?.[0]?.reason || "";
        } catch {}

        // If the API key itself is invalid or unauthorized, fail fast to allow fallback provider
        if (res.status === 400 && (text.includes("API_KEY_INVALID") || text.includes("API key not valid") || reason.includes("API key not valid"))) {
          throw new Error("Gemini API key is invalid (API_KEY_INVALID). Please update your API key in Agent & Settings.");
        }
        if (res.status === 401 || res.status === 403) {
          throw new Error(`Gemini authorization failed (${res.status}): ${reason || "Access denied"}.`);
        }

        lastError = new Error(`Gemini error on ${m} (${res.status}): ${reason || text.slice(0, 200)}`);
        continue;
      }

      const data = (await res.json()) as any;
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;
      aiEvaluationCallsCount++;
      const cleaned = cleanJsonText(rawText);
      return { data: JSON.parse(cleaned), modelUsed: m };
    } catch (err: any) {
      if (err?.message?.includes("API_KEY_INVALID") || err?.message?.includes("authorization failed")) {
        throw err;
      }
      lastError = err;
    }
  }

  throw lastError || new Error("Failed to evaluate job with Gemini");
}

/**
 * Call OpenAI / OpenRouter to evaluate job (fallback)
 */
async function callOpenAiEvaluation(
  apiKey: string,
  modelName: string,
  prompt: string,
): Promise<{ data: unknown; modelUsed: string }> {
  const cleanModel = normalizeModelName(modelName);
  const isOpenRouter = apiKey.trim().startsWith("sk-or-v1");
  const endpoint = isOpenRouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const modelToUse = isOpenRouter && (cleanModel.startsWith("gpt-") || cleanModel.startsWith("o1"))
    ? `openai/${cleanModel}`
    : cleanModel;

  const isReasoning = cleanModel.startsWith("o1") || cleanModel.startsWith("o3");

  const payload: any = {
    model: modelToUse,
    messages: [
      {
        role: isReasoning ? "developer" : "system",
        content:
          "You are a precision AI job matchmaker. Output JSON only matching the requested schema.",
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
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25_000),
  });

  // If response_format caused an error on OpenRouter models that don't support it, retry without it
  if (!res.ok && payload.response_format) {
    const retryPayload = { ...payload };
    delete retryPayload.response_format;
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(retryPayload),
      signal: AbortSignal.timeout(25_000),
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI/OpenRouter evaluation error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  const rawText = data.choices?.[0]?.message?.content;
  if (!rawText) throw new Error("No response text from OpenAI/OpenRouter");
  aiEvaluationCallsCount++;
  const cleaned = cleanJsonText(rawText);
  return { data: JSON.parse(cleaned), modelUsed: cleanModel };
}
export type ProviderCreds = { apiKey: string; model: string; baseUrl?: string | null };
/**
 * Evaluate single job fit using Strict AI-Verified Mode with fallback and default provider routing
 */
export async function evaluateJobFit(
  job: NormalizedJob | JobRecord,
  evidence: CandidateEvidenceProfile,
  cvSnippet: string,
  geminiCreds: ProviderCreds | null,
  openAiCreds: ProviderCreds | null,
  agentRouterCreds?: ProviderCreds | null,
  defaultProvider: string = "auto",
): Promise<AiEvaluation> {
  const now = new Date().toISOString();
  const prompt = buildEvaluationPrompt(job, evidence, cvSnippet);

  // Determine provider attempt order based on user default and availability
  let providerOrder: Array<"agentrouter" | "gemini" | "openai"> = [];
  if (defaultProvider === "agentrouter") {
    providerOrder = ["agentrouter", "gemini", "openai"];
  } else if (defaultProvider === "openai") {
    providerOrder = ["openai", "gemini", "agentrouter"];
  } else if (defaultProvider === "gemini") {
    providerOrder = ["gemini", "openai", "agentrouter"];
  } else {
    // "auto": Prefer Gemini if available, otherwise Agent Router or OpenAI fallback
    if (geminiCreds?.apiKey) {
      providerOrder = ["gemini", "agentrouter", "openai"];
    } else if (agentRouterCreds?.apiKey) {
      providerOrder = ["agentrouter", "openai", "gemini"];
    } else {
      providerOrder = ["openai", "gemini", "agentrouter"];
    }
  }

  const providerErrors: Record<string, string> = {};

  for (const prov of providerOrder) {
    if (prov === "agentrouter" && agentRouterCreds?.apiKey && agentRouterCreds?.model) {
      try {
        const arResult = await callAgentRouterEvaluation(
          agentRouterCreds.apiKey,
          agentRouterCreds.model,
          prompt,
          agentRouterCreds.baseUrl,
        );
        const raw = arResult.data;
        const rawObj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

        let decision = (rawObj.decision as AiEvaluationDecision) || "POTENTIAL_MATCH";
        let matchScore = typeof rawObj.matchScore === "number" ? rawObj.matchScore : 50;
        const hardFailure = Boolean(rawObj.hardEligibilityFailure);

        if (hardFailure) {
          decision = "INELIGIBLE";
          matchScore = Math.min(matchScore, 30);
        } else if (decision === "STRONG_MATCH" && matchScore < 80) {
          decision = "POTENTIAL_MATCH";
        }

        const parsed = aiEvaluationSchema.safeParse({
          ...rawObj,
          decision,
          matchScore,
          hardEligibilityFailure: hardFailure,
          hardFailureReason: rawObj.hardFailureReason ?? (hardFailure ? "Ineligible based on experience or location" : null),
          isAiVerified: true,
          providerUsed: "agentrouter",
          modelUsed: arResult.modelUsed || agentRouterCreds.model,
          evaluatedAt: now,
          evidenceFingerprint: evidence.evidenceFingerprint,
        });

        if (parsed.success) {
          return parsed.data;
        }
      } catch (err: any) {
        providerErrors.agentrouter = err?.message || String(err);
        console.warn(`[AiJobEvaluator] Agent Router evaluation failed on "${job.title}":`, err?.message || err);
      }
    }

    if (prov === "gemini" && geminiCreds?.apiKey && geminiCreds?.model) {
      try {
        const gemResult = await callGeminiEvaluation(geminiCreds.apiKey, geminiCreds.model, prompt);
        const raw = gemResult.data;
        const rawObj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

        // Post-process to ensure hard rules:
        let decision = (rawObj.decision as AiEvaluationDecision) || "POTENTIAL_MATCH";
        let matchScore = typeof rawObj.matchScore === "number" ? rawObj.matchScore : 50;
        const hardFailure = Boolean(rawObj.hardEligibilityFailure);

        if (hardFailure) {
          decision = "INELIGIBLE";
          matchScore = Math.min(matchScore, 30);
        } else if (decision === "STRONG_MATCH" && matchScore < 80) {
          decision = "POTENTIAL_MATCH";
        }

        const parsed = aiEvaluationSchema.safeParse({
          ...rawObj,
          decision,
          matchScore,
          hardEligibilityFailure: hardFailure,
          hardFailureReason: rawObj.hardFailureReason ?? (hardFailure ? "Ineligible based on experience or location" : null),
          isAiVerified: true,
          providerUsed: "gemini",
          modelUsed: gemResult.modelUsed || geminiCreds.model,
          evaluatedAt: now,
          evidenceFingerprint: evidence.evidenceFingerprint,
        });

        if (parsed.success) {
          return parsed.data;
        }
      } catch (err: any) {
        providerErrors.gemini = err?.message || String(err);
        console.warn(`[AiJobEvaluator] Gemini evaluation failed on "${job.title}":`, err?.message || err);
      }
    }

    if (prov === "openai" && openAiCreds?.apiKey && openAiCreds?.model) {
      try {
        const oaiResult = await callOpenAiEvaluation(openAiCreds.apiKey, openAiCreds.model, prompt);
        const raw = oaiResult.data;
        const rawObj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

        let decision = (rawObj.decision as AiEvaluationDecision) || "POTENTIAL_MATCH";
        let matchScore = typeof rawObj.matchScore === "number" ? rawObj.matchScore : 50;
        const hardFailure = Boolean(rawObj.hardEligibilityFailure);

        if (hardFailure) {
          decision = "INELIGIBLE";
          matchScore = Math.min(matchScore, 30);
        } else if (decision === "STRONG_MATCH" && matchScore < 80) {
          decision = "POTENTIAL_MATCH";
        }

        const parsed = aiEvaluationSchema.safeParse({
          ...rawObj,
          decision,
          matchScore,
          hardEligibilityFailure: hardFailure,
          hardFailureReason: rawObj.hardFailureReason ?? (hardFailure ? "Ineligible based on experience or location" : null),
          isAiVerified: true,
          providerUsed: "openai",
          modelUsed: oaiResult.modelUsed || openAiCreds.model,
          evaluatedAt: now,
          evidenceFingerprint: evidence.evidenceFingerprint,
        });

        if (parsed.success) {
          return parsed.data;
        }
      } catch (err: any) {
        providerErrors.openai = err?.message || String(err);
        console.warn(`[AiJobEvaluator] OpenAI evaluation failed on "${job.title}":`, err?.message || err);
      }
    }
  }

  // Strict Mode Failure: When all configured AI providers fail, qualification STOPS.
  const errorSummary = Object.entries(providerErrors)
    .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
    .join(" | ") || "No configured AI provider credentials found";

  return {
    decision: "INSUFFICIENT_INFORMATION",
    matchScore: 0,
    matchedSkills: [],
    missingSkills: [],
    experienceCompatibility: "AI provider evaluation unavailable.",
    responsibilityCompatibility: "Evaluation halted in strict mode.",
    locationEligibility: "Pending AI provider availability.",
    hardEligibilityFailure: false,
    hardFailureReason: null,
    explanation: `AI Brain Error: ${errorSummary}. Disallowed from active AI-verified results. Please update your API key in Agent & Settings.`,
    uncertainties: [`AI Evaluation Failed: ${errorSummary}`],
    confidence: "low",
    isAiVerified: false,
    providerUsed: "none",
    modelUsed: "none",
    evaluatedAt: now,
    evidenceFingerprint: evidence.evidenceFingerprint,
  };
}

/**
 * Batch evaluate qualified jobs with concurrency and cache checking
 */
export async function batchEvaluateQualifiedJobs(
  jobs: (NormalizedJob | JobRecord)[],
  evidence: CandidateEvidenceProfile,
  cvSnippet: string,
  concurrency = 3,
): Promise<Map<string, AiEvaluation> & {
  aiStatus: "ONLINE" | "DEGRADED" | "OFFLINE";
  providerUsed: string;
  modelUsed: string;
  errors: string[];
}> {
  const results = new Map<string, AiEvaluation>();
  let successfulProvider = "none";
  let successfulModel = "none";
  const collectedErrors: string[] = [];

  if (jobs.length === 0) {
    Object.assign(results, {
      aiStatus: "ONLINE",
      providerUsed: "none",
      modelUsed: "none",
      errors: [],
    });
    return results as any;
  }

  // Retrieve integration credentials and default AI provider preference
  const [integrations, [state]] = await Promise.all([
    db.select().from(integrationSettingsTable),
    db.select().from(systemStateTable).where(eq(systemStateTable.id, "agent")).limit(1),
  ]);
  const defaultProvider = state?.defaultAiProvider || "auto";

  const geminiRow = integrations.find((i) => i.provider === "gemini" && i.model);
  const openAiRow = integrations.find((i) => i.provider === "openai" && i.model);
  const agentRouterRow = integrations.find((i) => i.provider === "agentrouter" && i.model);

  let geminiCreds: ProviderCreds | null = null;
  if (geminiRow?.encryptedCredentials && geminiRow?.model) {
    try {
      const c = decryptCredentials<{ apiKey?: string }>(geminiRow.encryptedCredentials);
      if (c.apiKey) geminiCreds = { apiKey: c.apiKey, model: geminiRow.model };
    } catch {}
  }

  let openAiCreds: ProviderCreds | null = null;
  if (openAiRow?.encryptedCredentials && openAiRow?.model) {
    try {
      const c = decryptCredentials<{ apiKey?: string }>(openAiRow.encryptedCredentials);
      if (c.apiKey) openAiCreds = { apiKey: c.apiKey, model: openAiRow.model };
    } catch {}
  }

  let agentRouterCreds: ProviderCreds | null = null;
  if (agentRouterRow?.encryptedCredentials && agentRouterRow?.model) {
    try {
      const c = decryptCredentials<{ apiKey?: string }>(agentRouterRow.encryptedCredentials);
      if (c.apiKey) {
        agentRouterCreds = { apiKey: c.apiKey, model: agentRouterRow.model, baseUrl: agentRouterRow.baseUrl };
      }
    } catch {}
  }

  // Process in small parallel chunks to avoid rate limit spikes
  for (let i = 0; i < jobs.length; i += concurrency) {
    const chunk = jobs.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (job) => {
        try {
          // 1. Pre-Ingestion Gate check: Ensure job doesn't violate domain or experience constraints
          const gateResult = evaluatePreIngestionGate(job as any, {
            targetRoleFamilies: evidence.targetRoleFamilies,
            alternativeJobTitles: [],
            candidateSummary: {
              fullName: evidence.fullName,
              yearsExperience: evidence.yearsExperience,
              currentOrRecentTitle: (evidence as any).currentTitle || "",
              topSkills: evidence.demonstratedTechnicalSkills,
            },
            maxExperienceYears: Math.max(evidence.yearsExperience + 5, 20),
          } as any);
          if (!gateResult.qualified) {
            results.set(job.id, {
              decision: "NOT_A_MATCH",
              matchScore: 0,
              matchedSkills: [],
              missingSkills: [],
              experienceCompatibility: "Disqualified by Pre-Ingestion Gate.",
              responsibilityCompatibility: "Cross-domain or role incompatibility.",
              locationEligibility: "N/A",
              hardEligibilityFailure: true,
              hardFailureReason: gateResult.rejectionReason ?? null,
              explanation: `Disqualified by Pre-Ingestion Gate: ${gateResult.rejectionReason || "Listing fails qualification criteria"}`,
              uncertainties: [],
              confidence: "high",
              isAiVerified: true,
              providerUsed: "gate",
              modelUsed: "pre-ingestion-gate",
              evaluatedAt: new Date().toISOString(),
              evidenceFingerprint: evidence.evidenceFingerprint,
            });
            return;
          }

          // Check if existing evaluation is valid with identical evidence fingerprint
          const existingJob = job as any;
          if (
            existingJob.evidenceFingerprint === evidence.evidenceFingerprint &&
            existingJob.isAiVerified === true &&
            existingJob.aiDecision &&
            existingJob.matchScore !== null &&
            existingJob.matchScore !== undefined
          ) {
            results.set(job.id, {
              decision: existingJob.aiDecision,
              matchScore: existingJob.matchScore,
              matchedSkills: existingJob.matchedSkills || [],
              missingSkills: existingJob.missingSkills || [],
              experienceCompatibility: "Cached from verified AI evaluation",
              responsibilityCompatibility: "Cached from verified AI evaluation",
              locationEligibility: "Cached from verified AI evaluation",
              hardEligibilityFailure: Boolean(existingJob.hardEligibilityFailure),
              hardFailureReason: existingJob.rejectionReason || null,
              explanation: existingJob.matchReason || "Cached AI evaluation.",
              uncertainties: existingJob.uncertainties || [],
              confidence: "high",
              isAiVerified: true,
              providerUsed: existingJob.aiProvider || "gemini",
              modelUsed: existingJob.aiModel || "cached",
              evaluatedAt: existingJob.aiEvaluatedAt ? new Date(existingJob.aiEvaluatedAt).toISOString() : new Date().toISOString(),
              evidenceFingerprint: existingJob.evidenceFingerprint,
            });
            return;
          }

          const evalResult = await evaluateJobFit(
            job,
            evidence,
            cvSnippet,
            geminiCreds,
            openAiCreds,
            agentRouterCreds,
            defaultProvider,
          );
          if (evalResult.isAiVerified && evalResult.providerUsed && evalResult.providerUsed !== "none") {
            successfulProvider = evalResult.providerUsed;
            successfulModel = evalResult.modelUsed || "unknown";
          } else if (!evalResult.isAiVerified && evalResult.explanation.includes("AI Brain Error:")) {
            const errStr = evalResult.explanation.replace(/^AI Brain Error:\s*/i, "");
            if (!collectedErrors.includes(errStr)) collectedErrors.push(errStr);
          }
          results.set(job.id, evalResult);
        } catch (err: any) {
          console.error(`[AiJobEvaluator] Error evaluating job ${job.id}:`, err?.message || err);
          if (!collectedErrors.includes(err?.message || String(err))) {
            collectedErrors.push(err?.message || String(err));
          }
        }
      }),
    );
  }

  const aiStatus = (successfulProvider !== "none" && successfulProvider !== "gate")
    ? (collectedErrors.length > 0 ? "DEGRADED" : "ONLINE")
    : "OFFLINE";

  Object.assign(results, {
    aiStatus,
    providerUsed: successfulProvider,
    modelUsed: successfulModel,
    errors: collectedErrors,
  });

  return results as any;
}

/**
 * Evaluate single job with automatic credential and evidence resolution
 */
export async function evaluateSingleJob(
  job: any,
  evidence?: CandidateEvidenceProfile,
  cvSnippet?: string,
): Promise<AiEvaluation> {
  const [actualEvidence, cvDossier] = await Promise.all([
    evidence ? Promise.resolve(evidence) : (await import("./candidate-evidence")).getOrGenerateCandidateEvidence(),
    cvSnippet !== undefined ? Promise.resolve({ text: cvSnippet }) : (await import("./cv-storage")).getVerifiedMasterCv(),
  ]);

  const [integrations, [state]] = await Promise.all([
    db.select().from(integrationSettingsTable),
    db.select().from(systemStateTable).where(eq(systemStateTable.id, "agent")).limit(1),
  ]);
  const defaultProvider = state?.defaultAiProvider || "auto";

  const geminiRow = integrations.find((i) => i.provider === "gemini" && i.model);
  const openAiRow = integrations.find((i) => i.provider === "openai" && i.model);
  const agentRouterRow = integrations.find((i) => i.provider === "agentrouter" && i.model);

  let geminiCreds: ProviderCreds | null = null;
  if (geminiRow?.encryptedCredentials && geminiRow?.model) {
    try {
      const c = decryptCredentials<{ apiKey?: string }>(geminiRow.encryptedCredentials);
      if (c.apiKey) geminiCreds = { apiKey: c.apiKey, model: geminiRow.model };
    } catch {}
  }

  let openAiCreds: ProviderCreds | null = null;
  if (openAiRow?.encryptedCredentials && openAiRow?.model) {
    try {
      const c = decryptCredentials<{ apiKey?: string }>(openAiRow.encryptedCredentials);
      if (c.apiKey) openAiCreds = { apiKey: c.apiKey, model: openAiRow.model };
    } catch {}
  }

  let agentRouterCreds: ProviderCreds | null = null;
  if (agentRouterRow?.encryptedCredentials && agentRouterRow?.model) {
    try {
      const c = decryptCredentials<{ apiKey?: string }>(agentRouterRow.encryptedCredentials);
      if (c.apiKey) {
        agentRouterCreds = { apiKey: c.apiKey, model: agentRouterRow.model, baseUrl: agentRouterRow.baseUrl };
      }
    } catch {}
  }

  return evaluateJobFit(
    job,
    actualEvidence,
    cvDossier.text.slice(0, 3000),
    geminiCreds,
    openAiCreds,
    agentRouterCreds,
    defaultProvider,
  );
}

export interface AiBrainStatus {
  status: "ONLINE" | "DEGRADED" | "OFFLINE";
  activeProvider: string;
  activeModel: string | null;
  activeProviderLabel: string;
  providers: {
    gemini: { configured: boolean; model: string | null; status: "ONLINE" | "ERROR" | "NOT_CONFIGURED"; message: string };
    openai: { configured: boolean; model: string | null; status: "ONLINE" | "ERROR" | "NOT_CONFIGURED"; message: string };
    agentrouter: { configured: boolean; model: string | null; status: "ONLINE" | "ERROR" | "NOT_CONFIGURED"; message: string };
  };
  errors: string[];
  recommendation: string | null;
  lastChecked: string;
}

let cachedBrainHealth: { data: AiBrainStatus; expiresAt: number } | null = null;

export async function getAiBrainHealth(forceRefresh = false): Promise<AiBrainStatus> {
  const now = Date.now();
  if (!forceRefresh && cachedBrainHealth && cachedBrainHealth.expiresAt > now) {
    return cachedBrainHealth.data;
  }

  const [integrations, [state]] = await Promise.all([
    db.select().from(integrationSettingsTable),
    db.select().from(systemStateTable).where(eq(systemStateTable.id, "agent")).limit(1),
  ]);

  const defaultProvider = state?.defaultAiProvider || "auto";

  const geminiRow = integrations.find((i) => i.provider === "gemini");
  const openAiRow = integrations.find((i) => i.provider === "openai");
  const agentRouterRow = integrations.find((i) => i.provider === "agentrouter");

  const health: AiBrainStatus = {
    status: "OFFLINE",
    activeProvider: "none",
    activeModel: null,
    activeProviderLabel: "None",
    providers: {
      gemini: { configured: Boolean(geminiRow?.encryptedCredentials), model: geminiRow?.model ?? null, status: "NOT_CONFIGURED", message: "Not configured" },
      openai: { configured: Boolean(openAiRow?.encryptedCredentials), model: openAiRow?.model ?? null, status: "NOT_CONFIGURED", message: "Not configured" },
      agentrouter: { configured: Boolean(agentRouterRow?.encryptedCredentials), model: agentRouterRow?.model ?? null, status: "NOT_CONFIGURED", message: "Not configured" },
    },
    errors: [],
    recommendation: null,
    lastChecked: new Date().toISOString(),
  };

  // Test Gemini if credentials present
  if (geminiRow?.encryptedCredentials) {
    try {
      const c = decryptCredentials<{ apiKey?: string }>(geminiRow.encryptedCredentials);
      if (c.apiKey) {
        const testRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(c.apiKey.trim())}`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (testRes.ok) {
          health.providers.gemini.status = "ONLINE";
          health.providers.gemini.message = `Verified with model ${geminiRow.model || "gemini-3.6-flash"}`;
        } else {
          const errBody = await testRes.json().catch(() => ({}));
          const reason = (errBody as any)?.error?.message || `Status ${testRes.status}`;
          health.providers.gemini.status = "ERROR";
          health.providers.gemini.message = reason.includes("API key not valid")
            ? "Gemini API key is invalid (API_KEY_INVALID). Please update in Agent & Settings."
            : `Gemini error: ${reason}`;
          health.errors.push(`Gemini: ${health.providers.gemini.message}`);
        }
      }
    } catch (err: any) {
      health.providers.gemini.status = "ERROR";
      health.providers.gemini.message = `Connection failed: ${err.message || String(err)}`;
      health.errors.push(`Gemini: ${health.providers.gemini.message}`);
    }
  }

  // Test OpenAI / OpenRouter if credentials present
  if (openAiRow?.encryptedCredentials) {
    try {
      const c = decryptCredentials<{ apiKey?: string }>(openAiRow.encryptedCredentials);
      if (c.apiKey) {
        const isOpenRouter = c.apiKey.trim().startsWith("sk-or-v1");
        const endpoint = isOpenRouter
          ? "https://openrouter.ai/api/v1/auth/key"
          : "https://api.openai.com/v1/models";
        const testRes = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${c.apiKey.trim()}` },
          signal: AbortSignal.timeout(6000),
        });
        if (testRes.ok) {
          health.providers.openai.status = "ONLINE";
          health.providers.openai.message = `Verified with ${isOpenRouter ? "OpenRouter" : "OpenAI"} (${openAiRow.model || "standard"})`;
        } else {
          health.providers.openai.status = "ERROR";
          health.providers.openai.message = `${isOpenRouter ? "OpenRouter" : "OpenAI"} returned ${testRes.status}`;
          health.errors.push(`OpenAI/OpenRouter: ${health.providers.openai.message}`);
        }
      }
    } catch (err: any) {
      health.providers.openai.status = "ERROR";
      health.providers.openai.message = err.message || String(err);
      health.errors.push(`OpenAI: ${health.providers.openai.message}`);
    }
  }

  // Test Agent Router if credentials present
  if (agentRouterRow?.encryptedCredentials) {
    try {
      const c = decryptCredentials<{ apiKey?: string }>(agentRouterRow.encryptedCredentials);
      if (c.apiKey) {
        const rootUrl = normalizeAgentRouterBaseUrl(agentRouterRow.baseUrl);
        const testRes = await fetch(`${rootUrl}/models`, {
          headers: {
            Authorization: `Bearer ${c.apiKey.trim()}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
          signal: AbortSignal.timeout(6000),
        });
        const contentType = testRes.headers.get("content-type") || "";
        if (testRes.ok && !contentType.includes("text/html")) {
          health.providers.agentrouter.status = "ONLINE";
          health.providers.agentrouter.message = `Verified with Agent Router (${agentRouterRow.model || "standard"})`;
        } else if (contentType.includes("text/html")) {
          health.providers.agentrouter.status = "ERROR";
          health.providers.agentrouter.message = `Agent Router returned an HTML web page instead of API JSON. Ensure Base URL ends with /v1 (e.g. ${rootUrl})`;
          health.errors.push(`Agent Router: ${health.providers.agentrouter.message}`);
        } else {
          health.providers.agentrouter.status = "ERROR";
          health.providers.agentrouter.message = `Agent Router returned ${testRes.status}`;
          health.errors.push(`Agent Router: ${health.providers.agentrouter.message}`);
        }
      }
    } catch (err: any) {
      health.providers.agentrouter.status = "ERROR";
      health.providers.agentrouter.message = err.message || String(err);
      health.errors.push(`Agent Router: ${health.providers.agentrouter.message}`);
    }
  }

  // Determine overall status
  const geminiOnline = health.providers.gemini.status === "ONLINE";
  const openaiOnline = health.providers.openai.status === "ONLINE";
  const agentrouterOnline = health.providers.agentrouter.status === "ONLINE";

  if (agentrouterOnline && (defaultProvider === "agentrouter" || (!geminiOnline && !openaiOnline))) {
    const hasFailedOthers = (geminiRow?.encryptedCredentials && !geminiOnline) || (openAiRow?.encryptedCredentials && !openaiOnline);
    health.status = hasFailedOthers && defaultProvider !== "agentrouter" ? "DEGRADED" : "ONLINE";
    health.activeProvider = "agentrouter";
    health.activeModel = agentRouterRow?.model || "gpt-4o";
    health.activeProviderLabel = "Agent Router";
    if (health.status === "DEGRADED") {
      health.recommendation = "Operating on Agent Router fallback. Primary provider encountered an issue.";
    }
  } else if (geminiOnline && (defaultProvider === "gemini" || defaultProvider === "auto")) {
    health.status = "ONLINE";
    health.activeProvider = "gemini";
    health.activeModel = geminiRow?.model || "gemini-3.6-flash";
    health.activeProviderLabel = "Google Gemini";
  } else if (agentrouterOnline) {
    health.status = "ONLINE";
    health.activeProvider = "agentrouter";
    health.activeModel = agentRouterRow?.model || "gpt-4o";
    health.activeProviderLabel = "Agent Router";
  } else if (openaiOnline) {
    health.status = geminiRow?.encryptedCredentials && !geminiOnline ? "DEGRADED" : "ONLINE";
    health.activeProvider = "openai";
    health.activeModel = openAiRow?.model || "gpt-4o-mini";
    health.activeProviderLabel = openAiRow?.model?.includes(":") ? "OpenRouter" : "OpenAI";
    if (health.status === "DEGRADED") {
      health.recommendation = "Operating on fallback provider. Please update your Gemini API key in Agent & Settings.";
    }
  } else if (geminiOnline) {
    health.status = "ONLINE";
    health.activeProvider = "gemini";
    health.activeModel = geminiRow?.model || "gemini-3.6-flash";
    health.activeProviderLabel = "Google Gemini";
  } else {
    health.status = "OFFLINE";
    health.activeProvider = "none";
    health.activeModel = null;
    health.activeProviderLabel = "None";
    health.recommendation = health.errors.length > 0
      ? `AI Core Brain Offline: ${health.errors[0]}. Please update your API key in Agent & Settings.`
      : "No working AI provider configured. Please add an API key in Agent & Settings.";
  }

  cachedBrainHealth = { data: health, expiresAt: now + 45_000 };
  return health;
}

