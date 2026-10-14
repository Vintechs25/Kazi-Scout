/**
 * Pre-Ingestion Qualification Gate (Phase 4)
 * Deterministic qualification filter executed before saving or activating jobs.
 * Enforces strict experience ceilings, executive rejection, off-family rejection,
 * and foreign country restrictions.
 */

import type { SearchDirective } from "./search-directive";
import { isJobExpired, extractDeadlineDate, type NormalizedJob } from "./job-search-service";

export interface GateEvaluation {
  qualified: boolean;
  rejectionReason?: string;
  isExpired: boolean;
}

// Executive and C-Level patterns that should NEVER enter an entry/junior pipeline
export const EXECUTIVE_REGEX = /\b(chief\s+technology\s+officer|cto|cio|ciso|chief\s+executive|ceo|coo|cfo|director\b|vice\s+president|vp\b|head\s+of\b|general\s+manager|managing\s+director|executive\s+director|partner\b)\b/i;

// Unrelated non-tech professional families
export const OFF_FAMILY_PROFESSIONS_REGEX = /\b(oncology|pharmacist|pharmacy|doctor|physician|nurse|nursing|veterin|tierarzt|dental|dentist|surgeon|attorney|lawyer|legal\s+counsel|paralegal|accountant|accounts\s+payable|auditor|audit\s+associate|fp&a|wealth\s+management|payroll\s+assistant|real\s+estate|property\s+manager|horeca|kundenservice|telefondienst|school\s+teacher|tutor|category\s+buyer|merchandiser|logistics\s+coordinator|procurement\s+officer|storekeeper|receptionist|front\s+desk|driver|chauffeur|chef|cook|barista|waiter|waitress|security\s+guard|caretaker|cleaner|housekeeper|cashier)\b/i;

// Foreign residency restrictions that prevent international applicants
export const FOREIGN_RESIDENCY_LOCK_REGEX = /\b(must\s+(?:currently\s+)?reside\s+in\s+(?:the\s+)?(?:us|usa|united\s+states|uk|united\s+kingdom|eu|europe|canada|australia|germany|france)|us\s+citizens\s+only|us\s+residents\s+only|authorized\s+to\s+work\s+in\s+the\s+us\s+without\s+sponsorship|w2\s+only|c2c\s+only|us\s+only\b|usa\s+only\b|uk\s+only\b|eu\s+only\b|canada\s+only\b)\b/i;

// Senior / Lead level patterns
export const SENIOR_LEVEL_REGEX = /\b(senior\b|sr\.?\b|staff\s+(?:engineer|developer)|principal\b|lead\s+(?:developer|engineer|architect)|architect\b|expert\b|tier\s?(?:iii|3)\b|level\s?3\b|l3\b)\b/i;

// Scams and fee-charging recruitment
export const SCAM_ROLE_REGEX = /\b(registration\s+fee|application\s+fee|pay\s+to\s+apply|send\s+money|training\s+fee|telegram\s+only|whatsapp\s+only|submit\s+cvs\s*-\s*new\s+recruitment)\b/i;

// Junior / Entry friendly indicators
export const JUNIOR_ROLE_INDICATORS = /\b(junior|jr\.?|entry[- ]level|associate|trainee|apprentice|intern(?:ship)?|graduate|tier\s?(?:i|1)\b|level\s?1\b|l1\b|assistant|technician)\b/i;

// Tech domain keywords to verify technology relevance
export const TECH_DOMAIN_KEYWORDS = [
  "software", "developer", "engineer", "web", "frontend", "front-end", "backend", "back-end",
  "full stack", "fullstack", "react", "node", "javascript", "typescript", "python",
  "it support", "support technician", "ict officer", "ict assistant", "ict support", "ict technician",
  "information technology", "information communication technology", "ict", "computer", "computing",
  "help desk", "helpdesk", "service desk", "desktop support", "technical support",
  "network", "systems", "system administrator", "systems administrator", "sysadmin", "database", "sql", "linux", "windows",
  "database administrator", "dba", "system analyst", "systems analyst", "programmer", "webmaster", "informatics",
  "telecom", "telecommunications", "digital", "hardware", "it technician", "it specialist", "it officer", "it assistant",
  "technical assistant", "technician", "cisco", "lan", "wan", "devops", "cloud", "qa", "quality assurance",
  "test engineer", "automation", "data analyst", "security", "cybersecurity", "med360", "emr", "ehr", "health it",
];

export const KENYA_COUNTIES_AND_HUBS = [
  "kenya", "nairobi", "mombasa", "kisumu", "nakuru", "eldoret", "kiambu", "machakos",
  "meru", "kilifi", "kwale", "uasin gishu", "nyeri", "kericho", "kakamega", "kisii",
  "bungoma", "kajiado", "embu", "kitui", "garissa", "laikipia", "muranga", "murang'a",
  "turkana", "homa bay", "siaya", "trans nzoia", "baringo", "narok", "taita taveta",
  "makueni", "kirinyaga", "tharaka", "nyandarua", "bomet", "busia", "elgeyo marakwet",
  "isiolo", "lamu", "mandera", "marsabit", "migori", "nyamira", "samburu", "tana river",
  "vihiga", "wajir", "west pokot"
];

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
      if (!isNaN(yrs) && yrs > 0 && yrs < 30) {
        return yrs;
      }
    }
  }
  return null;
}

/**
 * Deterministic qualification gate for a single job
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

  // Determine if this is a Kenya market job
  const isKenyaMarket =
    KENYA_COUNTIES_AND_HUBS.some((hub) => loc.includes(hub) || fullText.includes(hub)) ||
    src.includes("kenya") ||
    src.includes("psck") ||
    src.includes("psc") ||
    Boolean((job as any).sourceUrl && (job as any).sourceUrl.includes(".ke"));

  const isWorldwideRemote =
    loc.includes("worldwide") ||
    loc.includes("anywhere") ||
    loc.includes("global") ||
    loc.includes("africa") ||
    loc.includes("emea");

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

  // 3. Executive / Director Level Gate
  if (EXECUTIVE_REGEX.test(title)) {
    return {
      qualified: false,
      isExpired: false,
      rejectionReason: `Executive or director-level position (${title}) exceeds candidate entry/junior target level`,
    };
  }

  // 4. Senior / Lead Level Gate
  const isSeniorTitle = SENIOR_LEVEL_REGEX.test(title);
  const minYears = extractMinYearsRequired(desc);
  // Kenya government and market jobs routinely specify 3 years for entry/intermediate ICT officer & support roles
  const baseAllowed = directive.maxExperienceYears ?? 2;
  const maxAllowedYears = isKenyaMarket ? Math.max(baseAllowed, 4) : baseAllowed;

  if (isSeniorTitle && !JUNIOR_ROLE_INDICATORS.test(title)) {
    return {
      qualified: false,
      isExpired: false,
      rejectionReason: `Senior or lead position (${title}) exceeds candidate entry/junior profile (target max ${maxAllowedYears} yrs)`,
    };
  }

  if (minYears !== null && minYears > maxAllowedYears) {
    return {
      qualified: false,
      isExpired: false,
      rejectionReason: `Requires ${minYears}+ years of experience, exceeding candidate ceiling of ${maxAllowedYears} years`,
    };
  }

  // 5. Off-Family Non-Tech Profession Gate
  if (OFF_FAMILY_PROFESSIONS_REGEX.test(title)) {
    return {
      qualified: false,
      isExpired: false,
      rejectionReason: `Unrelated non-technology profession (${title}) outside candidate IT/software profile`,
    };
  }

  // 6. Technology Relevance Gate (Conservative check)
  const isShortDescription = desc.split(/\s+/).length < 40;
  const titleLower = title.toLowerCase();

  const titleHasTech = TECH_DOMAIN_KEYWORDS.some((kw) => titleLower.includes(kw));
  const descHasTech = TECH_DOMAIN_KEYWORDS.some((kw) => fullText.includes(kw));

  // If title is obviously non-tech and text contains zero tech keywords
  if (!titleHasTech && !descHasTech) {
    return {
      qualified: false,
      isExpired: false,
      rejectionReason: "Listing does not match technology, software, web, IT support, or technical systems domain",
    };
  }

  // 7. Geographic and Work-Authorization Restrictions Gate
  // Foreign residency lock (US only, UK only, etc.)
  if (FOREIGN_RESIDENCY_LOCK_REGEX.test(fullText)) {
    if (!isKenyaMarket && !isWorldwideRemote) {
      return {
        qualified: false,
        isExpired: false,
        rejectionReason: "Restricted to foreign residency or local citizens (US/UK/EU/Canada work authorization required)",
      };
    }
  }

  // Explicit country restriction in location (e.g., location is "Italy", "Mexico", "Ireland", "USA" without Kenya or Worldwide)
  const foreignCountriesOnly = ["italy", "mexico", "ireland", "spain", "brazil", "japan", "australia"];
  for (const c of foreignCountriesOnly) {
    if (loc === c || loc.startsWith(`${c},`) || loc.endsWith(`, ${c}`)) {
      if (!isKenyaMarket && !isWorldwideRemote) {
        return {
          qualified: false,
          isExpired: false,
          rejectionReason: `Location restricted to onsite or local residents of ${c.toUpperCase()}`,
        };
      }
    }
  }

  // Passed all pre-ingestion gates!
  return {
    qualified: true,
    isExpired: false,
  };
}
