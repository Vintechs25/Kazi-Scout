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
import { db, integrationSettingsTable, jobsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptCredentials } from "./credential-encryption";
import { normalizeModelName } from "./provider-services";
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
  return `You are a precision AI Lead Technical Recruiter evaluating an opportunity against a candidate's VERIFIED CV and evidence profile.

CANDIDATE EVIDENCE DOSSIER (VERIFIED FROM ACTUAL MASTER CV):
- Full Name: ${evidence.fullName}
- Verified Experience: ${evidence.yearsExperience} year(s) (Strictly Junior / Entry-Level)
- Target Role Families: ${JSON.stringify(evidence.targetRoleFamilies)}
- Demonstrated Technical Skills (Explicitly Evidenced): ${JSON.stringify(evidence.demonstratedTechnicalSkills)}
- Self-Reported Skills (From Profile): ${JSON.stringify(evidence.selfReportedSkills)}
- Verified Employment: ${JSON.stringify(evidence.verifiedWorkExperience)}
- Education: ${JSON.stringify(evidence.education)}
- Certifications: ${JSON.stringify(evidence.certifications)}
- Limitations & Guardrails: ${JSON.stringify(evidence.limitationsOrMissingInfo)}
- Location: Nairobi, Kenya (Eligible for Kenya roles and genuinely worldwide-remote roles)
${cvSnippet ? `\nVERIFIED MASTER CV EXCERPT:\n${cvSnippet.slice(0, 2200)}` : ""}

OPPORTUNITY TO EVALUATE:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location || "Unspecified / Remote"}
- Remote: ${job.remote ? "Yes" : "No / Unspecified"}
- Source URL: ${job.sourceUrl || "N/A"}
- Full Description:
${(job.description || "").slice(0, 3500)}

RIGOROUS EVALUATION RULES:
1. Ground every claim strictly in candidate evidence. Do NOT invent qualifications or experience.
2. TITLE MATCH IS NEVER SUFFICIENT: A role matching the title "IT Support" or "Developer" is NOT a strong match if required tech stack or seniority does not match.
3. HARD ELIGIBILITY FAILURES:
   - Experience: If the role strictly requires 3+ or more years of experience (or is Senior, Lead, Principal, Staff, Director, VP, CTO, Manager), candidate is INELIGIBLE.
   - Geography / Authorization: If the role strictly restricts to US-only, UK-only, EU-only, Canada-only with no worldwide remote option, candidate is INELIGIBLE.
   - When a hard eligibility failure occurs:
     * "hardEligibilityFailure" MUST be true.
     * "decision" MUST be "INELIGIBLE".
     * "matchScore" MUST NOT exceed 30.
     * High numerical score MUST NEVER override hard eligibility failure!
4. DECISION CATEGORIES:
   - STRONG_MATCH: Score 80-100. Entry/junior level (0-2 yrs) or IT support/developer role where candidate demonstrated skills (troubleshooting, hardware, LAN/WAN, Linux/Windows, databases, web development) align directly. Zero hard eligibility failures.
   - POTENTIAL_MATCH: Score 50-79. Relevant tech role where candidate meets core skills but lacks 1-2 secondary requirements, or junior role in an adjacent tech stack. Zero hard eligibility failures.
   - NOT_A_MATCH: Score < 50. Wrong profession/domain (sales, medical, accounting, executive) or heavily incompatible tech stack.
   - INSUFFICIENT_INFORMATION: Job description lacks enough detail to verify responsibilities or qualifications.
   - INELIGIBLE: Fails hard eligibility criteria (seniority, experience >2 yrs, geographical lock).
5. Output MUST be a valid JSON object matching the schema below.

JSON OUTPUT SCHEMA:
{
  "decision": "STRONG_MATCH" | "POTENTIAL_MATCH" | "NOT_A_MATCH" | "INSUFFICIENT_INFORMATION" | "INELIGIBLE",
  "matchScore": number (0-100),
  "matchedSkills": ["skill1", "skill2"],
  "missingSkills": ["missingSkill1"],
  "experienceCompatibility": "Detailed analysis of 1-yr candidate vs job requirement",
  "responsibilityCompatibility": "Analysis of day-to-day duties vs demonstrated skills",
  "locationEligibility": "Analysis of Nairobi/Kenya/Worldwide remote eligibility",
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
        lastError = new Error(`Gemini evaluation error on ${m} (${res.status}): ${text.slice(0, 200)}`);
        continue;
      }

      const data = (await res.json()) as any;
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;
      aiEvaluationCallsCount++;
      const cleaned = cleanJsonText(rawText);
      return { data: JSON.parse(cleaned), modelUsed: m };
    } catch (err: any) {
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

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) {
    throw new Error(`OpenAI evaluation error (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  const rawText = data.choices?.[0]?.message?.content;
  if (!rawText) throw new Error("No response text from OpenAI");
  aiEvaluationCallsCount++;
  const cleaned = cleanJsonText(rawText);
  return { data: JSON.parse(cleaned), modelUsed: cleanModel };
}

/**
 * Evaluate single job fit using Strict AI-Verified Mode
 */
export async function evaluateJobFit(
  job: NormalizedJob | JobRecord,
  evidence: CandidateEvidenceProfile,
  cvSnippet: string,
  geminiCreds: { apiKey: string; model: string } | null,
  openAiCreds: { apiKey: string; model: string } | null,
): Promise<AiEvaluation> {
  const now = new Date().toISOString();
  const prompt = buildEvaluationPrompt(job, evidence, cvSnippet);

  // 1. Try Gemini (preferred primary AI provider)
  if (geminiCreds?.apiKey && geminiCreds?.model) {
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
    } catch (err) {
      console.warn(`[AiJobEvaluator] Gemini evaluation failed on "${job.title}":`, err);
    }
  }

  // 2. Try OpenAI Fallback
  if (openAiCreds?.apiKey && openAiCreds?.model) {
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
    } catch (err) {
      console.warn(`[AiJobEvaluator] OpenAI evaluation failed on "${job.title}":`, err);
    }
  }

  // 3. Strict Mode Failure: When all configured AI providers fail, qualification STOPS.
  // We do NOT silently produce false AI-verified scores or keyword matches.
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
    explanation: "AI evaluation unavailable: Configured AI providers failed to evaluate this role. Disallowed from active AI-verified results.",
    uncertainties: ["AI evaluation could not be completed"],
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
): Promise<Map<string, AiEvaluation>> {
  const results = new Map<string, AiEvaluation>();
  if (jobs.length === 0) return results;

  // Retrieve integration credentials once for the batch
  const integrations = await db.select().from(integrationSettingsTable);
  const geminiRow = integrations.find((i) => i.provider === "gemini" && i.model);
  const openAiRow = integrations.find((i) => i.provider === "openai" && i.model);

  let geminiCreds: { apiKey: string; model: string } | null = null;
  if (geminiRow?.encryptedCredentials && geminiRow?.model) {
    try {
      const c = decryptCredentials<{ apiKey?: string }>(geminiRow.encryptedCredentials);
      if (c.apiKey) geminiCreds = { apiKey: c.apiKey, model: geminiRow.model };
    } catch {}
  }

  let openAiCreds: { apiKey: string; model: string } | null = null;
  if (openAiRow?.encryptedCredentials && openAiRow?.model) {
    try {
      const c = decryptCredentials<{ apiKey?: string }>(openAiRow.encryptedCredentials);
      if (c.apiKey) openAiCreds = { apiKey: c.apiKey, model: openAiRow.model };
    } catch {}
  }

  // Process in small parallel chunks to avoid rate limit spikes
  for (let i = 0; i < jobs.length; i += concurrency) {
    const chunk = jobs.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (job) => {
        try {
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
          );
          results.set(job.id, evalResult);
        } catch (err) {
          console.error(`[AiJobEvaluator] Error evaluating job ${job.id}:`, err);
        }
      }),
    );
  }

  return results;
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

  const integrations = await db.select().from(integrationSettingsTable);
  const geminiRow = integrations.find((i) => i.provider === "gemini" && i.model);
  const openAiRow = integrations.find((i) => i.provider === "openai" && i.model);

  let geminiCreds: { apiKey: string; model: string } | null = null;
  if (geminiRow?.encryptedCredentials && geminiRow?.model) {
    try {
      const c = decryptCredentials<{ apiKey?: string }>(geminiRow.encryptedCredentials);
      if (c.apiKey) geminiCreds = { apiKey: c.apiKey, model: geminiRow.model };
    } catch {}
  }

  let openAiCreds: { apiKey: string; model: string } | null = null;
  if (openAiRow?.encryptedCredentials && openAiRow?.model) {
    try {
      const c = decryptCredentials<{ apiKey?: string }>(openAiRow.encryptedCredentials);
      if (c.apiKey) openAiCreds = { apiKey: c.apiKey, model: openAiRow.model };
    } catch {}
  }

  return evaluateJobFit(
    job,
    actualEvidence,
    cvDossier.text.slice(0, 3000),
    geminiCreds,
    openAiCreds,
  );
}
