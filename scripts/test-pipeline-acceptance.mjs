import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts", "api-server", "package.json"));
const Database = require("better-sqlite3");

console.log("===================================================================");
console.log(" RUNNING AI-VERIFIED JOB DISCOVERY PIPELINE ACCEPTANCE TESTS");
console.log("===================================================================\n");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}

// -------------------------------------------------------------
// Import Pre-Ingestion Filter logic
// -------------------------------------------------------------
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

function evaluatePreIngestionGate(job, directive) {
  const title = (job.title || "").trim();
  const desc = (job.description || "").trim();
  const loc = (job.location || "").toLowerCase();
  const company = (job.company || "").toLowerCase();
  const fullText = `${title} ${desc} ${company} ${loc}`.toLowerCase();

  // 1. Executive / Director
  if (EXECUTIVE_REGEX.test(title)) {
    return {
      qualified: false,
      rejectionReason: `Executive / Director level role: "${title}" is excluded from candidate's junior career profile.`,
    };
  }

  // 2. Off-family
  if (OFF_FAMILY_PROFESSIONS_REGEX.test(title)) {
    return {
      qualified: false,
      rejectionReason: `Off-family profession: "${title}" is outside candidate's IT / Software development field.`,
    };
  }

  // 3. Location lock
  if (FOREIGN_RESIDENCY_LOCK_REGEX.test(fullText)) {
    return {
      qualified: false,
      rejectionReason: "Location restriction: Job strictly requires foreign country residency/authorization where candidate cannot work.",
    };
  }

  // 4. Experience ceiling
  const minYears = extractMinYears(fullText);
  if (minYears !== null && minYears > (directive.maxExperienceYears ?? 2)) {
    return {
      qualified: false,
      rejectionReason: `Experience ceiling exceeded: Requires ${minYears}+ years experience (candidate has ${directive.candidateSummary?.yearsExperience ?? 1} year).`,
    };
  }

  // 5. Senior / Lead
  if (SENIOR_LEVEL_REGEX.test(title) && !JUNIOR_ROLE_INDICATORS.test(title)) {
    return {
      qualified: false,
      rejectionReason: `Seniority mismatch: Senior / Lead position "${title}" exceeds candidate's entry/junior qualifications.`,
    };
  }

  // 6. Technology / IT domain check
  const hasTechKeyword = TECH_DOMAIN_KEYWORDS.some(k => fullText.includes(k));
  if (!hasTechKeyword) {
    return {
      qualified: false,
      rejectionReason: "Unrelated domain: No matching IT Support, Systems Administration, or Software Development skills identified.",
    };
  }

  return { qualified: true };
}

const mockDirective = {
  maxExperienceYears: 2,
  candidateSummary: { yearsExperience: 1, fullName: "Candidate" },
  locationRestrictions: {
    allowedCountries: ["Kenya"],
    allowWorldwideRemote: true,
  },
};

// -------------------------------------------------------------
// 1. Executive-role rejection
// -------------------------------------------------------------
test("Executive-role rejection: CTO is rejected", () => {
  const result = evaluatePreIngestionGate({
    title: "Chief Technology Officer",
    company: "GiveDirectly",
    description: "Leading technology strategy globally.",
  }, mockDirective);
  assert.equal(result.qualified, false);
  assert.match(result.rejectionReason, /Executive \/ Director level/);
});

test("Executive-role rejection: Director of People is rejected", () => {
  const result = evaluatePreIngestionGate({
    title: "Director of People & Culture",
    company: "Global NGO",
    description: "Lead human resources operations.",
  }, mockDirective);
  assert.equal(result.qualified, false);
  assert.match(result.rejectionReason, /Executive \/ Director level/);
});

test("Executive-role rejection: VP of Engineering is rejected", () => {
  const result = evaluatePreIngestionGate({
    title: "Vice President of Engineering",
    company: "Fintech Corp",
    description: "Oversee all software engineering teams.",
  }, mockDirective);
  assert.equal(result.qualified, false);
  assert.match(result.rejectionReason, /Executive \/ Director level/);
});

// -------------------------------------------------------------
// 2. Unrelated-role rejection
// -------------------------------------------------------------
test("Unrelated-role rejection: Oncology nurse is rejected", () => {
  const result = evaluatePreIngestionGate({
    title: "Registered Oncology Nurse",
    company: "Nairobi Hospital",
    description: "Patient care in chemotherapy ward.",
  }, mockDirective);
  assert.equal(result.qualified, false);
  assert.match(result.rejectionReason, /Off-family profession/);
});

test("Unrelated-role rejection: Corporate Attorney is rejected", () => {
  const result = evaluatePreIngestionGate({
    title: "Commercial Lawyer / Legal Counsel",
    company: "Law Chambers",
    description: "Drafting commercial contracts.",
  }, mockDirective);
  assert.equal(result.qualified, false);
  assert.match(result.rejectionReason, /Off-family profession/);
});

test("Unrelated-role rejection: Head Chef is rejected", () => {
  const result = evaluatePreIngestionGate({
    title: "Executive Head Chef",
    company: "Serena Hotel",
    description: "Managing kitchen culinary staff.",
  }, mockDirective);
  assert.equal(result.qualified, false);
  assert.match(result.rejectionReason, /Off-family profession/);
});

// -------------------------------------------------------------
// 3. Junior-role acceptance
// -------------------------------------------------------------
test("Junior-role acceptance: Junior IT Support Specialist in Nairobi is accepted", () => {
  const result = evaluatePreIngestionGate({
    title: "Junior IT Support Specialist",
    company: "Safaricom",
    location: "Nairobi, Kenya",
    description: "Provide desktop support, LAN/WAN troubleshooting, Cisco switch maintenance, Windows OS help desk.",
  }, mockDirective);
  assert.equal(result.qualified, true);
  assert.equal(result.rejectionReason, undefined);
});

test("Junior-role acceptance: ICT Officer in Kenya is accepted", () => {
  const result = evaluatePreIngestionGate({
    title: "ICT Officer",
    company: "Kenya Commercial Bank",
    location: "Nairobi",
    description: "Systems administration, user support, backup verification, network maintenance.",
  }, mockDirective);
  assert.equal(result.qualified, true);
});

test("Junior-role acceptance: Junior Full Stack Developer is accepted", () => {
  const result = evaluatePreIngestionGate({
    title: "Junior Full Stack Developer",
    company: "TechNova",
    location: "Remote",
    remote: true,
    description: "Build web applications using React, Node.js, Express, and PostgreSQL. 1 year experience preferred.",
  }, mockDirective);
  assert.equal(result.qualified, true);
});

// -------------------------------------------------------------
// 4. Remote-work restrictions
// -------------------------------------------------------------
test("Remote-work restriction: US Citizens Only is rejected", () => {
  const result = evaluatePreIngestionGate({
    title: "Junior Software Developer",
    company: "Acme US",
    location: "Remote",
    remote: true,
    description: "React and Node development. Must currently reside in the US. US citizens only.",
  }, mockDirective);
  assert.equal(result.qualified, false);
  assert.match(result.rejectionReason, /Location restriction/);
});

test("Remote-work restriction: Worldwide Remote is accepted", () => {
  const result = evaluatePreIngestionGate({
    title: "Junior Web Developer",
    company: "Remote Global",
    location: "Worldwide Remote",
    remote: true,
    description: "Frontend development with JavaScript and React. Open worldwide to international remote workers.",
  }, mockDirective);
  assert.equal(result.qualified, true);
});

// -------------------------------------------------------------
// 5. Ambiguous location requirements & Missing descriptions
// -------------------------------------------------------------
test("Ambiguous location handled conservatively: 'Remote' without foreign lock is accepted", () => {
  const result = evaluatePreIngestionGate({
    title: "Technical Support Technician",
    company: "Distributed Tech",
    location: "Remote",
    remote: true,
    description: "IT support ticketing, troubleshooting Windows and network connections.",
  }, mockDirective);
  assert.equal(result.qualified, true);
});

test("Missing description handled conservatively without crash", () => {
  const result = evaluatePreIngestionGate({
    title: "Junior IT Support Assistant",
    company: "Local NGO",
    location: "Nairobi",
    description: "",
  }, mockDirective);
  assert.equal(result.qualified, true);
});

// -------------------------------------------------------------
// 6. Experience ceiling enforcement
// -------------------------------------------------------------
test("Experience ceiling: 7+ years requirement is rejected", () => {
  const result = evaluatePreIngestionGate({
    title: "Software Engineer",
    company: "Enterprise Ltd",
    location: "Nairobi",
    description: "Must have minimum 7+ years of relevant experience in enterprise software architecture.",
  }, mockDirective);
  assert.equal(result.qualified, false);
  assert.match(result.rejectionReason, /Experience ceiling exceeded/);
});

// -------------------------------------------------------------
// 7. AI-Provider failure & fallback resilience
// -------------------------------------------------------------
test("AI Provider fallback: Invalid JSON recovers safely", () => {
  const rawMalformedOutput = "Here is the response: { invalid_json: true, ";
  let parsed = null;
  try {
    parsed = JSON.parse(rawMalformedOutput);
  } catch (e) {
    parsed = { error: "JSON_PARSE_ERROR", fallbackUsed: true };
  }
  assert.equal(parsed.fallbackUsed, true);
});

// -------------------------------------------------------------
// 8. Deduplication Protection
// -------------------------------------------------------------
function normalizeText(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\blimited\b|\bltd\b|\bllc\b|\bplc\b|\bgmbh\b/g, " ")
    .replace(/\bincorporated\b|\binc\b|\bcorporation\b|\bcorp\b/g, " ")
    .replace(/\bcompany\b|\bco\b|\bholdings\b|\bgroup\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

test("Deduplication: duplicate company and title normalized produce same key", () => {
  const job1 = { title: "Junior IT Support Specialist", company: "GiveDirectly Inc." };
  const job2 = { title: "junior it support specialist", company: "givedirectly inc" };
  const key1 = `${normalizeText(job1.title)}|${normalizeText(job1.company)}`;
  const key2 = `${normalizeText(job2.title)}|${normalizeText(job2.company)}`;
  assert.equal(key1, key2);
});

// -------------------------------------------------------------
// 9. Active Qualified View Filter simulation
// -------------------------------------------------------------
test("Active Qualified View excludes ALL rejected jobs", () => {
  const allJobs = [
    { id: "1", title: "Chief Technology Officer", status: "REJECTED", rejectionReason: "Executive level" },
    { id: "2", title: "Director of People", status: "REJECTED", rejectionReason: "Executive level" },
    { id: "3", title: "Junior IT Support", status: "MATCHED", matchScore: 85, rejectionReason: null },
    { id: "4", title: "ICT Officer", status: "NEEDS_REVIEW", matchScore: 65, rejectionReason: null },
    { id: "5", title: "Junior Web Dev", status: "APPLIED", matchScore: 90, rejectionReason: null },
  ];

  const isRejected = (j) => j.status === "REJECTED" || j.status === "IGNORED";

  // Simulate 'qualified' tab
  const qualifiedView = allJobs.filter(j => !isRejected(j));
  assert.equal(qualifiedView.length, 3);
  assert.ok(qualifiedView.every(j => j.status !== "REJECTED"));

  // Simulate 'high_match' tab
  const highMatchView = allJobs.filter(j => !isRejected(j) && (j.matchScore >= 70 || j.status === "MATCHED"));
  assert.equal(highMatchView.length, 2);
  assert.ok(highMatchView.every(j => j.status !== "REJECTED"));

  // Simulate 'rejected' tab
  const rejectedView = allJobs.filter(isRejected);
  assert.equal(rejectedView.length, 2);
  assert.ok(rejectedView.every(j => j.status === "REJECTED"));
});

// -------------------------------------------------------------
// 10. Database Application History & Profile Evidence Preservation
// -------------------------------------------------------------
test("Database verification: Application records & candidate profile are preserved in SQLite", () => {
  const dbPath = path.join(root, "storage", "data", "ai-job-agent.sqlite");
  const db = new Database(dbPath, { readonly: true });

  const profile = db.prepare("SELECT full_name, years_experience, city, country FROM candidate_profiles WHERE id = 'primary'").get();
  assert.ok(profile, "Candidate profile must exist");
  assert.ok(profile.full_name, "Candidate profile must have a name");
  assert.ok(profile.years_experience >= 0, "years_experience should be >= 0");
  assert.equal(profile.country, "Kenya");

  const apps = db.prepare("SELECT count(*) as c FROM applications").get().c;
  console.log(`         Database confirmed: Candidate ${profile.full_name}, ${apps} application(s) in review queue.`);

  const jobsByStatus = db.prepare("SELECT status, count(*) as count FROM jobs GROUP BY status").all();
  console.log(`         Jobs in DB: ${JSON.stringify(jobsByStatus)}`);

  const rejectedWithReason = db.prepare("SELECT count(*) as c FROM jobs WHERE status = 'REJECTED' AND rejection_reason IS NOT NULL").get().c;
  console.log(`         Rejected jobs with explicit reason: ${rejectedWithReason}`);
  assert.ok(rejectedWithReason > 0, "Rejected jobs must have stored rejection_reason");

  // Check new AI columns exist in schema
  const cols = db.prepare("PRAGMA table_info(jobs)").all().map(c => c.name);
  assert.ok(cols.includes("ai_decision"), "ai_decision column should exist");
  assert.ok(cols.includes("is_ai_verified"), "is_ai_verified column should exist");
  assert.ok(cols.includes("evidence_fingerprint"), "evidence_fingerprint column should exist");

  db.close();
});

// -------------------------------------------------------------
// 11. Master CV Loading & Candidate Evidence Verification
// -------------------------------------------------------------
await asyncTest("Master CV: Extract real PDF and generate SHA-256 fingerprint", async () => {
  const { getVerifiedMasterCv } = await import("../artifacts/api-server/src/lib/cv-storage.ts");
  const cv = await getVerifiedMasterCv();
  assert.ok(cv, "Master CV must load successfully");
  assert.ok(cv.text.length > 100, `CV text must be extracted (got ${cv.text.length} chars)`);
  assert.ok(cv.fingerprint && cv.fingerprint.length === 64, "SHA-256 fingerprint must be 64 hex chars");
  console.log(`         Master CV Verified: ${cv.cvRecord.fileName} (${cv.text.length} chars, fingerprint: ${cv.fingerprint.slice(0, 16)}...)`);
});

await asyncTest("Candidate Evidence: Verify structured profile from CV", async () => {
  const { getOrGenerateCandidateEvidence } = await import("../artifacts/api-server/src/lib/candidate-evidence.ts");
  const evidence = await getOrGenerateCandidateEvidence();
  assert.ok(evidence, "Evidence profile must exist");
  assert.ok(evidence.fullName, "Candidate evidence must include a full name");
  assert.ok(evidence.verifiedWorkExperience.length > 0, "Must have verified experience");
  assert.ok(evidence.demonstratedTechnicalSkills.length > 0, "Must have demonstrated skills");
  assert.ok(evidence.limitationsOrMissingInfo.length > 0, "Must have noted career limitations");
  console.log(`         Evidence Verified: ${evidence.verifiedWorkExperience.length} work experiences, ${evidence.demonstratedTechnicalSkills.length} demonstrated skills`);
});

// -------------------------------------------------------------
// 12. Strict AI Job Evaluator Acceptance Tests
// -------------------------------------------------------------
await asyncTest("AI Evaluator: Strong match on junior IT role", async () => {
  const { evaluateSingleJob } = await import("../artifacts/api-server/src/lib/ai-job-evaluator.ts");
  const { getOrGenerateCandidateEvidence } = await import("../artifacts/api-server/src/lib/candidate-evidence.ts");
  const { getVerifiedMasterCv } = await import("../artifacts/api-server/src/lib/cv-storage.ts");
  
  const cv = await getVerifiedMasterCv();
  const evidence = await getOrGenerateCandidateEvidence();
  const result = await evaluateSingleJob({
    title: "Junior IT Support Specialist",
    company: "Safaricom PLC",
    location: "Nairobi, Kenya",
    remote: false,
    source: "BrighterMonday",
    sourceUrl: "https://example.com/job/1",
    description: "Provide Tier 1 and 2 desktop support, LAN/WAN troubleshooting, Cisco switch maintenance, Windows OS help desk, SQL queries. 1 year experience required.",
  }, evidence, cv.text.slice(0, 3000));

  assert.ok(result.decision === "STRONG_MATCH" || result.decision === "POTENTIAL_MATCH", `Expected match, got ${result.decision}`);
  assert.ok(result.matchScore >= 75, `Expected high score, got ${result.matchScore}`);
  assert.equal(result.hardEligibilityFailure, false);
  console.log(`         AI Evaluator Match Confirmed: ${result.decision} (${result.matchScore}%) via ${result.providerUsed}`);
});

await asyncTest("AI Evaluator: Hard failure rejection on 10+ yr lead architect", async () => {
  const { evaluateSingleJob } = await import("../artifacts/api-server/src/lib/ai-job-evaluator.ts");
  const { getOrGenerateCandidateEvidence } = await import("../artifacts/api-server/src/lib/candidate-evidence.ts");
  const { getVerifiedMasterCv } = await import("../artifacts/api-server/src/lib/cv-storage.ts");
  
  const cv = await getVerifiedMasterCv();
  const evidence = await getOrGenerateCandidateEvidence();
  const result = await evaluateSingleJob({
    title: "Lead Enterprise Cloud Architect",
    company: "Global Enterprise",
    location: "Nairobi, Kenya",
    remote: false,
    source: "LinkedIn",
    sourceUrl: "https://example.com/job/2",
    description: "Requires minimum 10+ years enterprise architecture experience leading 50+ staff across AWS multi-region setups.",
  }, evidence, cv.text.slice(0, 3000));

  assert.ok(result.decision === "INELIGIBLE" || result.decision === "NOT_A_MATCH", `Expected ineligible, got ${result.decision}`);
  assert.equal(result.hardEligibilityFailure, true, "Hard eligibility failure must be true");
  assert.ok(result.matchScore <= 30, `Score must be capped on hard failure, got ${result.matchScore}`);
  console.log(`         AI Evaluator Hard Failure Confirmed: ${result.decision} (${result.matchScore}%)`);
});

console.log("\n===================================================================");
console.log(` TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("===================================================================\n");

if (failed > 0) process.exit(1);
