import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts", "api-server", "package.json"));
const Database = require("better-sqlite3");

const dbPath = path.join(root, "storage", "data", "ai-job-agent.sqlite");
const db = new Database(dbPath);

// Ensure columns exist
const cols = db.prepare("PRAGMA table_info(jobs)").all().map(c => c.name);
if (!cols.includes("rejection_reason")) {
  db.exec("ALTER TABLE jobs ADD COLUMN rejection_reason text");
}
if (!cols.includes("match_reason")) {
  db.exec("ALTER TABLE jobs ADD COLUMN match_reason text");
}

// Pre-ingestion regexes matching pre-ingestion-gate.ts
const EXECUTIVE_REGEX = /\b(chief\s+technology\s+officer|cto|cio|ciso|chief\s+executive|ceo|coo|cfo|director\b|vice\s+president|vp\b|head\s+of\b|general\s+manager|managing\s+director|executive\s+director|partner\b)\b/i;
const OFF_FAMILY_PROFESSIONS_REGEX = /\b(oncology|pharmacist|pharmacy|doctor|physician|nurse|nursing|veterin|tierarzt|dental|dentist|surgeon|attorney|lawyer|legal\s+counsel|paralegal|accountant|accounts\s+payable|auditor|audit\s+associate|fp&a|wealth\s+management|payroll\s+assistant|real\s+estate|property\s+manager|horeca|kundenservice|telefondienst|school\s+teacher|tutor|category\s+buyer|merchandiser|logistics\s+coordinator|procurement\s+officer|storekeeper|receptionist|front\s+desk|driver|chauffeur|chef|cook|barista|waiter|waitress|security\s+guard|caretaker|cleaner|housekeeper|cashier)\b/i;
const FOREIGN_RESIDENCY_LOCK_REGEX = /\b(must\s+(?:currently\s+)?reside\s+in\s+(?:the\s+)?(?:us|usa|united\s+states|uk|united\s+kingdom|eu|europe|canada|australia|germany|france)|us\s+citizens\s+only|us\s+residents\s+only|authorized\s+to\s+work\s+in\s+the\s+us\s+without\s+sponsorship|w2\s+only|c2c\s+only|us\s+only\b|usa\s+only\b|uk\s+only\b|eu\s+only\b|canada\s+only\b)\b/i;
const SENIOR_LEVEL_REGEX = /\b(senior\b|sr\.?\b|staff\s+(?:engineer|developer)|principal\b|lead\s+(?:developer|engineer|architect)|architect\b|expert\b|tier\s?(?:iii|3)\b|level\s?3\b|l3\b)\b/i;
const JUNIOR_ROLE_INDICATORS = /\b(junior|jr\.?|entry[- ]level|associate|trainee|apprentice|intern(?:ship)?|graduate|tier\s?(?:i|1)\b|level\s?1\b|l1\b|assistant|technician)\b/i;

const TECH_DOMAIN_KEYWORDS = [
  "software", "developer", "engineer", "web", "frontend", "front-end", "backend", "back-end",
  "full stack", "fullstack", "react", "node", "javascript", "typescript", "python",
  "it support", "support technician", "ict officer", "ict assistant", "ict support",
  "help desk", "helpdesk", "service desk", "desktop support", "technical support",
  "network", "systems", "system administrator", "sysadmin", "database", "sql", "linux", "windows",
  "cisco", "lan", "wan", "devops", "cloud", "qa", "quality assurance", "test engineer", "automation",
  "data analyst", "security", "cybersecurity",
];

function extractMinYears(text) {
  const match = text.match(/(?:minimum|at\s+least|require[ds]?|must\s+have)\s+(\d{1,2})\+?\s*(?:-\s*\d{1,2})?\s*years?/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

function classifyJob(title, desc, location, company) {
  const text = `${title} ${desc} ${company} ${location}`.toLowerCase();
  
  if (EXECUTIVE_REGEX.test(title)) {
    return `Executive / Director level role: "${title}" is excluded from candidate's junior career profile.`;
  }
  if (OFF_FAMILY_PROFESSIONS_REGEX.test(title)) {
    return `Off-family profession: "${title}" is outside candidate's IT / Software development field.`;
  }
  if (FOREIGN_RESIDENCY_LOCK_REGEX.test(text)) {
    return `Location restriction: Job strictly requires foreign country residency/authorization where candidate cannot work.`;
  }
  const minYears = extractMinYears(text);
  if (minYears !== null && minYears > 2) {
    return `Experience ceiling exceeded: Requires ${minYears}+ years experience (candidate has 1 year verified experience).`;
  }
  if (SENIOR_LEVEL_REGEX.test(title) && !JUNIOR_ROLE_INDICATORS.test(title)) {
    return `Seniority mismatch: Senior / Lead position "${title}" exceeds candidate's entry/junior qualifications.`;
  }
  
  const hasTechKeyword = TECH_DOMAIN_KEYWORDS.some(k => text.includes(k));
  if (!hasTechKeyword) {
    return `Unrelated domain: No matching IT Support, Systems Administration, or Software Development skills identified.`;
  }

  return `Legacy ingestion: Scored below match threshold by initial matching engine.`;
}

const jobs = db.prepare("SELECT id, title, company, location, remote, description, status, rejection_reason FROM jobs").all();
console.log(`Evaluating ${jobs.length} jobs...`);

const updateStmt = db.prepare("UPDATE jobs SET rejection_reason = ? WHERE id = ?");

let updated = 0;
const reasonCounts = {};

const updateTx = db.transaction(() => {
  for (const job of jobs) {
    if (job.status === "REJECTED") {
      const reason = classifyJob(job.title, job.description || "", job.location || "", job.company || "");
      updateStmt.run(reason, job.id);
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      updated++;
    }
  }
});

updateTx();

console.log(`\nUpdated ${updated} rejected jobs with explicit reasons.`);
console.log("\nRejection Breakdown:");
for (const [r, count] of Object.entries(reasonCounts)) {
  console.log(`  [${count} jobs] ${r}`);
}

const statusCounts = db.prepare("SELECT status, count(*) as count FROM jobs GROUP BY status").all();
console.log("\nFinal Status counts:", statusCounts);

db.close();
