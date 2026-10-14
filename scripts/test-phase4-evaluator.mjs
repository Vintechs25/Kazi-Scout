import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { evaluateSingleJob } = await import(pathToFileURL(path.join(root, "artifacts", "api-server", "src", "lib", "ai-job-evaluator.ts")).href);
const { getOrGenerateCandidateEvidence } = await import(pathToFileURL(path.join(root, "artifacts", "api-server", "src", "lib", "candidate-evidence.ts")).href);
const { getVerifiedMasterCv } = await import(pathToFileURL(path.join(root, "artifacts", "api-server", "src", "lib", "cv-storage.ts")).href);

console.log("===================================================================");
console.log(" TESTING PHASE 4 & 5: STRICT AI JOB EVALUATOR WITH MASTER CV EVIDENCE");
console.log("===================================================================\n");

console.log("Loading verified Master CV and Candidate Evidence...");
const cv = await getVerifiedMasterCv();
const evidence = await getOrGenerateCandidateEvidence();
console.log(`Loaded candidate evidence for: ${evidence.fullName} (CV: ${cv.cvRecord.fileName})\n`);

const testJobs = [
  {
    name: "Junior IT Support Specialist in Nairobi (Expected STRONG_MATCH)",
    input: {
      title: "Junior IT Support Specialist",
      company: "Safaricom PLC",
      location: "Nairobi, Kenya",
      remote: false,
      source: "BrighterMonday",
      sourceUrl: "https://example.com/job/1",
      description: `We are looking for a Junior IT Support Specialist to join our technology team in Nairobi.
Responsibilities:
- Provide Tier 1 and Tier 2 desktop and hardware support
- Troubleshoot local area networks (LAN/WAN) and Cisco switches
- Administer user accounts in Windows Active Directory and Linux servers
- Assist with database backups and basic SQL queries (MySQL/PostgreSQL)
- Support hospital and enterprise internal software tools
Requirements:
- Diploma or Degree in Computer Science or related IT field
- 1 to 2 years of IT support experience
- CCNA or networking certification is an added advantage
- Strong diagnostic and troubleshooting skills`,
    },
    expectedDecisions: ["STRONG_MATCH", "POTENTIAL_MATCH"],
    expectedMaxScoreFloor: 70,
    expectedHardFailure: false,
  },
  {
    name: "Lead Enterprise Architect with 10+ yrs exp (Expected NOT_A_MATCH / INELIGIBLE)",
    input: {
      title: "Lead Enterprise Cloud Architect",
      company: "Global Cloud Corp",
      location: "Nairobi, Kenya",
      remote: false,
      source: "LinkedIn",
      sourceUrl: "https://example.com/job/2",
      description: `Requirements:
- Minimum 10+ years of enterprise software architecture experience
- Proven track record leading 50+ engineers
- Expert in Kubernetes cluster governance, AWS multi-region failover, and executive C-suite reporting.`,
    },
    expectedDecisions: ["NOT_A_MATCH", "INELIGIBLE"],
    expectedScoreCeiling: 45,
    expectedHardFailure: true,
  },
  {
    name: "Registered Oncology Nurse (Expected NOT_A_MATCH / INELIGIBLE)",
    input: {
      title: "Clinical Oncology Nurse",
      company: "Aga Khan University Hospital",
      location: "Nairobi, Kenya",
      remote: false,
      source: "Daily Nation",
      sourceUrl: "https://example.com/job/3",
      description: `Administer chemotherapy and monitor vital signs of patients in cancer treatment ward. Bachelor of Science in Nursing required.`,
    },
    expectedDecisions: ["NOT_A_MATCH", "INELIGIBLE"],
    expectedScoreCeiling: 25,
    expectedHardFailure: true,
  },
  {
    name: "US-Only Remote React Developer (Expected INELIGIBLE)",
    input: {
      title: "Junior Frontend React Developer",
      company: "US Silicon Valley Startup",
      location: "Remote - US Only",
      remote: true,
      source: "Indeed",
      sourceUrl: "https://example.com/job/4",
      description: `Looking for a junior React developer.
Must currently reside in the United States. US Citizens and Green Card holders only. We cannot sponsor foreign visas or work permits.`,
    },
    expectedDecisions: ["INELIGIBLE", "NOT_A_MATCH"],
    expectedScoreCeiling: 45,
    expectedHardFailure: true,
  },
];

let passes = 0;
let fails = 0;

for (const test of testJobs) {
  console.log(`Evaluating: ${test.name}`);
  const result = await evaluateSingleJob(test.input, evidence, cv.text.slice(0, 3000));

  console.log(` - Decision: ${result.decision}`);
  console.log(` - Match Score: ${result.matchScore}%`);
  console.log(` - AI Provider/Model: ${result.providerUsed} (${result.modelUsed})`);
  console.log(` - Hard Eligibility Failure: ${result.hardEligibilityFailure}`);
  console.log(` - Matched Skills: ${result.matchedSkills.join(", ") || "None"}`);
  console.log(` - Missing Skills: ${result.missingSkills.join(", ") || "None"}`);
  console.log(` - Explanation: ${result.explanation.slice(0, 150)}...`);

  let ok = true;
  if (!test.expectedDecisions.includes(result.decision)) {
    console.error(`   FAIL: Expected decision ${test.expectedDecisions.join("/")}, got ${result.decision}`);
    ok = false;
  }
  if (test.expectedMaxScoreFloor && result.matchScore < test.expectedMaxScoreFloor) {
    console.error(`   FAIL: Score ${result.matchScore} is below expected floor ${test.expectedMaxScoreFloor}`);
    ok = false;
  }
  if (test.expectedScoreCeiling && result.matchScore > test.expectedScoreCeiling) {
    console.error(`   FAIL: Score ${result.matchScore} exceeds ceiling ${test.expectedScoreCeiling} on hard failure`);
    ok = false;
  }
  if (test.expectedHardFailure !== undefined && result.hardEligibilityFailure !== test.expectedHardFailure) {
    console.error(`   FAIL: Hard failure flag mismatch: expected ${test.expectedHardFailure}, got ${result.hardEligibilityFailure}`);
    ok = false;
  }

  if (ok) {
    console.log(`   [PASS] Criteria met!\n`);
    passes++;
  } else {
    fails++;
  }
}

console.log("===================================================================");
console.log(` EVALUATION SUITE: ${passes} PASSED, ${fails} FAILED`);
console.log("===================================================================\n");

if (fails > 0) process.exit(1);
