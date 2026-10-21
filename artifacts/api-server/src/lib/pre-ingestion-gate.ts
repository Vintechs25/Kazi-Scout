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

  // 1. Expiration & Closed Status Gate
  const deadline = job.deadlineDate || extractDeadlineDate(desc);
  if (isJobExpired(deadline, job.postedDate)) {
    return {
      qualified: false,
      isExpired: true,
      rejectionReason: "Expired listing (application deadline has passed)",
    };
  }

  const isClosed = 
    (job as any).isClosed === true ||
    (job as any).status === "closed" ||
    (job as any).status === "EXPIRED" ||
    /\b(job\s+closed|application\s+closed|applications\s+closed|position\s+closed|no\s+longer\s+accepting\s+applications|vacancy\s+closed|this\s+job\s+has\s+expired|closing\s+date\s+has\s+passed)\b/i.test(`${title} ${desc}`) ||
    /\b\[closed\]|\(closed\)|\b\[expired\]|\(expired\)/i.test(title);

  if (isClosed) {
    return {
      qualified: false,
      isExpired: true,
      rejectionReason: "Listing is closed or no longer accepting applications",
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
  // Grounded in candidate's actual target role families and verified professional domain
  const targetRoles = [
    ...(directive.targetRoleFamilies || []),
    ...(directive.alternativeJobTitles || []),
  ].map(r => r.toLowerCase().trim()).filter(Boolean);

  // Incompatible Domain Definitions
  const DOMAIN_PATTERNS = {
    LEGAL: /\b(legal\s+counsel|attorney|lawyer|paralegal|solicitor|litigation|corporate\s+counsel|general\s+counsel|legal\s+advisor)\b/i,
    LINGUISTICS: /\b(linguist|translator|translation|interpreter|language\s+specialist|transcriptionist|life\s+sciences\s+linguist)\b/i,
    HEALTHCARE: /\b(doctor|physician|surgeon|surgery|clinical|nurse|dentist|pharmacist|medical\s+officer|pathologist|pediatrician|cadence\/hello\s+world\/mychart)\b/i,
    FINANCE_ACCOUNTS: /\b(accountant|accounting|auditor|financial\s+analyst|tax\s+(?:specialist|manager)|controller|bookkeeper|cpa)\b/i,
    MARKETING_SALES: /\b(b2b\s+marketing|demand\s+generation|sales\s+&\s+cx|sales\s+enablement|marketing\s+operations|crm\s+expert|copywriter|growth\s+marketing|marketing\s+manager)\b/i,
    ACADEMIC_LIFE_SCIENCES: /\b(post-doctoral|postdoc|post-doc|doctoral\s+research\s+scientist|laboratory\s+scientist)\b/i,
    PROPOSAL_ADMIN: /\b(proposal\s+writer|grant\s+writer|bid\s+manager)\b/i,
    CUSTOMER_SUCCESS: /\b(customer\s+success\s+manager|csm\s+ii|cx\s+enablement)\b/i,
    TECH_IT: /\b(developer|software|engineer|frontend|backend|fullstack|devops|react|python|node|javascript|typescript|sysadmin|ict|it\s+support|technical\s+support|system\s+administrator|web|cloud|database|cyber|qa\b|tester|linux|security\s+researcher|edge\s+functions|data\s+annotator|data\s+engineer|mobile\s+engineer|android|ios)\b/i,
  };

  if (targetRoles.length > 0) {
    const titleLower = title.toLowerCase();
    const descLower = (job.description || "").toLowerCase();
    const candidateRolesBlob = targetRoles.join(" ");

    const isCandidateTech = DOMAIN_PATTERNS.TECH_IT.test(candidateRolesBlob);
    const isCandidateMedical = DOMAIN_PATTERNS.HEALTHCARE.test(candidateRolesBlob);
    const isCandidateFinance = DOMAIN_PATTERNS.FINANCE_ACCOUNTS.test(candidateRolesBlob);
    const isCandidateLegal = DOMAIN_PATTERNS.LEGAL.test(candidateRolesBlob);
    const isCandidateMarketing = DOMAIN_PATTERNS.MARKETING_SALES.test(candidateRolesBlob);

    // Cross-Domain Hard Incompatibility Checks
    if (isCandidateTech) {
      if (
        DOMAIN_PATTERNS.LEGAL.test(titleLower) ||
        DOMAIN_PATTERNS.LINGUISTICS.test(titleLower) ||
        DOMAIN_PATTERNS.HEALTHCARE.test(titleLower) ||
        DOMAIN_PATTERNS.ACADEMIC_LIFE_SCIENCES.test(titleLower) ||
        DOMAIN_PATTERNS.PROPOSAL_ADMIN.test(titleLower) ||
        DOMAIN_PATTERNS.FINANCE_ACCOUNTS.test(titleLower) ||
        (DOMAIN_PATTERNS.MARKETING_SALES.test(titleLower) && !DOMAIN_PATTERNS.TECH_IT.test(titleLower)) ||
        (DOMAIN_PATTERNS.CUSTOMER_SUCCESS.test(titleLower) && !DOMAIN_PATTERNS.TECH_IT.test(titleLower))
      ) {
        return {
          qualified: false,
          isExpired: false,
          rejectionReason: `Cross-domain mismatch: Position (${title}) is outside candidate's target technical domain`,
        };
      }
    }

    if (isCandidateMedical) {
      const isCrossDomainNonMedical = /\b(travel|tourism|flight|hotel|hospitality|customer\s+support|customer\s+service|call\s+center|helpdesk|sap\b|salesforce|erp\b|real\s+estate|receptionist|cashier|waiter|chef|bartender|driver|telemarketing|sales\s+representative|sales\s+executive)\b/i.test(titleLower);
      const hasMedicalCue = /\b(doctor|physician|surgeon|surgery|surgical|clinical|nurse|nursing|patient|clinic|patholog|pediatric|radiolog|anesthe|pharm|oncolog|obstetric|gynecolog|orthopedic|dental|dentist|biomedical|hospital|healthcare)\b/i.test(`${titleLower} ${descLower}`);
      if (
        (isCrossDomainNonMedical && !hasMedicalCue) ||
        DOMAIN_PATTERNS.TECH_IT.test(titleLower) ||
        DOMAIN_PATTERNS.LEGAL.test(titleLower) ||
        DOMAIN_PATTERNS.FINANCE_ACCOUNTS.test(titleLower) ||
        DOMAIN_PATTERNS.MARKETING_SALES.test(titleLower)
      ) {
        return {
          qualified: false,
          isExpired: false,
          rejectionReason: `Cross-domain mismatch: Position (${title}) is outside candidate's target clinical/medical domain`,
        };
      }
    }

    if (isCandidateFinance) {
      if (
        DOMAIN_PATTERNS.HEALTHCARE.test(titleLower) ||
        DOMAIN_PATTERNS.TECH_IT.test(titleLower) ||
        DOMAIN_PATTERNS.LEGAL.test(titleLower)
      ) {
        return {
          qualified: false,
          isExpired: false,
          rejectionReason: `Cross-domain mismatch: Position (${title}) is outside candidate's target finance/accounting domain`,
        };
      }
    }

    // Role Match: Check title against candidate's target roles and substantive role tokens
    const directTitleMatch = targetRoles.some(r => {
      const cleanR = r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${cleanR}\\b`, "i").test(titleLower);
    });

    // Substantive words extracted from candidate target roles
    const substantiveRoleWords: string[] = [];
    const stopWords = new Set([
      "with", "from", "that", "this", "have", "been", "only", "also", "role", "work", "jobs",
      "specialist", "officer", "associate", "level", "senior", "junior", "lead", "general", "intern",
      "consultant", "manager", "coordinator", "assistant", "director", "executive", "advisor",
      "expert", "analyst", "practitioner", "support", "worker", "representative", "agent", "partner"
    ]);
    for (const r of targetRoles) {
      for (const w of r.split(/[^a-z0-9]+/)) {
        if (w.length >= 4 && !stopWords.has(w)) {
          substantiveRoleWords.push(w);
        }
      }
    }

    // In tech: Developer <-> Engineer synonym matching
    if (isCandidateTech) {
      substantiveRoleWords.push("developer", "engineer", "software", "tech", "data", "it");
    }

    // In healthcare: Surgeon <-> Doctor <-> Physician <-> Medical Officer synonym matching
    if (isCandidateMedical) {
      substantiveRoleWords.push("surgeon", "doctor", "physician", "clinical", "medical", "nurse", "health");
    }

    if (isCandidateFinance) {
      substantiveRoleWords.push("accountant", "accounting", "auditor", "finance", "financial", "cpa", "acca", "tax", "accounts", "treasury", "credit");
    }

    const isCandidateAgri = /agric|agronom|farm|crop|livestock|horticultur|agribusiness/i.test(candidateRolesBlob);
    if (isCandidateAgri) {
      substantiveRoleWords.push("agriculture", "agricultural", "agronomist", "farm", "farming", "crop", "livestock", "agribusiness", "horticulture");
    }

    const isCandidateNgo = /ngo|humanitarian|project|m&e|monitoring|grants|community|wash/i.test(candidateRolesBlob);
    if (isCandidateNgo) {
      substantiveRoleWords.push("project", "program", "programme", "monitoring", "evaluation", "humanitarian", "development", "grants", "community", "field");
    }

    const isCandidateProcurement = /procurement|supply chain|logistics|warehouse|purchasing|inventory/i.test(candidateRolesBlob);
    if (isCandidateProcurement) {
      substantiveRoleWords.push("procurement", "supply", "chain", "logistics", "warehouse", "purchasing", "inventory", "buyer", "stores");
    }

    const isCandidateHr = /human resources|hr |talent acquisition|people and culture|recruiter/i.test(candidateRolesBlob);
    if (isCandidateHr) {
      substantiveRoleWords.push("human", "resources", "talent", "recruitment", "recruiter", "personnel");
    }

    if (isCandidateLegal) {
      substantiveRoleWords.push("legal", "counsel", "lawyer", "attorney", "advocate", "compliance", "litigation");
    }

    const isCandidateEducation = /teacher|lecturer|professor|curriculum|education|academic|tutor/i.test(candidateRolesBlob);
    if (isCandidateEducation) {
      substantiveRoleWords.push("teacher", "teaching", "lecturer", "professor", "curriculum", "education", "academic", "tutor", "instructor");
    }

    const matchesSubstantiveTitle = substantiveRoleWords.some(w => {
      const cleanW = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${cleanW}\\b`, "i").test(titleLower);
    });

    // In description: Only match if substantive role tokens appear in core context, not random boilerplate
    const matchesTargetSkillsInDesc = (directive.requiredSkills || []).filter(s => {
      if (s.length < 3 || stopWords.has(s.toLowerCase())) return false;
      const cleanS = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${cleanS}\\b`, "i").test(desc);
    }).length >= 2;

    if (!directTitleMatch && !matchesSubstantiveTitle && !matchesTargetSkillsInDesc) {
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
