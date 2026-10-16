/**
 * Pre-Ingestion Qualification Gate (Phase 4)
 * Deterministic qualification filter executed before saving or activating jobs.
 * Enforces candidate-driven relevance, genuine experience bounds, and geographic eligibility
 * without bias toward any single profession or seniority level.
 */

import type { SearchDirective } from "./search-directive";
import { isJobExpired, extractDeadlineDate, type NormalizedJob } from "./job-search-service";

export interface GateEvaluation {
  qualified: boolean;
  rejectionReason?: string;
  isExpired: boolean;
}

// Scams and fee-charging recruitment
export const SCAM_ROLE_REGEX = /\b(registration\s+fee|application\s+fee|pay\s+to\s+apply|send\s+money|training\s+fee|telegram\s+only|whatsapp\s+only|submit\s+cvs\s*-\s*new\s+recruitment)\b/i;

// Foreign residency restrictions that prevent international applicants
export const FOREIGN_RESIDENCY_LOCK_REGEX = /\b(must\s+(?:currently\s+)?reside\s+in\s+(?:the\s+)?(?:us|usa|united\s+states|uk|united\s+kingdom|eu|europe|canada|australia|germany|france)|us\s+citizens\s+only|us\s+residents\s+only|authorized\s+to\s+work\s+in\s+the\s+us\s+without\s+sponsorship|w2\s+only|c2c\s+only)\b/i;

// Executive patterns (only applied if candidate explicitly does not target leadership)
export const EXECUTIVE_REGEX = /\b(chief\s+technology\s+officer|cto|cio|ciso|chief\s+executive|ceo|coo|cfo|vice\s+president|vp\b|managing\s+director)\b/i;

// Senior / Lead level patterns
export const SENIOR_LEVEL_REGEX = /\b(senior\b|sr\.?\b|principal\b|lead\b|head\s+of\b|director\b|architect\b|fellow\b|consultant\b)\b/i;

/**
 * Extracts minimum years of experience required from description text
 */
export function extractMinYearsRequired(text: string): number | null {
  const patterns = [
    /(?:minimum|at\s+least|require[ds]?|must\s+have)\s+(\d{1,2})\+?\s*(?:-\s*\d{1,2})?\s*years?(?:\s+of)?(?:\s+experience)?/i,
    /(\d{1,2})\+?\s*years?(?:\s+of)?\s+(?:relevant\s+)?experience\s+(?:required|needed|mandatory)/i,
    /experience:\s*(\d{1,2})\+?\s*years?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const yrs = parseInt(match[1], 10);
      if (!isNaN(yrs) && yrs > 0 && yrs < 45) {
        return yrs;
      }
    }
  }
  return null;
}

/**
 * Deterministic qualification gate for a single job
 * Evaluates strictly against candidate's actual CV search directive
 */
export function evaluatePreIngestionGate(
  job: Partial<NormalizedJob> & {
    title: string;
    company: string;
    description?: string | null;
    location?: string | null;
    remote?: boolean | null;
  },
  directive: SearchDirective,
): GateEvaluation {
  const title = (job.title || "").trim();
  const desc = (job.description || "").trim();
  const loc = (job.location || "").toLowerCase();
  const company = (job.company || "").toLowerCase();
  const src = (job.source || "").toLowerCase();
  const fullText = `${title} ${desc} ${company} ${loc} ${src}`.toLowerCase();

  // 1. Expiration Gate
  const deadline = job.deadlineDate || extractDeadlineDate(desc);
  if (isJobExpired(deadline, job.postedDate)) {
    return {
      qualified: false,
      isExpired: true,
      rejectionReason: "Expired listing (application deadline has passed)",
    };
  }

  // 2. Scam / Fraud Gate
  if (SCAM_ROLE_REGEX.test(fullText)) {
    return {
      qualified: false,
      isExpired: false,
      rejectionReason: "Suspicious listing (flagged for recruitment fee, telegram/whatsapp requirement, or scam format)",
    };
  }

  // 3. Experience Ceilings & Seniority (Derived strictly from candidate's verified profile)
  const candidateTargetsSeniorOrSpecialist = (directive.targetRoleFamilies || []).some(r =>
    /director|head|lead|chief|consultant|manager|executive|principal|surgeon|doctor|specialist/i.test(r)
  );

  const candidateYears = directive.candidateSummary?.yearsExperience ?? 1;
  const maxAllowedYears = candidateTargetsSeniorOrSpecialist
    ? Math.max(directive.maxExperienceYears ?? 20, 20)
    : (directive.maxExperienceYears ?? Math.max(candidateYears + 3, 3));
  const minYears = extractMinYearsRequired(desc);

  if (minYears !== null && minYears > maxAllowedYears) {
    return {
      qualified: false,
      isExpired: false,
      rejectionReason: `Requires ${minYears}+ years of experience, exceeding candidate ceiling of ${maxAllowedYears} years`,
    };
  }

  // Executive filter: Only reject if candidate experience is junior (<=3 yrs) and target roles don't include leadership
  if (candidateYears <= 3 && !candidateTargetsSeniorOrSpecialist && EXECUTIVE_REGEX.test(title)) {
    return {
      qualified: false,
      isExpired: false,
      rejectionReason: `Executive position (${title}) exceeds candidate target level`,
    };
  }

  // 4. Role & Domain Relevance Gate
  // Grounded in candidate's actual target role families, search queries, and skills
  const rawKeywords = [
    ...(directive.targetRoleFamilies || []),
    ...(directive.alternativeJobTitles || []),
    ...(directive.requiredSkills || []).slice(0, 30),
    ...(directive.preferredSkills || []).slice(0, 30),
    ...(directive.searchQueries || []).slice(0, 15),
  ].map(k => k.toLowerCase().trim()).filter(Boolean);

  if (rawKeywords.length > 0) {
    const titleLower = title.toLowerCase();
    
    // Substantive words extracted from target roles & skills
    const substantiveWords: string[] = [];
    for (const kw of rawKeywords) {
      for (const w of kw.split(/[^a-z0-9]+/)) {
        if (w.length >= 4 && !["with", "from", "that", "this", "have", "been", "only", "also", "role", "work", "jobs"].includes(w)) {
          substantiveWords.push(w);
        }
      }
    }

    // Direct match against full keyword phrases
    const matchesPhrase = rawKeywords.some(kw => {
      if (kw.length < 3) return false;
      const cleanKw = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${cleanKw}\\b`, "i").test(titleLower) || fullText.includes(kw);
    });

    // Match against substantive role keywords in title
    const matchesSubstantiveTitle = substantiveWords.some(w => {
      const cleanW = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${cleanW}\\b`, "i").test(titleLower);
    });

    if (!matchesPhrase && !matchesSubstantiveTitle) {
      return {
        qualified: false,
        isExpired: false,
        rejectionReason: `Listing does not match candidate's target career domain or verified skills (${title})`,
      };
    }
  }

  // 5. Geographic and Work-Authorization Restrictions Gate
  const allowedCountries = (directive.locationRestrictions?.allowedCountries || []).map(c => c.toLowerCase());
  const allowRemote = directive.locationRestrictions?.allowWorldwideRemote ?? true;

  const isWorldwideRemote =
    job.remote === true ||
    loc.includes("worldwide") ||
    loc.includes("anywhere") ||
    loc.includes("global") ||
    loc.includes("remote");

  const matchesAllowedCountry = allowedCountries.some(c =>
    loc.includes(c) || fullText.includes(c) || src.includes(c)
  );

  if (!matchesAllowedCountry && !isWorldwideRemote && !allowRemote) {
    // Check if job is strictly restricted to an unallowed foreign country
    if (FOREIGN_RESIDENCY_LOCK_REGEX.test(fullText)) {
      return {
        qualified: false,
        isExpired: false,
        rejectionReason: "Restricted to foreign residency or local citizens without sponsorship",
      };
    }
  }

  // Passed all candidate-aligned qualification gates!
  return {
    qualified: true,
    isExpired: false,
  };
}
