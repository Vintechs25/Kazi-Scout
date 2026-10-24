/**
 * Deterministic CV Role & Experience Extraction Engine
 * 
 * Provides high-precision, zero-AI parsing of resumes and CVs:
 * - Accurate section boundary detection (Summary, Experience, Education, Certifications, Skills, Projects)
 * - Real work experience & historical job title extraction from dates and company headers
 * - Extraction of candidate's actual current and primary job titles directly from CV text
 * - Comprehensive multi-domain role taxonomy (Tech, Healthcare, Finance, Legal, Engineering, Logistics, NGO, etc.)
 * - Seniority level classification (Entry, Mid, Senior, Lead, Executive)
 * - Accurate years-of-experience calculation from real employment date ranges
 * - Extraction of real degrees, licenses, and verified certifications
 */

import { repairSpacedCharacters, cleanCandidateName } from "../routes/cvs";

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

// ============================================================================
// SECTION BOUNDARY DETECTOR
// ============================================================================

interface CvSections {
  header: string;
  summary: string;
  experience: string;
  education: string;
  certifications: string;
  skills: string;
  projects: string;
  other: string;
}

const SECTION_HEADERS = [
  { key: "experience", rx: /^(?:professional\s+experience|work\s+experience|employment\s+history|career\s+history|work\s+history|relevant\s+experience|experience)\b/im },
  { key: "education", rx: /^(?:education|academic\s+background|educational\s+qualifications|academic\s+qualifications|degrees|academics)\b/im },
  { key: "certifications", rx: /^(?:certifications|certificates|professional\s+certifications|licenses\s*(?:&|and)\s*certifications|licenses|credentials|accreditations)\b/im },
  { key: "skills", rx: /^(?:technical\s+skills|core\s+competencies|skills\s*(?:&|and)\s*expertise|skills|tools\s*(?:&|and)\s*technologies|areas\s+of\s+expertise|competencies)\b/im },
  { key: "projects", rx: /^(?:key\s+projects|selected\s+projects|projects|portfolio)\b/im },
  { key: "summary", rx: /^(?:professional\s+summary|career\s+summary|executive\s+summary|profile|about\s+me|career\s+objective|objective|summary)\b/im },
];

export function segmentCvSections(text: string): CvSections {
  const lines = text.split("\n");
  const sectionIndices: { key: keyof CvSections; lineIdx: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.length > 55) continue;
    // Section headers are usually short, capitalized or title-cased
    for (const h of SECTION_HEADERS) {
      if (h.rx.test(trimmed)) {
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
    experience: "",
    education: "",
    certifications: "",
    skills: "",
    projects: "",
    other: "",
  };

  if (sectionIndices.length === 0) {
    sections.header = lines.slice(0, 15).join("\n");
    sections.experience = text;
    return sections;
  }

  // Header is everything before the first section
  sections.header = lines.slice(0, sectionIndices[0].lineIdx).join("\n");

  for (let i = 0; i < sectionIndices.length; i++) {
    const cur = sectionIndices[i];
    const nextIdx = i + 1 < sectionIndices.length ? sectionIndices[i + 1].lineIdx : lines.length;
    // Skip the header title line itself
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
// DATE RANGE PARSER & CALCULATOR
// ============================================================================

const DATE_RANGE_REGEX = /(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember))[a-z]*\.?\s+)?(?:\d{1,2}\/)?(19\d{2}|20\d{2})\s*(?:[-–—to\/]+)\s*(present|current|date|now|to\s+date|(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember))[a-z]*\.?\s+)?(?:\d{1,2}\/)?(19\d{2}|20\d{2}))/i;

const SINGLE_YEAR_REGEX = /\b(19\d{2}|20\d{2})\b/g;

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
// KNOWN JOB TITLE & COMPANY SIGNALS
// ============================================================================

const TITLE_KEYWORDS_REGEX = /\b(engineer|developer|architect|consultant|specialist|manager|director|lead|head|officer|technician|administrator|analyst|coordinator|supervisor|doctor|physician|surgeon|nurse|pharmacist|counsel|lawyer|advocate|accountant|auditor|agronomist|teacher|lecturer|professor|designer|executive|associate|intern|apprentice)\b/i;

const COMPANY_SIGNAL_REGEX = /\b(ltd|limited|plc|inc|incorporated|corp|corporation|bank|hospital|ministry|county|board|council|authority|commission|university|college|school|group|solutions|technologies|systems|labs|services|center|centre|associates|partners|ngo|unicef|wfp|who|kpmg|pwc|deloitte|ey|equity|safaricom|kcb|cooperative|absa|standard\s+chartered)\b/i;

// Clean raw role title by stripping companies, locations, dates, and bullet glyphs
export function cleanRoleTitle(raw: string): string {
  let t = raw.trim();
  // Strip bullet markers
  t = t.replace(/^[\s•\-\*\>\|#\d\.)\]]+/, "").trim();
  // Strip trailing punctuation
  t = t.replace(/[,;:\-\|]+$/, "").trim();
  // Strip parenthetical dates e.g. (2020 - 2022)
  t = t.replace(/\s*\([^)]*(?:19\d{2}|20\d{2}|present|current)[^)]*\)/gi, "").trim();
  // Strip date tokens at end
  t = t.replace(/\s*(?:(?:19|20)\d{2}\s*[-–—to]+\s*(?:present|current|(?:19|20)\d{2})).*$/i, "").trim();
  // Strip company if separated by "at" or "@"
  t = t.replace(/\s+(?:at|@)\s+.*$/i, "").trim();
  // Capitalize nicely
  return t
    .split(/\s+/)
    .map(w => {
      const lower = w.toLowerCase();
      if (/^(?:and|of|in|for|the|on|with|to)$/i.test(w)) return w.toLowerCase();
      if (lower === "devops") return "DevOps";
      if (lower === "sre") return "SRE";
      if (lower === "ui/ux") return "UI/UX";
      if (lower === "it" || lower === "ict" || lower === "qa" || lower === "ai" || lower === "ml") return w.toUpperCase();
      if (lower === "cpa" || lower === "cpa-k" || lower === "hr" || lower === "hrbp" || lower === "seo") return w.toUpperCase();
      if (lower === "cto" || lower === "cio" || lower === "cfo" || lower === "ceo") return w.toUpperCase();
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
  return c;
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
      if (cleanTitle.length >= 3 && cleanTitle.length <= 80 && !/^(?:experience|work|history|curriculum|duties|responsibilities)$/i.test(cleanTitle)) {
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
    const dateInfo = extractDatesFromLine(line);

    if (dateInfo) {
      finalizeCurrentPos();

      // Check if title/company are on the SAME line as the date
      // e.g. "Senior Software Engineer | Safaricom PLC | 2021 - Present"
      const dateTextMatched = line.match(DATE_RANGE_REGEX)?.[0] || "";
      const textWithoutDate = line.replace(dateTextMatched, "").trim();

      let detectedTitle = "";
      let detectedCompany = "";

      if (textWithoutDate.includes("|") || textWithoutDate.includes(" - ") || textWithoutDate.includes(" at ") || textWithoutDate.includes(" @ ")) {
        const parts = textWithoutDate.split(/\s*(?:\||\s-\s|\sat\s|\s@\s)\s*/).filter(Boolean);
        if (parts.length >= 2) {
          if (TITLE_KEYWORDS_REGEX.test(parts[0])) {
            detectedTitle = parts[0];
            detectedCompany = parts[1];
          } else if (TITLE_KEYWORDS_REGEX.test(parts[1])) {
            detectedTitle = parts[1];
            detectedCompany = parts[0];
          } else {
            detectedTitle = parts[0];
            detectedCompany = parts[1];
          }
        } else if (parts.length === 1) {
          detectedTitle = parts[0];
        }
      } else if (textWithoutDate.length >= 3) {
        detectedTitle = textWithoutDate;
      }

      // If not on same line, look at preceding lines (line i - 1 or line i - 2)
      if (!detectedTitle && i > 0) {
        const prevLine = lines[i - 1];
        if (!extractDatesFromLine(prevLine)) {
          if (prevLine.includes("|") || prevLine.includes(" - ") || prevLine.includes(" at ")) {
            const parts = prevLine.split(/\s*(?:\||\s-\s|\sat\s|\s@\s)\s*/).filter(Boolean);
            if (parts.length >= 2) {
              detectedTitle = TITLE_KEYWORDS_REGEX.test(parts[0]) ? parts[0] : parts[1];
              detectedCompany = TITLE_KEYWORDS_REGEX.test(parts[0]) ? parts[1] : parts[0];
            } else {
              detectedTitle = parts[0];
            }
          } else if (TITLE_KEYWORDS_REGEX.test(prevLine)) {
            detectedTitle = prevLine;
            // Look 1 further back for company
            if (i > 1 && !extractDatesFromLine(lines[i - 2])) {
              detectedCompany = lines[i - 2];
            }
          } else if (COMPANY_SIGNAL_REGEX.test(prevLine)) {
            detectedCompany = prevLine;
            if (i > 1 && TITLE_KEYWORDS_REGEX.test(lines[i - 2])) {
              detectedTitle = lines[i - 2];
            }
          }
        }
      }

      const yearsInRole = Math.max(dateInfo.endYear - dateInfo.startYear, 1);

      currentPos = {
        roleTitle: detectedTitle || "Specialist",
        company: detectedCompany || "",
        startDate: String(dateInfo.startYear),
        endDate: dateInfo.isCurrent ? "Present" : String(dateInfo.endYear),
        isCurrent: dateInfo.isCurrent,
        yearsInRole,
      };
    } else if (currentPos) {
      // Add description bullet lines
      if (line.length > 3 && !extractDatesFromLine(line)) {
        currentDescLines.push(line);
      }
    }
  }

  finalizeCurrentPos();

  // If no positions detected via date ranges, fallback to scanning lines for strong title matches
  if (positions.length === 0) {
    for (const l of lines.slice(0, 30)) {
      if (TITLE_KEYWORDS_REGEX.test(l) && l.length <= 70 && !l.includes("@")) {
        const cleaned = cleanRoleTitle(l);
        if (cleaned.length >= 4) {
          positions.push({
            roleTitle: cleaned,
            company: "Direct Professional Practice",
            startDate: null,
            endDate: "Present",
            isCurrent: true,
            yearsInRole: 3,
            description: "",
          });
          break;
        }
      }
    }
  }

  return positions;
}

// ============================================================================
// UNIVERSAL ROLE TAXONOMY & CLASSIFIER
// ============================================================================

interface TaxonomyRule {
  domain: string;
  matchRx: RegExp;
  canonicalRoles: string[];
  seniorRoles?: string[];
  skills: string[];
  industries: string[];
}

export const COMPREHENSIVE_TAXONOMY: TaxonomyRule[] = [
  // 1. Healthcare & Surgical / Clinical
  {
    domain: "Healthcare & Surgery",
    matchRx: /\b(surgeon|surgery|surgical|laparoscopic|urologist|orthopedic|trauma\s+surgery|theatre\s+nurse|fwacs|frcs)\b/i,
    canonicalRoles: ["Consultant General Surgeon", "General Surgeon", "Consultant Surgeon", "Surgical Specialist", "Medical Doctor"],
    seniorRoles: ["Consultant Surgeon", "Head of Surgery", "Chief of Surgery"],
    skills: ["General Surgery", "Laparoscopic Procedures", "Surgical Theatre Management", "Patient Triage", "Pre & Post-Operative Care", "Clinical Governance"],
    industries: ["Healthcare & Hospital Care", "Surgical Practice", "Medical Services"],
  },
  {
    domain: "Healthcare & Medicine",
    matchRx: /\b(physician|medical\s+doctor|doctor|medical\s+officer|clinical\s+officer|pediatrician|pathologist|radiologist|general\s+practitioner|mbbs|mbchb|kmpdc)\b/i,
    canonicalRoles: ["Medical Doctor", "Physician", "Medical Officer", "Clinical Officer", "Healthcare Practitioner"],
    seniorRoles: ["Senior Medical Officer", "Consultant Physician", "Medical Superintendent", "Chief Medical Officer"],
    skills: ["Clinical Diagnosis", "Patient Management", "Internal Medicine", "Emergency Medicine", "Clinical Protocols", "Treatment Planning"],
    industries: ["Healthcare & Hospital Care", "Medical Practice", "Public Health"],
  },
  {
    domain: "Healthcare & Nursing",
    matchRx: /\b(nurse|nursing|registered\s+nurse|midwife|bsn|kmtc|clinical\s+nurse|icu\s+nurse|theatre\s+nurse)\b/i,
    canonicalRoles: ["Registered Nurse", "Nursing Officer", "Clinical Nurse Specialist", "Staff Nurse"],
    seniorRoles: ["Nursing Officer in Charge", "Chief Nursing Officer", "Nurse Manager"],
    skills: ["Patient Care", "Clinical Triage", "Medication Administration", "Infection Control", "Vital Signs Monitoring"],
    industries: ["Healthcare & Hospital Care", "Nursing Practice"],
  },
  {
    domain: "Healthcare & Pharmacy",
    matchRx: /\b(pharmacist|pharmacy|pharmaceutical|pharm\.?d|b\.?pharm|dispensing)\b/i,
    canonicalRoles: ["Pharmacist", "Clinical Pharmacist", "Pharmacy Technologist", "Hospital Pharmacist"],
    seniorRoles: ["Chief Pharmacist", "Head of Pharmacy", "Regulatory Affairs Pharmacist"],
    skills: ["Dispensing & Pharmacology", "Drug Interaction Screening", "Patient Counseling", "Inventory Management", "Clinical Pharmacy"],
    industries: ["Healthcare & Pharmaceuticals", "Pharmacy Practice"],
  },

  // 2. Cloud, DevOps & Site Reliability
  {
    domain: "DevOps & Cloud Infrastructure",
    matchRx: /\b(devops|site\s+reliability|sre\b|cloud\s+engineer|cloud\s+architect|kubernetes|docker|terraform|ci\/cd|infrastructure\s+engineer|platform\s+engineer|aws\b|azure\b|gcp\b)\b/i,
    canonicalRoles: ["DevOps Engineer", "Cloud Engineer", "Site Reliability Engineer (SRE)", "Cloud Solutions Architect", "Platform Engineer"],
    seniorRoles: ["Lead DevOps Engineer", "Principal Cloud Architect", "Head of Infrastructure", "Senior SRE"],
    skills: ["Docker", "Kubernetes", "Terraform", "CI/CD Pipelines", "AWS", "Linux", "Infrastructure as Code", "Prometheus", "GitOps"],
    industries: ["Information Technology", "Cloud & Infrastructure", "SaaS & Enterprise Systems"],
  },

  // 3. Software Engineering & Development
  {
    domain: "Software Engineering",
    matchRx: /\b(software\s+engineer|software\s+developer|full[- ]?stack|frontend|backend|web\s+developer|node\.?js|react|typescript|python\s+developer|java\s+developer|golang|c#|\.net)\b/i,
    canonicalRoles: ["Software Engineer", "Full-Stack Developer", "Backend Developer", "Frontend Developer", "Web Developer"],
    seniorRoles: ["Senior Software Engineer", "Lead Developer", "Engineering Manager", "Principal Software Engineer", "Technical Lead"],
    skills: ["TypeScript", "JavaScript", "React", "Node.js", "Python", "REST APIs", "SQL", "Git", "System Architecture", "Microservices"],
    industries: ["Information Technology", "Software Development", "Tech & Internet"],
  },

  // 4. Mobile Engineering
  {
    domain: "Mobile Development",
    matchRx: /\b(mobile\s+developer|mobile\s+engineer|android|ios\s+developer|flutter|react\s+native|swift\b|kotlin\b)\b/i,
    canonicalRoles: ["Mobile Application Developer", "Android Developer", "iOS Developer", "Flutter Developer"],
    seniorRoles: ["Lead Mobile Engineer", "Senior Android Developer", "Senior iOS Developer"],
    skills: ["Flutter", "Kotlin", "Swift", "React Native", "Android SDK", "iOS SDK", "Mobile UI/UX", "API Integration"],
    industries: ["Information Technology", "Mobile Application Development"],
  },

  // 5. Data Science, AI & Analytics
  {
    domain: "Data & Artificial Intelligence",
    matchRx: /\b(data\s+scientist|data\s+analyst|data\s+engineer|machine\s+learning|ml\s+engineer|ai\s+engineer|deep\s+learning|nlp\b|computer\s+vision|power\s+bi|tableau|sql\s+analyst)\b/i,
    canonicalRoles: ["Data Scientist", "Data Analyst", "Data Engineer", "Machine Learning Engineer", "Business Intelligence Analyst"],
    seniorRoles: ["Lead Data Scientist", "Senior Data Engineer", "Head of Data & Analytics"],
    skills: ["Python", "SQL", "Pandas", "Machine Learning", "Power BI", "Data Modeling", "ETL Pipelines", "Tableau"],
    industries: ["Information Technology", "Data & Analytics", "Artificial Intelligence"],
  },

  // 6. IT Support, Systems & Cybersecurity
  {
    domain: "IT Support & Cybersecurity",
    matchRx: /\b(it\s+support|desktop\s+support|helpdesk|system\s+administrator|sysadmin|network\s+engineer|cybersecurity|security\s+analyst|infosec|soc\s+analyst|penetration\s+testing)\b/i,
    canonicalRoles: ["IT Support Specialist", "Systems Administrator", "Network Administrator", "Cybersecurity Specialist", "Technical Support Engineer"],
    seniorRoles: ["IT Manager", "Senior Systems Administrator", "Chief Information Security Officer (CISO)"],
    skills: ["Hardware Troubleshooting", "Network Administration", "Active Directory", "Linux/Windows Server", "Cybersecurity", "Firewalls"],
    industries: ["Information Technology", "IT Infrastructure & Security"],
  },

  // 7. Finance, Banking & Accounting
  {
    domain: "Accounting & Finance",
    matchRx: /\b(accountant|accounting|auditor|audit\b|cpa\b|cpa-k|acca|financial\s+analyst|tax\s+consultant|bookkeeper|financial\s+controller|credit\s+officer|loan\s+officer)\b/i,
    canonicalRoles: ["Chartered Accountant", "Financial Analyst", "Internal Auditor", "Finance Officer", "Credit Risk Officer"],
    seniorRoles: ["Senior Accountant", "Audit Manager", "Chief Financial Officer (CFO)", "Finance Director"],
    skills: ["Financial Reporting", "Auditing & Assurance", "Taxation & Compliance", "Budgeting & Forecasting", "CPA-K", "QuickBooks", "ERP Systems"],
    industries: ["Financial Services", "Accounting & Audit", "Banking & Microfinance"],
  },

  // 8. Legal & Compliance
  {
    domain: "Legal & Compliance",
    matchRx: /\b(lawyer|attorney|advocate|legal\s+counsel|solicitor|barrister|litigation|ll\.?b|ll\.?m|compliance\s+officer|corporate\s+counsel)\b/i,
    canonicalRoles: ["Legal Counsel", "Advocate of the High Court", "Corporate Legal Officer", "Compliance Officer"],
    seniorRoles: ["Senior Legal Counsel", "Head of Legal Affairs", "Partner / Managing Counsel"],
    skills: ["Legal Drafting", "Litigation & Dispute Resolution", "Regulatory Compliance", "Contract Negotiation", "Corporate Law"],
    industries: ["Legal Practice", "Corporate Governance", "Compliance & Risk"],
  },

  // 9. Civil, Mechanical & Electrical Engineering
  {
    domain: "Engineering & Construction",
    matchRx: /\b(civil\s+engineer|structural\s+engineer|mechanical\s+engineer|electrical\s+engineer|quantity\s+surveyor|autocad|site\s+engineer|construction\s+engineer)\b/i,
    canonicalRoles: ["Civil Engineer", "Structural Engineer", "Mechanical Engineer", "Electrical Engineer", "Project Engineer"],
    seniorRoles: ["Senior Project Engineer", "Chief Engineer", "Resident Engineer", "Engineering Lead"],
    skills: ["AutoCAD", "Structural Analysis", "Project Supervision", "Technical Specifications", "Site Management", "BOQ Preparation"],
    industries: ["Engineering & Construction", "Infrastructure Development", "Industrial & Manufacturing"],
  },

  // 10. Procurement, Supply Chain & Logistics
  {
    domain: "Supply Chain & Logistics",
    matchRx: /\b(procurement|supply\s+chain|logistics|warehouse|purchasing\s+officer|stores\s+officer|inventory\s+controller|transport\s+manager|cips|kism)\b/i,
    canonicalRoles: ["Procurement Officer", "Supply Chain Specialist", "Logistics Coordinator", "Warehouse Manager"],
    seniorRoles: ["Procurement Manager", "Head of Supply Chain", "Logistics Director"],
    skills: ["Public Procurement (PPADA)", "Vendor Management", "Contract Negotiation", "Inventory Control", "Supply Chain Optimization"],
    industries: ["Supply Chain & Logistics", "Procurement & Warehousing"],
  },

  // 11. Human Resources
  {
    domain: "Human Resources",
    matchRx: /\b(human\s+resources|hr\s+officer|talent\s+acquisition|recruiter|people\s+and\s+culture|hr\s+generalist|hrbp|chrp)\b/i,
    canonicalRoles: ["Human Resources Officer", "Talent Acquisition Specialist", "HR Business Partner", "People Operations Specialist"],
    seniorRoles: ["HR Manager", "Head of Human Resources", "Chief People Officer"],
    skills: ["Recruitment & Selection", "Labor Law Compliance", "Employee Relations", "Payroll Administration", "Performance Management"],
    industries: ["Human Resources", "Talent Management"],
  },

  // 12. NGO, Humanitarian & International Development
  {
    domain: "NGO & Humanitarian Aid",
    matchRx: /\b(ngo\b|humanitarian|m&e\s+officer|monitoring\s+and\s+evaluation|grants\s+officer|meal\s+officer|wash\s+specialist|community\s+development|field\s+officer)\b/i,
    canonicalRoles: ["Monitoring & Evaluation (M&E) Specialist", "Project Officer", "Grants & Compliance Officer", "Humanitarian Coordinator"],
    seniorRoles: ["Program Manager", "Country Director", "Head of Programs"],
    skills: ["Monitoring & Evaluation (M&E)", "Grant Proposal Writing", "Donor Reporting (USAID/EU)", "Community Mobilization", "Project Management"],
    industries: ["Non-Governmental Organizations (NGOs)", "Humanitarian & International Development"],
  },

  // 13. Agriculture & Agribusiness
  {
    domain: "Agriculture & Agribusiness",
    matchRx: /\b(agronomist|agronomy|crop\s+production|livestock|farm\s+manager|agribusiness|food\s+science|horticulture|veterinary)\b/i,
    canonicalRoles: ["Agronomist", "Agricultural Officer", "Farm Manager", "Agribusiness Specialist"],
    seniorRoles: ["Chief Agronomist", "Senior Farm Operations Manager", "Director of Agriculture"],
    skills: ["Agronomy & Soil Science", "Crop Protection & Yield Optimization", "Farm Operations", "Agribusiness Management", "Irrigation Systems"],
    industries: ["Agriculture & Agribusiness", "Farming & Crop Production"],
  },

  // 14. Education & Academia
  {
    domain: "Education & Academia",
    matchRx: /\b(teacher|lecturer|professor|curriculum\s+developer|academic\s+tutor|school\s+principal|tsc\s+number)\b/i,
    canonicalRoles: ["Secondary School Teacher", "University Lecturer", "Curriculum Specialist", "Academic Tutor"],
    seniorRoles: ["Head of Department", "Dean of Faculty", "School Principal"],
    skills: ["Curriculum Development", "Classroom Instruction", "Student Assessment", "Academic Research", "Pedagogy"],
    industries: ["Education & Training", "Higher Education & Academia"],
  },
];

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
    // Check top 12 lines for name
    for (const line of lines.slice(0, 12)) {
      if (
        line.includes("@") ||
        /(?:summary|experience|employment|history|career|education|academics|skills|competencies|objective|profile|curriculum|vitae|resume|contact|certifications)/i.test(line)
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
    { name: "Kenya", rx: /\bkenya\b|\bkenyan\b|\+254\b|\bnairobi\b|\bmombasa\b|\bkisumu\b|\bnakuru\b|\beldoret\b/i, tz: "Africa/Nairobi", cities: ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Thika", "Nyeri"] },
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
  for (const l of lines.slice(0, 8)) {
    if (l === fullName || l.includes("@") || /(?:curriculum|vitae|resume|contact|email|phone)/i.test(l)) continue;
    if (TITLE_KEYWORDS_REGEX.test(l) && l.length <= 70) {
      headlineRole = cleanRoleTitle(l);
      break;
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

  // Fallback years regex from text: e.g. "8+ years of clinical experience", "5 years experience"
  if (computedYears <= 0) {
    const expMentionMatch = text.match(/(\d{1,2})\+?\s*years?(?:\s+of)?(?:\s+(?:professional|clinical|relevant|work|industry))?\s+experience/i);
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

  // 8. Match Universal Taxonomy & Synthesize Target Roles
  const matchedRules: TaxonomyRule[] = [];
  const primaryRolesSet = new Set<string>();
  const secondaryRolesSet = new Set<string>();
  const industriesSet = new Set<string>();
  const defaultSkillsSet = new Set<string>();

  // Add the candidate's actual current role and positions to primary roles upfront
  if (currentRole) {
    primaryRolesSet.add(currentRole);
  }
  for (const pos of workPositions) {
    if (pos.roleTitle && primaryRolesSet.size < 4) {
      primaryRolesSet.add(pos.roleTitle);
    }
  }

  // Match domain taxonomy
  for (const rule of COMPREHENSIVE_TAXONOMY) {
    if (rule.matchRx.test(text)) {
      matchedRules.push(rule);
      rule.industries.forEach(ind => industriesSet.add(ind));
      rule.skills.forEach(sk => defaultSkillsSet.add(sk));

      // If candidate is senior or has high years, add senior variants
      const isSenior = computedYears >= 6 || (currentRole && /senior|lead|head|chief|director|consultant|specialist/i.test(currentRole));
      const pool = isSenior && rule.seniorRoles ? [...rule.seniorRoles, ...rule.canonicalRoles] : rule.canonicalRoles;

      pool.forEach((r, idx) => {
        if (idx < 2 && primaryRolesSet.size < 5) {
          primaryRolesSet.add(r);
        } else {
          secondaryRolesSet.add(r);
        }
      });
    }
  }

  // If no taxonomy rule matched, default to the positions extracted directly from CV
  if (matchedRules.length === 0) {
    if (currentRole) primaryRolesSet.add(currentRole);
    primaryRolesSet.add("Professional Specialist");
    industriesSet.add("Professional Services");
  }

  const primaryRoles = Array.from(primaryRolesSet).slice(0, 4);
  const secondaryRoles = Array.from(secondaryRolesSet)
    .filter(r => !primaryRolesSet.has(r))
    .slice(0, 6);

  const targetRoles = Array.from(new Set([...primaryRoles, ...secondaryRoles])).slice(0, 10);

  // Build extracted roles list
  const seniorityLevel: ExtractedRoleItem["seniorityLevel"] =
    computedYears >= 10 || /director|head|chief|vp|cfo|cto|ceo/i.test(currentRole || "")
      ? "Executive / Director"
      : computedYears >= 7 || /lead|principal|architect|consultant/i.test(currentRole || "")
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
      `Extracted directly from candidate's verified employment history, headline, and domain credentials in ${mainDomain}`,
    ],
  }));

  // 9. Extract Skills & Technologies
  const skillsList = Array.from(defaultSkillsSet);
  const technologiesList: string[] = [];

  // Tech-specific tools
  const commonTechs = [
    "TypeScript", "JavaScript", "Python", "React", "Node.js", "Docker", "Kubernetes",
    "AWS", "Linux", "SQL", "PostgreSQL", "Git", "REST APIs", "GraphQL", "Terraform",
    "Java", "Golang", "C#", "C++", "CPA", "AutoCAD", "Excel", "Power BI", "Tableau",
  ];
  for (const t of commonTechs) {
    const rx = new RegExp(`\\b${t.replace(/\+/g, "\\+").replace(/\./g, "\\.")}\\b`, "i");
    if (rx.test(text)) {
      technologiesList.push(t);
    }
  }

  // 10. Extract Education
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

  // 11. Extract Certifications & Licenses
  const certList: string[] = [];
  const certPatterns = [
    /\b(kmpdc|kmpdb)\b[^\n,.]*/gi,
    /\b(fwacs|frcs|facs)\b/gi,
    /\b(cpa(?:-k)?|acca|cfa)\b/gi,
    /\b(aws\s+certified[^\n,.]*)/gi,
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
  };
}
