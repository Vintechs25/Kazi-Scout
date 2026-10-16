/**
 * Description Section Parser & Domain Skills Dictionary
 * Accurately parses Job Requirements vs Responsibilities and normalizes IT/Developer skills
 */

export interface ParsedJobSections {
  requirementsText: string;
  responsibilitiesText: string;
  aboutText: string;
  minYearsRequired: number | null;
  educationRequired: "none" | "certificate" | "diploma" | "degree" | "unknown";
  requiredSkills: string[];
}

// 500+ Skill Dictionary with Normalized Synonyms for Kenyan & Remote Tech Roles
export const COMPREHENSIVE_SKILL_SYNONYMS: Record<string, string> = {
  // Frontend
  "react": "react",
  "reactjs": "react",
  "react.js": "react",
  "react native": "react_native",
  "nextjs": "nextjs",
  "next.js": "nextjs",
  "vite": "vite",
  "vue": "vue",
  "vuejs": "vue",
  "vue.js": "vue",
  "angular": "angular",
  "angularjs": "angular",
  "typescript": "typescript",
  "ts": "typescript",
  "javascript": "javascript",
  "js": "javascript",
  "html": "html",
  "html5": "html",
  "css": "css",
  "css3": "css",
  "tailwind": "tailwindcss",
  "tailwindcss": "tailwindcss",
  "bootstrap": "bootstrap",
  "sass": "sass",
  "redux": "redux",
  "zustand": "zustand",

  // Backend & Databases
  "node": "nodejs",
  "nodejs": "nodejs",
  "node.js": "nodejs",
  "express": "express",
  "expressjs": "express",
  "python": "python",
  "django": "django",
  "flask": "flask",
  "fastapi": "fastapi",
  "sql": "sql",
  "postgresql": "postgresql",
  "postgres": "postgresql",
  "psql": "postgresql",
  "mysql": "mysql",
  "sqlite": "sqlite",
  "supabase": "supabase",
  "mongodb": "mongodb",
  "mongo": "mongodb",
  "redis": "redis",
  "rest": "rest_api",
  "rest api": "rest_api",
  "rest apis": "rest_api",
  "restful": "rest_api",
  "graphql": "graphql",

  // IT Support, Networking & Infrastructure
  "it support": "it_support",
  "help desk": "it_support",
  "helpdesk": "it_support",
  "service desk": "it_support",
  "desktop support": "it_support",
  "technical support": "it_support",
  "ict support": "it_support",
  "lan": "networking",
  "wan": "networking",
  "lan/wan": "networking",
  "wlan": "networking",
  "wi-fi": "networking",
  "wifi": "networking",
  "tcp/ip": "networking",
  "dns": "networking",
  "dhcp": "networking",
  "vpn": "networking",
  "cisco": "cisco",
  "cisco packet tracer": "cisco",
  "ccna": "ccna",
  "mikrotik": "networking",
  "router": "networking",
  "switch": "networking",
  "firewall": "networking",
  "pfsense": "networking",
  "active directory": "active_directory",
  "ad": "active_directory",
  "azure ad": "active_directory",
  "entra id": "active_directory",
  "group policy": "active_directory",
  "gpo": "active_directory",
  "office 365": "office_365",
  "microsoft 365": "office_365",
  "m365": "office_365",
  "windows server": "windows_server",
  "windows": "windows",
  "windows 10": "windows",
  "windows 11": "windows",
  "linux": "linux",
  "ubuntu": "linux",
  "debian": "linux",
  "centos": "linux",
  "redhat": "linux",
  "troubleshooting": "troubleshooting",
  "hardware repair": "hardware",
  "computer maintenance": "hardware",
  "printer setup": "hardware",
  "cctv": "cctv",
  "itil": "itil",
  "sla": "itil",

  // DevOps & Tooling
  "git": "git",
  "github": "git",
  "gitlab": "git",
  "docker": "docker",
  "postman": "postman",
  "bash": "shell_scripting",
  "shell": "shell_scripting",
  "shell scripting": "shell_scripting",
  "powershell": "shell_scripting",
  "automation": "automation",
  "ci/cd": "cicd",
  "cybersecurity": "cybersecurity",
  "security": "cybersecurity",
  "qa": "qa_testing",
  "testing": "qa_testing",
  "cypress": "qa_testing",
  "selenium": "qa_testing",

  // Healthcare & Medicine
  "general surgery": "surgery",
  "surgical": "surgery",
  "clinical governance": "clinical_governance",
  "patient care": "patient_care",
  "pre operative": "pre_op_care",
  "post operative": "post_op_care",
  "trauma management": "trauma_management",
  "emergency care": "emergency_care",
  "triage": "triage",
  "pharmacology": "pharmacology",
  "nursing": "nursing",
  "phlebotomy": "phlebotomy",
  "vital signs": "vital_signs",

  // Finance, Accounting & Audit
  "financial reporting": "financial_reporting",
  "audit": "audit",
  "auditing": "audit",
  "tax compliance": "taxation",
  "taxation": "taxation",
  "budgeting": "budgeting",
  "forecasting": "forecasting",
  "financial modeling": "financial_modeling",
  "quickbooks": "quickbooks",
  "sage": "sage",
  "cpa": "cpa",
  "acca": "acca",
  "ifrs": "ifrs",
  "general ledger": "general_ledger",

  // Legal & Compliance
  "litigation": "litigation",
  "legal drafting": "legal_drafting",
  "contract negotiation": "contract_negotiation",
  "regulatory compliance": "compliance",
  "due diligence": "due_diligence",
  "arbitration": "arbitration",
  "dispute resolution": "dispute_resolution",

  // Engineering & Construction
  "structural design": "structural_design",
  "autocad": "autocad",
  "site supervision": "site_supervision",
  "project management": "project_management",
  "plc": "plc_systems",
  "circuit design": "circuit_design",
  "power distribution": "power_distribution",
  "hvac": "hvac",
  "cad": "cad",
  "cam": "cam",

  // Operations, Administration & Education
  "operations management": "operations",
  "supply chain": "supply_chain",
  "procurement": "procurement",
  "stakeholder management": "stakeholder_management",
  "team leadership": "leadership",
  "curriculum development": "curriculum_development",
  "human resources": "human_resources",
  "recruitment": "recruitment",
};

export function normalizeSkillToken(raw: string): string {
  const clean = raw.toLowerCase().trim().replace(/[-_]/g, " ");
  return COMPREHENSIVE_SKILL_SYNONYMS[clean] || COMPREHENSIVE_SKILL_SYNONYMS[clean.replace(/\s+/g, "")] || clean;
}

/**
 * Split job HTML/text into functional sections
 */
export function splitJobSections(rawText: string): {
  requirements: string;
  responsibilities: string;
  about: string;
} {
  const lines = rawText.split("\n");
  let currentSection: "about" | "responsibilities" | "requirements" = "about";
  const reqLines: string[] = [];
  const respLines: string[] = [];
  const aboutLines: string[] = [];

  const reqHeaders = /^(requirements|qualifications|what you'?ll need|who you are|candidate profile|skills & experience|key competencies|requirements & skills|what we are looking for|minimum qualifications|desired skills)/i;
  const respHeaders = /^(responsibilities|what you'?ll do|duties|key tasks|scope of work|role overview|core responsibilities)/i;
  const aboutHeaders = /^(about us|about the company|who we are|company overview|benefits|what we offer|perks)/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (reqHeaders.test(trimmed)) {
      currentSection = "requirements";
      continue;
    } else if (respHeaders.test(trimmed)) {
      currentSection = "responsibilities";
      continue;
    } else if (aboutHeaders.test(trimmed)) {
      currentSection = "about";
      continue;
    }

    if (currentSection === "requirements") {
      reqLines.push(trimmed);
    } else if (currentSection === "responsibilities") {
      respLines.push(trimmed);
    } else {
      aboutLines.push(trimmed);
    }
  }

  // If no explicit section headers were found, treat entire body as requirements+responsibilities
  const requirements = reqLines.length > 0 ? reqLines.join("\n") : rawText;
  const responsibilities = respLines.join("\n");
  const about = aboutLines.join("\n");

  return { requirements, responsibilities, about };
}

export function extractContextualYears(text: string): number | null {
  const re = /(?:require[sd]?|minimum|at least)?\s*(\d+)\s*(?:\+|-|–|to)?\s*(\d+)?\s*\+?\s*(?:years?|yrs?)(?:[^.]{0,40}?(?:experience|exp|background|practical|working))?/gi;
  const hits: number[] = [];
  for (const m of text.matchAll(re)) {
    const ctx = text.slice(Math.max(0, (m.index || 0) - 40), (m.index || 0) + m[0].length + 40).toLowerCase();
    if (/experience|background|working|professional|hands-on/.test(ctx)) {
      hits.push(Number(m[1]));
    }
  }
  return hits.length > 0 ? Math.min(...hits) : null;
}

export function extractEducationRequirement(text: string): "none" | "certificate" | "diploma" | "degree" | "unknown" {
  const lower = text.toLowerCase();
  if (/\b(bachelor|master|bsc|degree|phd)\b/i.test(lower)) {
    return "degree";
  }
  if (/\b(diploma|hnd|higher diploma)\b/i.test(lower)) {
    return "diploma";
  }
  if (/\b(certificate|cert|kcse|k\.c\.s\.e)\b/i.test(lower)) {
    return "certificate";
  }
  return "unknown";
}

export function extractSkillsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const matched = new Set<string>();

  for (const [rawKey, normalizedKey] of Object.entries(COMPREHENSIVE_SKILL_SYNONYMS)) {
    const pattern = new RegExp(`\\b${rawKey.replace(/[-_]/g, "[\\s_-]?")}\\b`, "i");
    if (pattern.test(lower)) {
      matched.add(normalizedKey);
    }
  }

  return Array.from(matched);
}
