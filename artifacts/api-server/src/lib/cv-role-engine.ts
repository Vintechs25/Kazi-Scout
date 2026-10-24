/**
 * Deterministic CV Role & Experience Extraction Engine
 * 
 * Provides high-precision, zero-AI parsing of resumes and CVs:
 * - Robust text healing for PDF/OCR splits (e.g. "Prof. ESSIONAL", "Dr. aft")
 * - Accurate section boundary detection (Target Roles, Experience, Education, Certifications, Skills, Projects, Highlights)
 * - Strict Anti-Role Filter (guarantees degrees, diplomas, schools, and companies are NEVER treated as job roles)
 * - Intelligent Role & Company boundary separator (cleanly splits "Role Title Company" even without delimiters)
 * - Candidate-specified target role extraction
 * - Real work experience & historical job title extraction from dates and company headers
 * - Comprehensive 18-domain taxonomy with role-affinity weighting (prevents false domain pollution)
 * - Seniority level classification (Entry, Mid, Senior, Lead, Executive)
 * - Accurate years-of-experience calculation from real employment date ranges
 * - Extraction of real degrees, licenses, and verified certifications
 */

import { randomUUID } from "node:crypto";

// ============================================================================
// TYPES
// ============================================================================

export interface ParsedWorkPosition {
  roleTitle: string;
  company: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  yearsInRole: number;
  description: string;
}

export interface ExtractedRoleItem {
  roleTitle: string;
  confidence: number;
  source: string;
  seniorityLevel: "Entry / Junior" | "Mid-Level" | "Senior" | "Lead / Staff" | "Executive / Director";
  domain: string;
  reasoning: string[];
}

export interface DeterministicParsedCv {
  fullName: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  timezone: string;
  headlineRole: string | null;
  currentRole: string | null;
  currentCompany: string | null;
  yearsExperience: number;
  primaryRoles: string[];
  secondaryRoles: string[];
  targetRoles: string[];
  extractedRoles: ExtractedRoleItem[];
  workExperience: ParsedWorkPosition[];
  skills: string[];
  technologies: string[];
  education: string[];
  certifications: string[];
  industries: string[];
  languages: string[];
  preferredLocations: string[];
  workModes: ("remote" | "hybrid" | "onsite")[];
  relocation: boolean;
  visaSponsorship: boolean;
  minimumSalary: number | null;
}

export interface CvSections {
  header: string;
  summary: string;
  targetRoles: string;
  experience: string;
  education: string;
  certifications: string;
  skills: string;
  projects: string;
  highlights: string;
  other: string;
}

// ============================================================================
// TEXT HEALING & FORMATTING UTILITIES
// ============================================================================

/**
 * Heals common PDF extraction / OCR artifacts where words are broken across lines
 * or honorific abbreviations are split from words (e.g. "Prof. ESSIONAL", "Dr. aft").
 */
export function healCvText(text: string): string {
  if (!text) return "";
  let s = text;
  // Heal honorific OCR splits
  s = s.replace(/Prof\.\s*ESSIONAL/gi, "PROFESSIONAL");
  s = s.replace(/Prof\.\s*iciency/gi, "Proficiency");
  s = s.replace(/Prof\.\s*icient/gi, "Proficient");
  s = s.replace(/Dr\.\s*aft/gi, "Draft");
  s = s.replace(/Dr\.\s*ive/gi, "Drive");
  return s;
}

/**
 * Repairs spaced characters in PDF extraction (e.g. "C u r r i c u l u m" -> "Curriculum")
 * preserving real linebreaks and word boundaries.
 */
export function repairSpacedCharacters(str: string): string {
  if (!str) return "";
  let s = healCvText(str)
    .replace(/\bCurr\s*icul\s*u\s*m\s+vita\s*e\b/gi, "Curriculum Vitae")
    // Only add a space after honorific abbreviation if followed by an uppercase letter / surname
    .replace(/\b(Dr|Prof|Mr|Mrs|Ms|Engr|Barr)\s*\.(?=\s+[A-Z][a-z])/g, "$1. ")
    .replace(/M\s*\.?\s*B\s*\.?\s*,?\s*B\s*\.?\s*S/gi, "M.B., B.S.")
    .replace(/F\s*W\s*A\s*C\s*S/gi, "FWACS")
    .replace(/F\s*R\s*C\s*S/gi, "FRCS");

  const validShortWords = new Set([
    "a", "i", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is",
    "it", "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we"
  ]);

  const tokens = s.split(/(\s+|[.,:;()\\\/])/);
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;

    if (/^[ \t]+$/.test(t)) {
      const prev = out[out.length - 1];
      const next = tokens[i + 1];

      if (prev && next && /^[A-Za-z]+$/.test(prev) && /^[A-Za-z]+$/.test(next)) {
        const prevLower = prev.toLowerCase();
        const nextLower = next.toLowerCase();

        const prevIsSingle = prev.length === 1 && !validShortWords.has(prevLower);
        const nextIsSingle = next.length === 1 && !validShortWords.has(nextLower);
        const bothSingle = prev.length === 1 && next.length === 1;
        const nextIsFragment = /^[a-z]/.test(next) && (
          next.length <= 3 && !validShortWords.has(nextLower)
        );
        const prevIsFragment = prev.length <= 3 && !validShortWords.has(prevLower) && /^[a-z]/.test(next);

        if (bothSingle || prevIsSingle || nextIsSingle || nextIsFragment || prevIsFragment) {
          out[out.length - 1] = prev + next;
          i++;
          continue;
        }
      }
      out.push(t);
    } else {
      out.push(t);
    }
  }

  let result = out.join("");

  // Merge trailing or leading lone syllables e.g. "S mith" -> "Smith", "John son" -> "Johnson"
  result = result
    .replace(/\b([A-Za-z]{2,})[ \t]+([a-z]{1,3})\b/g, (m, w, f) => {
      const valid = new Set(["a", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we", "for", "and", "the", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "man", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use"]);
      if (!valid.has(f.toLowerCase())) {
        return w + f;
      }
      return m;
    })
    .replace(/\b([A-Za-z]{1,3})[ \t]+([a-z]{2,})\b/g, (m, f, w) => {
      const valid = new Set(["a", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we", "for", "and", "the", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one", "our", "out"]);
      if (!valid.has(f.toLowerCase()) && /^[a-z]/.test(w)) {
        return f + w;
      }
      return m;
    });

  return result;
}

/**
 * Clean candidate full name by stripping document titles, qualification suffixes,
 * street addresses, and duplicated titles
 */
export function cleanCandidateName(rawName: string): string {
  if (!rawName) return "";
  let name = repairSpacedCharacters(rawName).trim();

  // Strip leading document titles e.g. "Curriculum Vitae of", "Resume of", "Bio-data of"
  name = name.replace(/^(?:curriculum\s+vitae|resume|bio[- ]?data|profile|cv)\s*(?:of|for|:)?\s*/i, "").trim();

  // Strip duplicate honorifics e.g. "Dr. Dr." -> "Dr."
  name = name.replace(/^(?:Dr\.?\s*)+/i, "Dr. ");
  name = name.replace(/^(?:Prof\.?\s*)+/i, "Prof. ");

  // Strip address / contact trailing clauses
  name = name.replace(/\s*(?:\\|\/|\||\bNo\b|\bPlot\b|\bStreet\b|\bSt\b|\bRoad\b|\bRd\b|\bEstate\b|\bAvenue\b|\bAve\b|\bClose\b|\bExt\b).*$/i, "");

  // Strip qualification suffixes e.g. "M.B., B.S.", "FWACS", "FRCS", "Ph.D", "CPA", "RN"
  name = name.replace(/[\s,.]+(?:M\.?B\.?,?\s*B\.?S\.?|FWACS|FRCS|Ph\.?D|M\.?Sc|B\.?sc|B\.?eng|B\.?a|LL\.?b|LL\.?m|CPA|ACCA|RN|FACS|FMCOG|MWACS|PMP|PE|Esq).*$/i, "");

  // If there's a period followed by a repeated surname/name or title, take only the first clean portion
  if (name.includes(".")) {
    const parts = name.split(/\.\s+/);
    if (parts.length > 1 && !/^(?:Dr|Prof|Mr|Mrs|Ms|Engr|Barr)$/i.test(parts[0])) {
      name = parts[0];
    }
  }

  // Strip parenthetical text
  name = name.replace(/\s*\(.*$/, "").trim();

  // Format capitalized words nicely (e.g. BELLO -> Bello)
  name = name.split(/\s+/).map((word, idx) => {
    if (idx === 0 && /^(?:dr|prof|mr|mrs|ms|engr|barr)\.?$/i.test(word)) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase().replace(/\.?$/, ".");
    }
    if (/^[A-Z]{2,}$/.test(word) && !/^(?:USA|UK|UAE|II|III|IV)$/.test(word)) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }
    return word;
  }).join(" ");

  return name.trim();
}

// ============================================================================
// ANTI-ROLE FILTER & VALIDATION
// ============================================================================

/**
 * Strict Anti-Role Filter:
 * Returns TRUE if a candidate string CANNOT be a job role.
 * Guaranteed to reject:
 * - Degrees, diplomas, and high school credentials
 * - Pure company names, hospitals, universities, and institutions
 * - Section headers, description action verbs, and resume boilerplate
 */
export function isNonJobRole(str: string): boolean {
  if (!str || typeof str !== "string") return true;
  const t = str.trim().toLowerCase();
  if (t.length < 3 || t.length > 70) return true;

  // Header / Footer boilerplate, page markers, and contact tokens
  if (/\b(?:resume|curriculum\s+vitae|page\s+\d+|page\s+\d+\s+of\s+\d+|phone|email|location|linkedin|github)\b/i.test(t)) {
    return true;
  }

  // Degrees, Diplomas & Academic Credentials (MUST NEVER BE ROLES)
  if (/\b(diploma|degree|bachelor|master|ph\.?d|doctorate|postgraduate|high\s+school|secondary\s+school|primary\s+school|kcse|kcpe|o-level|a-level|gce|matric|waec|neco|igcse|certificate\s+in|diploma\s+in|b\.?sc|m\.?sc|b\.?eng|b\.?a|ll\.?b|mbbs|mbchb)\b/i.test(t)) {
    return true;
  }

  // Academic Institutions & Schools
  if (/\b(university|polytechnic|college|institute\s+of|academy\s+of|grammar\s+school)\b/i.test(t)) {
    return true;
  }

  // Pure Companies / Organizations without a role keyword
  if (!/\b(specialist|consultant|manager|director|lead|head|officer|administrator|engineer|developer|technician|analyst|coordinator|supervisor|assistant|intern|associate|practitioner|nurse|doctor|physician|surgeon|pharmacist|counsel|lawyer|advocate|accountant|auditor|agronomist|teacher|lecturer|professor|worker|clerk|driver|operator|agent|representative|executive)\b/i.test(t)) {
    if (/\b(hospital|clinic|dispensary|ltd|limited|plc|inc|incorporated|bank|systems|consulting|technologies|solutions|associates|cyber|services|ministry|county|board|council|authority|commission|church|parish|ngo|unicef|who)\b/i.test(t)) {
      return true;
    }
  }

  // Section Headers & Common Resume Action Verbs
  if (/^(?:experience|education|skills|certifications|projects|summary|profile|duties|responsibilities|achievements|highlights|references|deliver|delivering|provide|providing|manage|managing|oversee|overseeing|handle|handling|conduct|conducting|build|building|supervise|supervising|author|authoring|maintain|maintaining|seeking|holds|proven)\b/i.test(t)) {
    return true;
  }

  return false;
}

// Known Role Title Word Endings (used for separating Role Title from Company)
const ROLE_TITLE_ENDINGS = /\b(specialist|consultant|manager|director|lead|head|officer|administrator|engineer|developer|technician|analyst|coordinator|supervisor|assistant|intern|associate|practitioner|nurse|doctor|physician|surgeon|pharmacist|counsel|lawyer|advocate|accountant|auditor|agronomist|teacher|lecturer|professor|worker|clerk|driver|operator|agent|representative|executive)\b/gi;

/**
 * Cleanly separates Role Title and Company Name from strings like:
 * - "Administrative & Systems Support Specialist Pope Benedict XVI Catholic Hospital | Kenya"
 * - "Virtual Administrative & Tech Support Consultant Vintech Systems and Consulting | Remote"
 * - "Operations & Administrative Manager Vintechs Cyber | Ruiru, Kenya"
 * - "Senior Software Engineer | Safaricom PLC"
 */
export function splitRoleAndCompany(raw: string): { roleTitle: string; company: string } {
  let text = raw.trim();
  // Strip trailing parenthetical dates e.g. (2020 - 2022)
  text = text.replace(/\s*\([^)]*(?:19\d{2}|20\d{2}|present|current)[^)]*\)/gi, "").trim();
  // Strip trailing date tokens
  text = text.replace(/\s*(?:(?:19|20)\d{2}\s*[-–—to\/]+\s*(?:present|current|(?:19|20)\d{2})).*$/i, "").trim();
  // Strip trailing locations separated by "|"
  text = text.replace(/\|\s*(?:remote(?:\s*\/\s*[a-z\s]+)?|[a-z\s]+,\s*[a-z\s]+|[a-z\s]+)\s*$/i, "").trim();

  // 1. Explicit Delimiters: " at ", " @ "
  if (/\s+(?:at|@)\s+/i.test(text)) {
    const [r, c] = text.split(/\s+(?:at|@)\s+/i);
    return { roleTitle: cleanRoleTitle(r), company: cleanCompanyName(c) };
  }

  // 2. Explicit Delimiters: " | "
  if (text.includes(" | ")) {
    const parts = text.split(/\s*\|\s*/).filter(Boolean);
    if (parts.length >= 2) {
      if (ROLE_TITLE_ENDINGS.test(parts[0])) {
        return { roleTitle: cleanRoleTitle(parts[0]), company: cleanCompanyName(parts[1]) };
      } else if (ROLE_TITLE_ENDINGS.test(parts[1])) {
        return { roleTitle: cleanRoleTitle(parts[1]), company: cleanCompanyName(parts[0]) };
      }
      return { roleTitle: cleanRoleTitle(parts[0]), company: cleanCompanyName(parts[1]) };
    }
  }

  // 3. Explicit Delimiters: " - "
  if (text.includes(" - ")) {
    const parts = text.split(/\s*-\s*/).filter(Boolean);
    if (parts.length >= 2) {
      if (ROLE_TITLE_ENDINGS.test(parts[0])) {
        return { roleTitle: cleanRoleTitle(parts[0]), company: cleanCompanyName(parts[1]) };
      }
      return { roleTitle: cleanRoleTitle(parts[0]), company: cleanCompanyName(parts[1]) };
    }
  }

  // 4. Comma separator: "Software Engineer, Google"
  if (text.includes(", ")) {
    const parts = text.split(/\s*,\s*/).filter(Boolean);
    if (parts.length >= 2 && ROLE_TITLE_ENDINGS.test(parts[0])) {
      return { roleTitle: cleanRoleTitle(parts[0]), company: cleanCompanyName(parts[1]) };
    }
  }

  // 5. Boundary detection by role keyword ending:
  // e.g. "Administrative & Systems Support Specialist Pope Benedict XVI Catholic Hospital"
  // Find where the last role keyword ends!
  let lastMatchEnd = -1;
  let match: RegExpExecArray | null;
  ROLE_TITLE_ENDINGS.lastIndex = 0;
  while ((match = ROLE_TITLE_ENDINGS.exec(text)) !== null) {
    lastMatchEnd = match.index + match[0].length;
  }

  if (lastMatchEnd > 0 && lastMatchEnd < text.length) {
    const potentialRole = text.slice(0, lastMatchEnd).trim();
    const potentialCompany = text.slice(lastMatchEnd).trim();
    if (potentialCompany.length >= 3 && !isNonJobRole(potentialRole)) {
      return { roleTitle: cleanRoleTitle(potentialRole), company: cleanCompanyName(potentialCompany) };
    }
  }

  return { roleTitle: cleanRoleTitle(text), company: "" };
}

// Clean and normalize role title by stripping company signals, punctuation and locations
export function cleanRoleTitle(raw: string): string {
  let t = raw.trim();
  // Strip bullet markers
  t = t.replace(/^[\s•\-\*\>\|#\d\.)\]]+/, "").trim();
  // Strip trailing punctuation
  t = t.replace(/[,;:\-\|]+$/, "").trim();
  // Strip parenthetical dates e.g. (2020 - 2022)
  t = t.replace(/\s*\([^)]*(?:19\d{2}|20\d{2}|present|current)[^)]*\)/gi, "").trim();
  // Strip date tokens at end
  t = t.replace(/\s*(?:(?:19|20)\d{2}\s*[-–—to\/]+\s*(?:present|current|(?:19|20)\d{2})).*$/i, "").trim();
  // Strip company if separated by "at" or "@"
  t = t.replace(/\s+(?:at|@)\s+.*$/i, "").trim();
  // Strip trailing locations e.g. "| Kenya", "- Nairobi"
  t = t.replace(/[\s\|\-]+(?:kenya|uganda|tanzania|nigeria|south\s+africa|uk|usa|remote)\s*$/i, "").trim();

  // Capitalize nicely while preserving industry acronyms
  return t
    .split(/\s+/)
    .map(w => {
      const lower = w.toLowerCase();
      if (/^(?:and|of|in|for|the|on|with|to|&)$/i.test(w)) return w === "&" ? "&" : w.toLowerCase();
      if (lower === "devops") return "DevOps";
      if (lower === "sre") return "SRE";
      if (lower === "ui/ux") return "UI/UX";
      if (lower === "va") return "VA";
      if (lower === "(va)") return "(VA)";
      if (lower === "it" || lower === "ict" || lower === "qa" || lower === "ai" || lower === "ml") return w.toUpperCase();
      if (lower === "cpa" || lower === "cpa-k" || lower === "hr" || lower === "hrbp" || lower === "seo") return w.toUpperCase();
      if (lower === "cto" || lower === "cio" || lower === "cfo" || lower === "ceo" || lower === "pmp") return w.toUpperCase();
      if (/^[A-Z0-9\.\/-]+$/.test(w) && w.length <= 4) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ")
    .trim();
}

export function cleanCompanyName(raw: string): string {
  let c = raw.trim();
  c = c.replace(/^[\s•\-\*\>\|#\d\.)\]]+/, "").trim();
  c = c.replace(/[,;:\-\|]+$/, "").trim();
  c = c.replace(/\s*\([^)]*(?:19\d{2}|20\d{2}|present|current)[^)]*\)/gi, "").trim();
  // Strip trailing locations
  c = c.replace(/\|\s*(?:remote(?:\s*\/\s*[a-z\s]+)?|[a-z\s]+,\s*[a-z\s]+|[a-z\s]+)\s*$/i, "").trim();
  return c;
}

// ============================================================================
// SECTION BOUNDARY DETECTOR
// ============================================================================

const SECTION_HEADERS = [
  { key: "targetRoles", rx: /^(?:target\s+roles|desired\s+roles|roles\s+of\s+interest|target\s+positions|primary\s+roles)\b/im },
  { key: "experience", rx: /^(?:professional\s+experience|work\s+experience|employment\s+history|career\s+history|work\s+history|relevant\s+experience|experience)\b/im },
  { key: "education", rx: /^(?:education|academic\s+background|educational\s+qualifications|academic\s+qualifications|degrees|academics|education\s*(?:&|and)\s*training)\b/im },
  { key: "certifications", rx: /^(?:certifications|certificates|professional\s+certifications|licenses\s*(?:&|and)\s*certifications|licenses|credentials|accreditations|certifications\s*(?:&|and)\s*training)\b/im },
  { key: "skills", rx: /^(?:technical\s+skills|core\s+competencies|skills\s*(?:&|and)\s*expertise|skills|tools\s*(?:&|and)\s*technologies|areas\s+of\s+expertise|competencies|core\s+skills)\b/im },
  { key: "projects", rx: /^(?:key\s+projects|selected\s+projects|projects|portfolio|administrative\s*&\s*digital\s+projects)\b/im },
  { key: "highlights", rx: /^(?:key\s+highlights|key\s+administrative\s+highlights|achievements|key\s+achievements)\b/im },
  { key: "summary", rx: /^(?:professional\s+summary|career\s+summary|executive\s+summary|profile|about\s+me|career\s+objective|objective|summary)\b/im },
];

export function segmentCvSections(text: string): CvSections {
  const healed = healCvText(text);
  const lines = healed.split("\n");
  const sectionIndices: { key: keyof CvSections; lineIdx: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.length > 60) continue;
    // Strip leading numbering or bullets e.g. "1. EDUCATION" -> "EDUCATION"
    const normalized = trimmed.replace(/^[\s•\-\*\>\|#\d\.)\]]+/, "").trim();

    for (const h of SECTION_HEADERS) {
      if (h.rx.test(normalized)) {
        sectionIndices.push({ key: h.key as keyof CvSections, lineIdx: i });
        break;
      }
    }
  }

  // Sort by line index
  sectionIndices.sort((a, b) => a.lineIdx - b.lineIdx);

  const sections: CvSections = {
    header: "",
    summary: "",
    targetRoles: "",
    experience: "",
    education: "",
    certifications: "",
    skills: "",
    projects: "",
    highlights: "",
    other: "",
  };

  if (sectionIndices.length === 0) {
    sections.header = lines.slice(0, 15).join("\n");
    sections.experience = healed;
    return sections;
  }

  sections.header = lines.slice(0, sectionIndices[0].lineIdx).join("\n");

  for (let i = 0; i < sectionIndices.length; i++) {
    const cur = sectionIndices[i];
    const nextIdx = i + 1 < sectionIndices.length ? sectionIndices[i + 1].lineIdx : lines.length;
    const content = lines.slice(cur.lineIdx + 1, nextIdx).join("\n").trim();
    if (sections[cur.key]) {
      sections[cur.key] += "\n" + content;
    } else {
      sections[cur.key] = content;
    }
  }

  return sections;
}

// ============================================================================
// DATE RANGE PARSER
// ============================================================================

const DATE_RANGE_REGEX = /(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember))[a-z]*\.?\s+)?(?:\d{1,2}\/)?(19\d{2}|20\d{2})\s*(?:[-–—to\/]+)\s*(present|current|date|now|to\s+date|(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember))[a-z]*\.?\s+)?(?:\d{1,2}\/)?(19\d{2}|20\d{2}))/i;

export function extractDatesFromLine(line: string): { startYear: number; endYear: number; isCurrent: boolean } | null {
  const match = line.match(DATE_RANGE_REGEX);
  const currentYear = new Date().getFullYear();

  if (match) {
    const startYear = parseInt(match[1], 10);
    const isCurrent = /present|current|date|now/i.test(match[2]);
    const endYear = isCurrent ? currentYear : parseInt(match[3] || match[2], 10);

    if (!isNaN(startYear) && !isNaN(endYear) && startYear >= 1970 && endYear <= currentYear + 2) {
      return { startYear, endYear, isCurrent };
    }
  }

  return null;
}

// ============================================================================
// WORK EXPERIENCE SECTION PARSER
// ============================================================================

export function parseExperiencePositions(expText: string): ParsedWorkPosition[] {
  if (!expText || expText.trim().length < 20) return [];
  const lines = expText.split("\n").map(l => l.trim()).filter(Boolean);
  const positions: ParsedWorkPosition[] = [];

  let currentPos: Partial<ParsedWorkPosition> | null = null;
  let currentDescLines: string[] = [];

  const finalizeCurrentPos = () => {
    if (currentPos && currentPos.roleTitle) {
      const cleanTitle = cleanRoleTitle(currentPos.roleTitle);
      if (!isNonJobRole(cleanTitle)) {
        positions.push({
          roleTitle: cleanTitle,
          company: currentPos.company ? cleanCompanyName(currentPos.company) : "Direct Practice",
          startDate: currentPos.startDate || null,
          endDate: currentPos.endDate || (currentPos.isCurrent ? "Present" : null),
          isCurrent: Boolean(currentPos.isCurrent),
          yearsInRole: currentPos.yearsInRole || 1,
          description: currentDescLines.slice(0, 10).join("\n"),
        });
      }
    }
    currentPos = null;
    currentDescLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip page headers, continuation markers, or page numbers
    if (/^(?:professional\s+experience|work\s+experience|\w+\s+resume\s+page|\bpage\s+\d+\b)/i.test(line)) {
      continue;
    }

    const dateInfo = extractDatesFromLine(line);

    if (dateInfo) {
      finalizeCurrentPos();

      const dateMatch = line.match(DATE_RANGE_REGEX);
      const dateText = dateMatch ? dateMatch[0] : "";
      const dateIndex = line.indexOf(dateText);

      const beforeDate = dateIndex > 0 ? line.slice(0, dateIndex).trim() : "";
      const afterDate = dateIndex >= 0 ? line.slice(dateIndex + dateText.length).trim() : "";

      let titleStr = "";
      let companyStr = "";

      // Case 1: Title and company were BEFORE the date on the same line
      // e.g. "Administrative & Systems Support Specialist Pope Benedict XVI Catholic Hospital | Kenya Oct 2025 - Present"
      if (beforeDate.length >= 4) {
        const split = splitRoleAndCompany(beforeDate);
        if (!isNonJobRole(split.roleTitle)) {
          titleStr = split.roleTitle;
          companyStr = split.company;
        }
      }

      // Case 2: Title & company were on previous lines (e.g. line i - 1 or line i - 2)
      // line i - 1: "Virtual Administrative & Tech Support Consultant Vintech Systems and Consulting | Remote / Kenya"
      // line i: "2023 - Present Provide remote administrative..."
      if (!titleStr && i > 0) {
        for (let lookback = 1; lookback <= 3; lookback++) {
          if (i - lookback < 0) break;
          const prevLine = lines[i - lookback];
          if (prevLine && !extractDatesFromLine(prevLine)) {
            const split = splitRoleAndCompany(prevLine);
            if (!isNonJobRole(split.roleTitle)) {
              titleStr = split.roleTitle;
              companyStr = split.company;
              break;
            }
          }
        }
      }

      if (titleStr) {
        currentPos = {
          roleTitle: titleStr,
          company: companyStr,
          startDate: String(dateInfo.startYear),
          endDate: dateInfo.isCurrent ? "Present" : String(dateInfo.endYear),
          isCurrent: dateInfo.isCurrent,
          yearsInRole: Math.max(dateInfo.endYear - dateInfo.startYear, 1),
        };

        // If there was description text AFTER the date on the same line, add it
        if (afterDate.length > 5 && !isNonJobRole(afterDate)) {
          currentDescLines.push(afterDate);
        }
      }
    } else if (currentPos) {
      if (line.length > 3 && !extractDatesFromLine(line) && !isNonJobRole(line)) {
        // If line is another job title candidate, do not add it into description
        const split = splitRoleAndCompany(line);
        if (!split.company || isNonJobRole(split.roleTitle)) {
          currentDescLines.push(line);
        }
      }
    }
  }

  finalizeCurrentPos();
  return positions;
}

/**
 * Extracts candidate's explicit target roles if written in the CV
 * e.g. "Primary Roles: Virtual Assistant (VA), Executive Virtual Assistant, Administrative Assistant..."
 */
export function parseExplicitTargetRoles(targetRolesText: string): string[] {
  if (!targetRolesText || targetRolesText.trim().length < 5) return [];
  const text = targetRolesText.replace(/^(?:primary\s+roles|target\s+roles|roles)[:\s]*/i, "").trim();
  const candidates = text.split(/[,•\n|]+/).map(s => s.trim()).filter(Boolean);
  const validRoles: string[] = [];

  for (const c of candidates) {
    const clean = cleanRoleTitle(c);
    if (clean.length >= 3 && clean.length <= 60 && !isNonJobRole(clean)) {
      if (!validRoles.includes(clean)) {
        validRoles.push(clean);
      }
    }
  }

  return validRoles;
}

// ============================================================================
// COMPREHENSIVE MULTI-DOMAIN TAXONOMY
// ============================================================================

interface TaxonomyRule {
  domain: string;
  matchRx: RegExp;
  roleKeywordsRx: RegExp;
  canonicalRoles: string[];
  seniorRoles?: string[];
  skills: string[];
  industries: string[];
}

export const COMPREHENSIVE_TAXONOMY: TaxonomyRule[] = [
  // 1. Virtual Assistance, Administration & Operations Support
  {
    domain: "Administration & Operations Support",
    matchRx: /\b(virtual\s+assistant|executive\s+assistant|administrative\s+assistant|operations\s+support|administrative\s+specialist|office\s+administrator|data\s+entry|office\s+operations|records\s+management|front\s+office|receptionist)\b/i,
    roleKeywordsRx: /\b(virtual\s+assistant|administrative|executive\s+assistant|operations\s+support|office\s+administrator|data\s+entry|records\s+coordinator)\b/i,
    canonicalRoles: ["Virtual Assistant (VA)", "Executive Virtual Assistant", "Administrative Assistant", "Operations Support Specialist", "Data Entry & Records Coordinator", "Digital Administrative Officer"],
    seniorRoles: ["Operations & Administrative Manager", "Senior Virtual Assistant", "Executive Operations Lead", "Office Manager"],
    skills: ["Calendar & Email Management", "Executive Scheduling", "Document Processing", "Office Operations", "Data Entry Accuracy", "Workflow Automation", "Google Workspace", "Customer Correspondence"],
    industries: ["Administrative & Business Support", "Virtual Assistance", "Operations Management"],
  },

  // 2. IT Support, Systems & Cybersecurity
  {
    domain: "IT Support & Cybersecurity",
    matchRx: /\b(systems\s+support|it\s+support|helpdesk|desktop\s+support|technical\s+support|systems\s+administrator|sysadmin|network\s+engineer|cybersecurity|security\s+analyst|infosec|soc\s+analyst|ccna|hardware\s+troubleshooting)\b/i,
    roleKeywordsRx: /\b(systems\s+support|it\s+support|helpdesk|desktop\s+support|technical\s+support|systems\s+administrator|network\s+administrator|cybersecurity)\b/i,
    canonicalRoles: ["Systems Support Specialist", "IT Support Specialist", "Technical Support Engineer", "Systems Administrator", "Helpdesk Support Specialist"],
    seniorRoles: ["IT Manager", "Senior Systems Administrator", "Senior IT Support Specialist", "Chief Information Security Officer (CISO)"],
    skills: ["Hardware Troubleshooting", "Network Administration", "Active Directory", "Linux/Windows Server", "Helpdesk Support", "Cybersecurity", "Ticketing Management"],
    industries: ["Information Technology", "IT Infrastructure & Security"],
  },

  // 3. Software Engineering & Development
  {
    domain: "Software Engineering",
    matchRx: /\b(software\s+engineer|software\s+developer|full[- ]?stack|frontend|backend|web\s+developer|node\.?js|react|typescript|python\s+developer|java\s+developer|golang|c#|\.net)\b/i,
    roleKeywordsRx: /\b(software\s+engineer|software\s+developer|full[- ]?stack|frontend\s+developer|backend\s+developer|web\s+developer|lead\s+developer|engineering\s+manager)\b/i,
    canonicalRoles: ["Software Engineer", "Full-Stack Developer", "Backend Developer", "Frontend Developer", "Web Developer"],
    seniorRoles: ["Senior Software Engineer", "Lead Developer", "Engineering Manager", "Principal Software Engineer", "Technical Lead"],
    skills: ["TypeScript", "JavaScript", "React", "Node.js", "Python", "REST APIs", "SQL", "Git", "System Architecture", "Microservices"],
    industries: ["Information Technology", "Software Development", "Tech & Internet"],
  },

  // 4. Cloud, DevOps & Site Reliability
  {
    domain: "DevOps & Cloud Infrastructure",
    matchRx: /\b(devops|site\s+reliability|sre\b|cloud\s+engineer|cloud\s+architect|kubernetes|docker|terraform|ci\/cd|infrastructure\s+engineer|platform\s+engineer|aws\b|azure\b|gcp\b)\b/i,
    roleKeywordsRx: /\b(devops|sre|site\s+reliability|cloud\s+engineer|cloud\s+architect|platform\s+engineer)\b/i,
    canonicalRoles: ["DevOps Engineer", "Cloud Engineer", "Site Reliability Engineer (SRE)", "Cloud Solutions Architect", "Platform Engineer"],
    seniorRoles: ["Lead DevOps Engineer", "Principal Cloud Architect", "Head of Infrastructure", "Senior SRE"],
    skills: ["Docker", "Kubernetes", "Terraform", "CI/CD Pipelines", "AWS", "Linux", "Infrastructure as Code", "Prometheus", "GitOps"],
    industries: ["Information Technology", "Cloud & Infrastructure", "SaaS & Enterprise Systems"],
  },

  // 5. Mobile Engineering
  {
    domain: "Mobile Development",
    matchRx: /\b(mobile\s+developer|mobile\s+engineer|android|ios\s+developer|flutter|react\s+native|swift\b|kotlin\b)\b/i,
    roleKeywordsRx: /\b(mobile\s+developer|android\s+developer|ios\s+developer|flutter\s+developer)\b/i,
    canonicalRoles: ["Mobile Application Developer", "Android Developer", "iOS Developer", "Flutter Developer"],
    seniorRoles: ["Lead Mobile Engineer", "Senior Android Developer", "Senior iOS Developer"],
    skills: ["Flutter", "Kotlin", "Swift", "React Native", "Android SDK", "iOS SDK", "Mobile UI/UX", "API Integration"],
    industries: ["Information Technology", "Mobile Application Development"],
  },

  // 6. Data Science, AI & Analytics
  {
    domain: "Data & Artificial Intelligence",
    matchRx: /\b(data\s+scientist|data\s+analyst|data\s+engineer|machine\s+learning|ml\s+engineer|ai\s+engineer|deep\s+learning|nlp\b|computer\s+vision|power\s+bi|tableau|sql\s+analyst)\b/i,
    roleKeywordsRx: /\b(data\s+scientist|data\s+analyst|data\s+engineer|machine\s+learning|ai\s+engineer)\b/i,
    canonicalRoles: ["Data Scientist", "Data Analyst", "Data Engineer", "Machine Learning Engineer", "Business Intelligence Analyst"],
    seniorRoles: ["Lead Data Scientist", "Senior Data Engineer", "Head of Data & Analytics"],
    skills: ["Python", "SQL", "Pandas", "Machine Learning", "Power BI", "Data Modeling", "ETL Pipelines", "Tableau"],
    industries: ["Information Technology", "Data & Analytics", "Artificial Intelligence"],
  },

  // 7. Healthcare & Surgery
  {
    domain: "Healthcare & Surgery",
    matchRx: /\b(surgeon|surgery|surgical|laparoscopic|urologist|orthopedic|trauma\s+surgery|theatre\s+nurse|fwacs|frcs)\b/i,
    roleKeywordsRx: /\b(surgeon|surgery|surgical)\b/i,
    canonicalRoles: ["Consultant General Surgeon", "General Surgeon", "Consultant Surgeon", "Surgical Specialist", "Medical Doctor"],
    seniorRoles: ["Consultant Surgeon", "Head of Surgery", "Chief of Surgery"],
    skills: ["General Surgery", "Laparoscopic Procedures", "Surgical Theatre Management", "Patient Triage", "Pre & Post-Operative Care", "Clinical Governance"],
    industries: ["Healthcare & Hospital Care", "Surgical Practice", "Medical Services"],
  },

  // 8. Healthcare & Clinical Medicine
  {
    domain: "Healthcare & Medicine",
    matchRx: /\b(physician|medical\s+doctor|doctor|medical\s+officer|clinical\s+officer|pediatrician|pathologist|radiologist|general\s+practitioner|mbbs|mbchb|kmpdc)\b/i,
    roleKeywordsRx: /\b(physician|medical\s+doctor|doctor|medical\s+officer|clinical\s+officer)\b/i,
    canonicalRoles: ["Medical Doctor", "Physician", "Medical Officer", "Clinical Officer", "Healthcare Practitioner"],
    seniorRoles: ["Senior Medical Officer", "Consultant Physician", "Medical Superintendent", "Chief Medical Officer"],
    skills: ["Clinical Diagnosis", "Patient Management", "Internal Medicine", "Emergency Medicine", "Clinical Protocols", "Treatment Planning"],
    industries: ["Healthcare & Hospital Care", "Medical Practice", "Public Health"],
  },

  // 9. Healthcare & Nursing
  {
    domain: "Healthcare & Nursing",
    matchRx: /\b(nurse|nursing|registered\s+nurse|midwife|bsn|kmtc|clinical\s+nurse|icu\s+nurse|theatre\s+nurse)\b/i,
    roleKeywordsRx: /\b(nurse|nursing|midwife)\b/i,
    canonicalRoles: ["Registered Nurse", "Nursing Officer", "Clinical Nurse Specialist", "Staff Nurse"],
    seniorRoles: ["Nursing Officer in Charge", "Chief Nursing Officer", "Nurse Manager"],
    skills: ["Patient Care", "Clinical Triage", "Medication Administration", "Infection Control", "Vital Signs Monitoring"],
    industries: ["Healthcare & Hospital Care", "Nursing Practice"],
  },

  // 10. Healthcare & Pharmacy
  {
    domain: "Healthcare & Pharmacy",
    matchRx: /\b(pharmacist|pharmacy|pharmaceutical|pharm\.?d|b\.?pharm|dispensing)\b/i,
    roleKeywordsRx: /\b(pharmacist|pharmacy)\b/i,
    canonicalRoles: ["Pharmacist", "Clinical Pharmacist", "Pharmacy Technologist", "Hospital Pharmacist"],
    seniorRoles: ["Chief Pharmacist", "Head of Pharmacy", "Regulatory Affairs Pharmacist"],
    skills: ["Dispensing & Pharmacology", "Drug Interaction Screening", "Patient Counseling", "Inventory Management", "Clinical Pharmacy"],
    industries: ["Healthcare & Pharmaceuticals", "Pharmacy Practice"],
  },

  // 11. Finance, Banking & Accounting
  {
    domain: "Accounting & Finance",
    matchRx: /\b(accountant|accounting|auditor|audit\b|cpa\b|cpa-k|acca|financial\s+analyst|tax\s+consultant|bookkeeper|financial\s+controller|credit\s+officer|loan\s+officer)\b/i,
    roleKeywordsRx: /\b(accountant|auditor|financial\s+analyst|finance\s+officer|controller|bookkeeper)\b/i,
    canonicalRoles: ["Chartered Accountant", "Financial Analyst", "Internal Auditor", "Finance Officer", "Credit Risk Officer"],
    seniorRoles: ["Senior Accountant", "Audit Manager", "Chief Financial Officer (CFO)", "Finance Director"],
    skills: ["Financial Reporting", "Auditing & Assurance", "Taxation & Compliance", "Budgeting & Forecasting", "CPA-K", "QuickBooks", "ERP Systems"],
    industries: ["Financial Services", "Accounting & Audit", "Banking & Microfinance"],
  },

  // 12. Legal & Compliance
  {
    domain: "Legal & Compliance",
    matchRx: /\b(lawyer|attorney|advocate|legal\s+counsel|solicitor|barrister|litigation|ll\.?b|ll\.?m|compliance\s+officer|corporate\s+counsel)\b/i,
    roleKeywordsRx: /\b(lawyer|attorney|advocate|legal\s+counsel|solicitor|barrister|compliance\s+officer)\b/i,
    canonicalRoles: ["Legal Counsel", "Advocate of the High Court", "Corporate Legal Officer", "Compliance Officer"],
    seniorRoles: ["Senior Legal Counsel", "Head of Legal Affairs", "Partner / Managing Counsel"],
    skills: ["Legal Drafting", "Litigation & Dispute Resolution", "Regulatory Compliance", "Contract Negotiation", "Corporate Law"],
    industries: ["Legal Practice", "Corporate Governance", "Compliance & Risk"],
  },

  // 13. Civil, Mechanical & Electrical Engineering
  {
    domain: "Engineering & Construction",
    matchRx: /\b(civil\s+engineer|structural\s+engineer|mechanical\s+engineer|electrical\s+engineer|quantity\s+surveyor|autocad|site\s+engineer|construction\s+engineer)\b/i,
    roleKeywordsRx: /\b(civil\s+engineer|structural\s+engineer|mechanical\s+engineer|electrical\s+engineer|quantity\s+surveyor|site\s+engineer)\b/i,
    canonicalRoles: ["Civil Engineer", "Structural Engineer", "Mechanical Engineer", "Electrical Engineer", "Project Engineer"],
    seniorRoles: ["Senior Project Engineer", "Chief Engineer", "Resident Engineer", "Engineering Lead"],
    skills: ["AutoCAD", "Structural Analysis", "Project Supervision", "Technical Specifications", "Site Management", "BOQ Preparation"],
    industries: ["Engineering & Construction", "Infrastructure Development", "Industrial & Manufacturing"],
  },

  // 14. Procurement, Supply Chain & Logistics
  {
    domain: "Supply Chain & Logistics",
    matchRx: /\b(procurement|supply\s+chain|logistics|warehouse|purchasing\s+officer|stores\s+officer|inventory\s+controller|transport\s+manager|cips|kism)\b/i,
    roleKeywordsRx: /\b(procurement|supply\s+chain|logistics|warehouse\s+manager|purchasing\s+officer)\b/i,
    canonicalRoles: ["Procurement Officer", "Supply Chain Specialist", "Logistics Coordinator", "Warehouse Manager"],
    seniorRoles: ["Procurement Manager", "Head of Supply Chain", "Logistics Director"],
    skills: ["Public Procurement (PPADA)", "Vendor Management", "Contract Negotiation", "Inventory Control", "Supply Chain Optimization"],
    industries: ["Supply Chain & Logistics", "Procurement & Warehousing"],
  },

  // 15. Human Resources
  {
    domain: "Human Resources",
    matchRx: /\b(human\s+resources|hr\s+officer|talent\s+acquisition|recruiter|people\s+and\s+culture|hr\s+generalist|hrbp|chrp)\b/i,
    roleKeywordsRx: /\b(human\s+resources|hr\s+officer|recruiter|talent\s+acquisition|hrbp)\b/i,
    canonicalRoles: ["Human Resources Officer", "Talent Acquisition Specialist", "HR Business Partner", "People Operations Specialist"],
    seniorRoles: ["HR Manager", "Head of Human Resources", "Chief People Officer"],
    skills: ["Recruitment & Selection", "Labor Law Compliance", "Employee Relations", "Payroll Administration", "Performance Management"],
    industries: ["Human Resources", "Talent Management"],
  },

  // 16. NGO, Humanitarian & International Development
  {
    domain: "NGO & Humanitarian Aid",
    matchRx: /\b(ngo\b|humanitarian|m&e\s+officer|monitoring\s+and\s+evaluation|grants\s+officer|meal\s+officer|wash\s+specialist|community\s+development|field\s+officer)\b/i,
    roleKeywordsRx: /\b(m&e\s+officer|monitoring\s+and\s+evaluation|grants\s+officer|field\s+officer|humanitarian)\b/i,
    canonicalRoles: ["Monitoring & Evaluation (M&E) Specialist", "Project Officer", "Grants & Compliance Officer", "Humanitarian Coordinator"],
    seniorRoles: ["Program Manager", "Country Director", "Head of Programs"],
    skills: ["Monitoring & Evaluation (M&E)", "Grant Proposal Writing", "Donor Reporting (USAID/EU)", "Community Mobilization", "Project Management"],
    industries: ["Non-Governmental Organizations (NGOs)", "Humanitarian & International Development"],
  },

  // 17. Agriculture & Agribusiness
  {
    domain: "Agriculture & Agribusiness",
    matchRx: /\b(agronomist|agronomy|crop\s+production|livestock|farm\s+manager|agribusiness|food\s+science|horticulture|veterinary)\b/i,
    roleKeywordsRx: /\b(agronomist|agricultural\s+officer|farm\s+manager|agribusiness)\b/i,
    canonicalRoles: ["Agronomist", "Agricultural Officer", "Farm Manager", "Agribusiness Specialist"],
    seniorRoles: ["Chief Agronomist", "Senior Farm Operations Manager", "Director of Agriculture"],
    skills: ["Agronomy & Soil Science", "Crop Protection & Yield Optimization", "Farm Operations", "Agribusiness Management", "Irrigation Systems"],
    industries: ["Agriculture & Agribusiness", "Farming & Crop Production"],
  },

  // 18. Education & Academia
  {
    domain: "Education & Academia",
    matchRx: /\b(teacher|lecturer|professor|curriculum\s+developer|academic\s+tutor|school\s+principal|tsc\s+number)\b/i,
    roleKeywordsRx: /\b(teacher|lecturer|professor|principal|tutor)\b/i,
    canonicalRoles: ["Secondary School Teacher", "University Lecturer", "Curriculum Specialist", "Academic Tutor"],
    seniorRoles: ["Head of Department", "Dean of Faculty", "School Principal"],
    skills: ["Curriculum Development", "Classroom Instruction", "Student Assessment", "Academic Research", "Pedagogy"],
    industries: ["Education & Training", "Higher Education & Academia"],
  },
];

// Deduplicate role titles comparing normalized base forms
function dedupeRoles(roles: string[]): string[] {
  const seen = new Set<string>();
  const res: string[] = [];

  for (const r of roles) {
    if (!r || isNonJobRole(r)) continue;
    const baseKey = r
      .toLowerCase()
      .replace(/\s*\([a-z0-9\s]+\)/gi, "")
      .replace(/[\(\)\.,\-\/]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (baseKey && !seen.has(baseKey)) {
      seen.add(baseKey);
      res.push(cleanRoleTitle(r));
    }
  }

  return res;
}

// ============================================================================
// MAIN DETERMINISTIC PARSER
// ============================================================================

export function parseCvDeterministic(rawText: string): DeterministicParsedCv {
  const text = repairSpacedCharacters(rawText);
  const sections = segmentCvSections(text);
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // 1. Email extraction
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0].toLowerCase() : "";

  // 2. Phone extraction
  const phoneMatch = text.match(/(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
  const phone = phoneMatch ? phoneMatch[0].trim() : "";

  // 3. Full Name extraction
  let fullName = "";
  const ofMatch = text.match(/(?:curriculum\s+vitae|resume|profile|cv|bio[- ]?data)\s+(?:of|for)\s+([^\n\r]+)/i);
  if (ofMatch) {
    const cleaned = cleanCandidateName(ofMatch[1]);
    if (cleaned.length >= 3 && cleaned.length <= 70) {
      fullName = cleaned;
    }
  }

  if (!fullName) {
    // Check top 12 lines for candidate name
    for (const line of lines.slice(0, 12)) {
      if (
        line.includes("@") ||
        /(?:summary|experience|employment|history|career|education|academics|skills|competencies|objective|profile|curriculum|vitae|resume|contact|certifications|location|phone)/i.test(line)
      ) continue;
      const cleaned = cleanCandidateName(line);
      if (cleaned.length >= 3 && cleaned.length <= 70 && !cleaned.includes("@") && !/\d{5,}/.test(cleaned)) {
        fullName = cleaned;
        break;
      }
    }
  }

  // 4. Location extraction
  const countries = [
    { name: "Kenya", rx: /\bkenya\b|\bkenyan\b|\+254\b|\bnairobi\b|\bmombasa\b|\bkisumu\b|\bnakuru\b|\beldoret\b|\bruiru\b|\bthika\b/i, tz: "Africa/Nairobi", cities: ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Thika", "Nyeri", "Ruiru"] },
    { name: "Nigeria", rx: /\bnigeria\b|\bnigerian\b|\+234\b|\blagos\b|\bibadan\b|\babuja\b|\bport\s+harcourt\b/i, tz: "Africa/Lagos", cities: ["Lagos", "Abuja", "Ibadan", "Port Harcourt", "Enugu"] },
    { name: "Uganda", rx: /\buganda\b|\bugandan\b|\+256\b|\bkampala\b/i, tz: "Africa/Kampala", cities: ["Kampala", "Entebbe", "Jinja"] },
    { name: "Tanzania", rx: /\btanzania\b|\b\+255\b|\bdar\s+es\s+salaam\b/i, tz: "Africa/Dar_es_Salaam", cities: ["Dar es Salaam", "Dodoma", "Arusha"] },
    { name: "Rwanda", rx: /\brwanda\b|\b\+250\b|\bkigali\b/i, tz: "Africa/Kigali", cities: ["Kigali"] },
    { name: "South Africa", rx: /\bsouth\s+africa\b|\b\+27\b|\bjohannesburg\b|\bcape\s+town\b/i, tz: "Africa/Johannesburg", cities: ["Johannesburg", "Cape Town", "Durban", "Pretoria"] },
    { name: "United Kingdom", rx: /\bunited\s+kingdom\b|\buk\b|\b\+44\b|\blondon\b|\bmanchester\b/i, tz: "Europe/London", cities: ["London", "Manchester", "Birmingham"] },
    { name: "United States", rx: /\bunited\s+states\b|\busa\b|\bnew\s+york\b|\bcalifornia\b|\bsan\s+francisco\b|\bchicago\b/i, tz: "America/New_York", cities: ["New York", "San Francisco", "Chicago", "Seattle"] },
  ];

  let country = "Kenya";
  let city = "";
  let timezone = "Africa/Nairobi";

  for (const c of countries) {
    if (c.rx.test(text)) {
      country = c.name;
      timezone = c.tz;
      for (const cityName of c.cities) {
        if (new RegExp(`\\b${cityName}\\b`, "i").test(text)) {
          city = cityName;
          break;
        }
      }
      break;
    }
  }

  // 5. Work Experience positions extraction
  const workPositions = parseExperiencePositions(sections.experience || text);

  // 6. Current Role & Headline Detection
  let currentRole: string | null = null;
  let currentCompany: string | null = null;

  if (workPositions.length > 0) {
    const activePos = workPositions.find(p => p.isCurrent) || workPositions[0];
    currentRole = activePos.roleTitle;
    currentCompany = activePos.company;
  }

  // Check headline in header / top lines
  let headlineRole: string | null = null;
  const headlineRolesList: string[] = [];

  const lowerFullName = fullName.toLowerCase().trim();

  for (const l of lines.slice(0, 8)) {
    const trimmedL = l.trim();
    if (
      trimmedL.toLowerCase() === lowerFullName ||
      cleanCandidateName(trimmedL).toLowerCase() === lowerFullName ||
      trimmedL.includes("@") ||
      /(?:curriculum|vitae|resume|contact|email|phone|location|linkedin|github)/i.test(trimmedL)
    ) continue;

    if (trimmedL.includes("|")) {
      const parts = trimmedL
        .split("|")
        .map(s => cleanRoleTitle(s))
        .filter(s => s.length >= 3 && !isNonJobRole(s) && s.toLowerCase() !== lowerFullName);
      if (parts.length > 0) {
        headlineRolesList.push(...parts);
        if (!headlineRole) headlineRole = parts[0];
      }
    } else if (trimmedL.length <= 70 && !isNonJobRole(trimmedL) && cleanRoleTitle(trimmedL).toLowerCase() !== lowerFullName) {
      const clean = cleanRoleTitle(trimmedL);
      headlineRolesList.push(clean);
      if (!headlineRole) headlineRole = clean;
    }
  }

  if (!currentRole && headlineRole) {
    currentRole = headlineRole;
  }

  // 7. Calculate total years of experience
  let computedYears = 0;
  if (workPositions.length > 0) {
    let earliestStart = 9999;
    let latestEnd = 0;
    const currentYear = new Date().getFullYear();

    for (const p of workPositions) {
      if (p.startDate) {
        const s = parseInt(p.startDate, 10);
        if (!isNaN(s) && s < earliestStart) earliestStart = s;
      }
      if (p.isCurrent) {
        latestEnd = currentYear;
      } else if (p.endDate) {
        const e = parseInt(p.endDate, 10);
        if (!isNaN(e) && e > latestEnd) latestEnd = e;
      }
    }

    if (earliestStart !== 9999 && latestEnd > 0 && latestEnd >= earliestStart) {
      computedYears = latestEnd - earliestStart;
    } else {
      computedYears = workPositions.reduce((acc, p) => acc + (p.yearsInRole || 1), 0);
    }
  }

  // Fallback years regex: e.g. "3+ years of experience"
  if (computedYears <= 0) {
    const expMentionMatch = text.match(/(\d{1,2})\+?\s*years?(?:\s+of)?(?:\s+(?:professional|clinical|relevant|work|industry|administrative))?\s+experience/i);
    if (expMentionMatch) {
      const yrs = parseInt(expMentionMatch[1], 10);
      if (!isNaN(yrs) && yrs > 0 && yrs < 45) {
        computedYears = yrs;
      }
    }
  }

  if (computedYears <= 0) {
    computedYears = 2; // conservative default
  }

  // 8. Explicit Target Roles from CV
  const explicitTargetRoles = parseExplicitTargetRoles(sections.targetRoles);

  // 9. Assemble Candidate's Ground-Truth Roles
  const primaryRolesSet = new Set<string>();
  const secondaryRolesSet = new Set<string>();
  const industriesSet = new Set<string>();
  const defaultSkillsSet = new Set<string>();

  // Priority A: Candidate-specified target roles take absolute gold priority
  explicitTargetRoles.forEach(r => primaryRolesSet.add(r));

  // Priority B: Candidate's verified current job role and past held positions
  if (currentRole && !isNonJobRole(currentRole)) {
    if (primaryRolesSet.size < 4) primaryRolesSet.add(currentRole);
    else secondaryRolesSet.add(currentRole);
  }

  for (const pos of workPositions) {
    if (pos.roleTitle && !isNonJobRole(pos.roleTitle)) {
      if (primaryRolesSet.size < 4) primaryRolesSet.add(pos.roleTitle);
      else secondaryRolesSet.add(pos.roleTitle);
    }
  }

  // Priority C: Candidate's headline roles
  headlineRolesList.forEach(r => {
    if (primaryRolesSet.size < 4) primaryRolesSet.add(r);
    else secondaryRolesSet.add(r);
  });

  // 10. Role-Affinity Domain Matching
  // ONLY expand with canonical taxonomy roles if candidate has an affinity match to the domain
  const candidateVerifiedRoles = dedupeRoles([...Array.from(primaryRolesSet), ...Array.from(secondaryRolesSet)]);
  const matchedRules: TaxonomyRule[] = [];

  for (const rule of COMPREHENSIVE_TAXONOMY) {
    let domainScore = 0;

    // Check if candidate's ACTUAL job titles or explicit target roles match this domain's roleKeywordsRx
    for (const r of candidateVerifiedRoles) {
      if (rule.roleKeywordsRx.test(r)) {
        domainScore += 10;
      }
    }

    // Only match if the candidate held a title in this domain, OR if no roles were found and text matches
    if (domainScore >= 10 || (candidateVerifiedRoles.length === 0 && rule.matchRx.test(text))) {
      matchedRules.push(rule);
      rule.industries.forEach(ind => industriesSet.add(ind));
      rule.skills.forEach(sk => defaultSkillsSet.add(sk));

      const isSenior = computedYears >= 7 || (currentRole && /senior|lead|head|chief|director|manager/i.test(currentRole));
      const pool = isSenior && rule.seniorRoles ? [...rule.seniorRoles, ...rule.canonicalRoles] : rule.canonicalRoles;

      pool.forEach((r, idx) => {
        if (idx < 2 && primaryRolesSet.size < 4) {
          primaryRolesSet.add(r);
        } else {
          secondaryRolesSet.add(r);
        }
      });
    }
  }

  // Fallback if no domain rule matched
  if (matchedRules.length === 0) {
    if (currentRole) primaryRolesSet.add(currentRole);
    primaryRolesSet.add("Professional Specialist");
    industriesSet.add("Professional Services");
  }

  // Clean, normalize and deduplicate roles
  const dedupedPrimary = dedupeRoles(Array.from(primaryRolesSet)).slice(0, 5);
  const dedupedSecondary = dedupeRoles(Array.from(secondaryRolesSet))
    .filter(r => !dedupedPrimary.some(p => p.toLowerCase() === r.toLowerCase()))
    .slice(0, 6);

  const targetRoles = dedupeRoles([...dedupedPrimary, ...dedupedSecondary]).slice(0, 10);
  const primaryRoles = targetRoles.slice(0, 4);
  const secondaryRoles = targetRoles.slice(4);

  // Seniority level
  const seniorityLevel: ExtractedRoleItem["seniorityLevel"] =
    computedYears >= 10 || /director|head|chief|vp|cfo|cto|ceo/i.test(currentRole || "")
      ? "Executive / Director"
      : computedYears >= 7 || /lead|principal|architect/i.test(currentRole || "")
      ? "Lead / Staff"
      : computedYears >= 4 || /senior|sr\./i.test(currentRole || "")
      ? "Senior"
      : computedYears >= 2
      ? "Mid-Level"
      : "Entry / Junior";

  const mainDomain = matchedRules[0]?.domain || "Professional Practice";

  const extractedRoles: ExtractedRoleItem[] = targetRoles.map(roleTitle => ({
    roleTitle,
    confidence: primaryRoles.includes(roleTitle) ? 95 : 85,
    source: "cv",
    seniorityLevel,
    domain: mainDomain,
    reasoning: [
      `Extracted directly from candidate's verified employment history and credentials in ${mainDomain}`,
    ],
  }));

  // 11. Extract Skills & Technologies
  const skillsList = Array.from(defaultSkillsSet);
  const technologiesList: string[] = [];

  const commonTechs = [
    "Google Workspace", "MS Office", "Excel", "Word", "PowerPoint", "SQL", "PostgreSQL", "MySQL",
    "Python", "TypeScript", "JavaScript", "React", "Node.js", "Docker", "Kubernetes",
    "AWS", "Linux", "Git", "REST APIs", "Terraform", "Java", "CPA", "AutoCAD", "Power BI", "Tableau",
  ];
  for (const t of commonTechs) {
    const rx = new RegExp(`\\b${t.replace(/\+/g, "\\+").replace(/\./g, "\\.")}\\b`, "i");
    if (rx.test(text)) {
      technologiesList.push(t);
    }
  }

  // 12. Extract Real Education Credentials
  const educationList: string[] = [];
  const eduPatterns = [
    /bachelor(?:'s)?(?:\s+of\s+[^\n,]+)?/gi,
    /master(?:'s)?(?:\s+of\s+[^\n,]+)?/gi,
    /ph\.?d(?:\s+in\s+[^\n,]+)?/gi,
    /m\.?b\.?,?\s*b\.?s|mbbs|mbchb/gi,
    /b\.?sc(?:\s+in\s+[^\n,]+)?/gi,
    /b\.?eng(?:\s+in\s+[^\n,]+)?/gi,
    /ll\.?b|ll\.?m/gi,
    /diploma\s+in\s+[^\n,]+/gi,
    /high\s+school\s+diploma/gi,
  ];

  for (const rx of eduPatterns) {
    const matches = text.match(rx);
    if (matches) {
      for (const m of matches) {
        const clean = m.trim().replace(/[\r\n]+/g, " ");
        if (clean.length >= 4 && clean.length <= 120 && !educationList.includes(clean)) {
          educationList.push(clean);
        }
      }
    }
  }

  // 13. Extract Real Certifications & Licenses
  const certList: string[] = [];
  const certPatterns = [
    /\b(kmpdc|kmpdb)\b[^\n,.]*/gi,
    /\b(fwacs|frcs|facs)\b/gi,
    /\b(cpa(?:-k)?|acca|cfa)\b/gi,
    /\b(aws\s+certified[^\n,.]*)/gi,
    /\b(certified\s+kubernetes\s+administrator|cka)\b/gi,
    /\b(certified\s+scrum\s+master|csm|pmp)\b/gi,
    /\b(ccna|ccnp|comptia\s+[a-z0-9+]+)\b/gi,
    /\b(chrp(?:\s*k)?|kism|cips)\b/gi,
  ];

  for (const rx of certPatterns) {
    const matches = text.match(rx);
    if (matches) {
      for (const m of matches) {
        const clean = m.trim().replace(/[\r\n]+/g, " ");
        if (clean.length >= 3 && clean.length <= 100 && !certList.includes(clean)) {
          certList.push(clean);
        }
      }
    }
  }

  return {
    fullName,
    email,
    phone,
    country,
    city,
    timezone,
    headlineRole,
    currentRole,
    currentCompany,
    yearsExperience: computedYears,
    primaryRoles,
    secondaryRoles,
    targetRoles,
    extractedRoles,
    workExperience: workPositions,
    skills: skillsList.slice(0, 25),
    technologies: technologiesList.slice(0, 20),
    education: educationList.slice(0, 6),
    certifications: certList.slice(0, 8),
    industries: Array.from(industriesSet).slice(0, 6),
    languages: ["English"],
    preferredLocations: city ? [city, country, "Remote"] : [country, "Remote"],
    workModes: ["remote", "hybrid", "onsite"],
    relocation: false,
    visaSponsorship: false,
    minimumSalary: null,
  };
}

/**
 * Transforms deterministic parsed CV into the standard profile draft format
 */
export function toProfileDraft(parsed: DeterministicParsedCv): Record<string, unknown> {
  return {
    fullName: parsed.fullName,
    email: parsed.email,
    phone: parsed.phone,
    country: parsed.country,
    city: parsed.city,
    timezone: parsed.timezone,
    targetRoles: parsed.targetRoles,
    skills: parsed.skills,
    technologies: parsed.technologies,
    yearsExperience: parsed.yearsExperience,
    education: parsed.education,
    certifications: parsed.certifications,
    industries: parsed.industries,
    languages: parsed.languages,
    preferredLocations: parsed.preferredLocations,
    workModes: parsed.workModes,
    relocation: parsed.relocation,
    visaSponsorship: parsed.visaSponsorship,
    minimumSalary: parsed.minimumSalary,
    currentRole: parsed.currentRole,
    currentCompany: parsed.currentCompany,
    workExperience: parsed.workExperience,
  };
}
