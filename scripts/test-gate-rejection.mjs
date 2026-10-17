import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import app from "../artifacts/api-server/dist/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "storage", "data", "ai-job-agent.sqlite");
const sqlite = new Database(dbPath);

console.log("===================================================================");
console.log(" STRICT ROLE-BASED DISQUALIFICATION & EVALUATION ACCEPTANCE TESTS");
console.log("===================================================================\n");

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

async function apiRequest(endpoint, options = {}) {
  const url = `${baseUrl}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const setCookie = res.headers.get("set-cookie");
  let data = null;
  try {
    data = await res.json();
  } catch {
    // empty
  }

  return { status: res.status, headers: res.headers, setCookie, data };
}

// Register Kelvin Developer test account
const kelvinEmail = `kelvin_dev_${Date.now()}@test.com`;
const regRes = await apiRequest("/api/auth/register", {
  method: "POST",
  body: { name: "Kelvin Muteru", email: kelvinEmail, password: "Password123!", profession: "Full-Stack Developer" },
});
assert.equal(regRes.status, 201);
const kelvinCookie = regRes.setCookie.split(";")[0];
const kelvinId = regRes.data.user.id;

// Update candidate profile target roles to developer & IT
const profileRes = await apiRequest("/api/candidate-profile", {
  method: "PUT",
  headers: { Cookie: kelvinCookie },
  body: {
    fullName: "Kelvin Muteru",
    email: kelvinEmail,
    phone: "+254719767590",
    country: "Kenya",
    city: "Nairobi",
    timezone: "Africa/Nairobi",
    targetRoles: [
      "Full-Stack Developer",
      "Frontend Developer",
      "React Developer",
      "Node.js Developer",
      "Backend Developer",
      "Python Automation Developer",
      "IT Support Specialist",
      "Technical Support Specialist"
    ],
    skills: ["React", "Node.js", "Python", "JavaScript", "TypeScript", "IT Support", "SQL", "Git"],
    technologies: ["React", "Express", "Node.js", "PostgreSQL", "Docker"],
    yearsExperience: 2,
    education: ["BSc Information Technology"],
    certifications: ["CompTIA A+"],
    industries: ["Information Technology", "Software"],
    languages: ["English", "Swahili"],
    preferredLocations: ["Nairobi, Kenya", "Remote"],
    workModes: ["remote", "hybrid"],
    relocation: false,
    visaSponsorship: false,
    minimumSalary: 150000,
  }
});
assert.equal(profileRes.status, 200, `Profile update failed: ${JSON.stringify(profileRes.data)}`);

const sampleJobs = [
  { title: "Knowledge Management Consultant - UNICEF Global Programme Division", company: "UN Kenya", expectedQualified: false },
  { title: "POST-DOCTORAL RESEARCH SCIENTIST", company: "Impactpool Kenya", expectedQualified: false },
  { title: "Sales & CX Enablement Partner", company: "Osano", expectedQualified: false },
  { title: "Android Engineer (mid-level)", company: "Tripadvisor", expectedQualified: false },
  { title: "Legal Counsel", company: "Zapier", expectedQualified: false },
  { title: "Senior Clinical Applications Associate", company: "Baylor College of Medicine", expectedQualified: false },
  { title: "Controls Product Senior Manager", company: "Monzo", expectedQualified: false },
  { title: "English to Spanish (LatAm) for Life Sciences Linguist", company: "Welo Global", expectedQualified: false },
  { title: "CSM II", company: "Carrot", expectedQualified: false },
  { title: "Senior Manager, AI Engineering", company: "HackerOne", expectedQualified: false },
  { title: "Edge Functions Engineer", company: "Supabase", expectedQualified: true },
  { title: "B2B Marketing Manager (ASEAN)", company: "Ajax Systems", expectedQualified: false },
  { title: "Senior DevOps Engineer - Storage Platforms", company: "Five9", expectedQualified: true },
  { title: "Demand Generation Program Manager", company: "Grafana Labs", expectedQualified: false },
  { title: "Marketing Operations and CRM Expert (Hubspot)", company: "Docplanner", expectedQualified: false },
  { title: "Proposal Writer", company: "Oddball", expectedQualified: false },
  { title: "Public Facing Security Researcher", company: "CertiK", expectedQualified: false },
  { title: "Financial Analyst (Entry-Level)", company: "CertiK", expectedQualified: false }
];

console.log("1. Ingesting sample jobs into Kelvin's workspace...");
for (let i = 0; i < sampleJobs.length; i++) {
  const j = sampleJobs[i];
  const postRes = await apiRequest("/api/jobs", {
    method: "POST",
    headers: { Cookie: kelvinCookie },
    body: {
      title: j.title,
      company: j.company,
      location: "Worldwide Remote",
      remote: true,
      salary: "Competitive",
      description: `Role at ${j.company} requiring teamwork, project coordination, communication and operations support.`,
      source: "jobicy",
      sourceUrl: `https://jobicy.com/jobs/${i + 1}`,
      externalJobId: `test-job-${i + 1}`,
    }
  });
  assert.equal(postRes.status, 201, `Failed to post job ${j.title}: ${JSON.stringify(postRes.data)}`);
}

console.log("2. Running AI Re-Evaluation on Kelvin's workspace...");
const reEvalRes = await apiRequest("/api/jobs/re-evaluate", {
  method: "POST",
  headers: { Cookie: kelvinCookie }
});
console.log("Re-evaluation result:", reEvalRes.data);
assert.equal(reEvalRes.status, 200, `Re-evaluation failed: ${JSON.stringify(reEvalRes.data)}`);

console.log("3. Querying Active Jobs and Disqualified Jobs for Kelvin...");
const activeRes = await apiRequest("/api/jobs", {
  method: "GET",
  headers: { Cookie: kelvinCookie }
});
const activeJobs = activeRes.data || [];
const disqRes = await apiRequest("/api/jobs?tab=rejected", {
  method: "GET",
  headers: { Cookie: kelvinCookie }
});
const disqJobs = disqRes.data || [];

console.log("Active jobs count:", activeJobs.length);
console.log("Active jobs:", activeJobs.map(j => ({ title: j.title, status: j.status, decision: j.aiDecision })));
console.log("Disqualified jobs count:", disqJobs.length);
console.log("Disqualified jobs:", disqJobs.map(j => ({ title: j.title, status: j.status, decision: j.aiDecision, reason: j.rejectionReason })));

console.log("\n--- VERIFICATION OF DISQUALIFIED JOBS ---");
const disqTitles = disqJobs.map(j => j.title);
const activeTitles = activeJobs.map(j => j.title);

for (const sj of sampleJobs) {
  if (!sj.expectedQualified) {
    assert.ok(
      !activeTitles.includes(sj.title),
      `Irrelevant job "${sj.title}" must NOT appear in Active Jobs!`
    );
    assert.ok(
      disqTitles.includes(sj.title),
      `Irrelevant job "${sj.title}" MUST be in Disqualified & Archive!`
    );
    console.log(`  [VERIFIED DISQUALIFIED] ${sj.title}`);
  } else {
    assert.ok(
      activeTitles.includes(sj.title),
      `Tech opportunity "${sj.title}" should appear in Active Jobs!`
    );
    console.log(`  [VERIFIED TECH OPPORTUNITY] ${sj.title}`);
  }
}

server.close();
console.log("\n===================================================================");
console.log(" ALL STRICT REJECTION & RE-EVALUATION TESTS PASSED (18/18 verified)");
console.log("===================================================================");
