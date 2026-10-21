import http from "node:http";
import assert from "node:assert/strict";
import app from "../artifacts/api-server/dist/app.mjs";

console.log("===================================================================");
console.log(" CLINICAL & SURGEON DISQUALIFICATION & RE-EVALUATION ACCEPTANCE TEST");
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
  } catch {}

  return { status: res.status, headers: res.headers, setCookie, data };
}

// 1. Register a Surgeon / Doctor account
const doctorEmail = `surgeon_${Date.now()}@hospital.org`;
const regRes = await apiRequest("/api/auth/register", {
  method: "POST",
  body: { name: "Dr. Kelvin Kazi", email: doctorEmail, password: "Password123!", profession: "Consultant Surgeon" },
});
assert.equal(regRes.status, 201);
const cookie = regRes.setCookie.split(";")[0];

// 2. Set candidate profile to Consultant Surgeon / Medical Doctor
const profileRes = await apiRequest("/api/candidate-profile", {
  method: "PUT",
  headers: { Cookie: cookie },
  body: {
    fullName: "Dr. Kelvin Kazi",
    email: doctorEmail,
    phone: "+254712345678",
    country: "Kenya",
    city: "Nairobi",
    timezone: "Africa/Nairobi",
    targetRoles: [
      "Consultant Surgeon",
      "General Surgeon",
      "Medical Doctor",
      "Clinical Specialist"
    ],
    skills: ["General Surgery", "Clinical Diagnosis", "Patient Care", "Operating Theatre", "Trauma Management", "Laparoscopy"],
    technologies: ["Electronic Health Records", "Surgical Navigation", "Laparoscopic Equipment"],
    yearsExperience: 8,
    education: ["Master of Medicine in General Surgery (MMed Surg)", "Bachelor of Medicine and Bachelor of Surgery (MBChB)"],
    certifications: ["KMPDC Specialist Recognition", "ATLS Certified"],
    industries: ["Healthcare", "Medicine", "Hospitals"],
    languages: ["English", "Swahili"],
    preferredLocations: ["Nairobi, Kenya"],
    workModes: ["onsite", "hybrid"],
    relocation: false,
    visaSponsorship: false,
    minimumSalary: 350000,
  }
});
assert.equal(profileRes.status, 200, `Profile update failed: ${JSON.stringify(profileRes.data)}`);

// Set active roles in discovery role approval
await apiRequest("/api/discovery/roles", {
  method: "POST",
  headers: { Cookie: cookie },
  body: {
    roles: [
      { roleTitle: "Consultant Surgeon", enabled: true, priority: "high" },
      { roleTitle: "General Surgeon", enabled: true, priority: "high" },
      { roleTitle: "Medical Doctor", enabled: true, priority: "high" },
      { roleTitle: "Clinical Specialist", enabled: true, priority: "high" }
    ]
  }
});

// The 11 non-medical jobs that incorrectly appeared on the user's dashboard + genuine medical jobs
const testJobs = [
  { title: "Business Travel Consultant (Germany - Remote)", company: "TripActions", expectedQualified: false },
  { title: "Customer Support Consultant hospitality", company: "SupportYourApp", expectedQualified: false },
  { title: "SAP RE FX Consultant", company: "Yoposo Romania SRL", expectedQualified: false },
  { title: "Android Engineer (mid-level)", company: "Tripadvisor", expectedQualified: false },
  { title: "Legal Counsel", company: "Zapier", expectedQualified: false },
  { title: "Sales & CX Enablement Partner", company: "Osano", expectedQualified: false },
  { title: "Knowledge Management Consultant - UNICEF", company: "UN Kenya", expectedQualified: false },
  { title: "POST-DOCTORAL RESEARCH SCIENTIST", company: "Impactpool Kenya", expectedQualified: false },
  { title: "Implementation Consultant", company: "Workday", expectedQualified: false },
  { title: "Health Coach", company: "Noom", expectedQualified: false },
  { title: "Associate Director Health Economics", company: "Novartis", expectedQualified: false },
  // Genuine clinical positions:
  { title: "Consultant General Surgeon", company: "The Nairobi Hospital", expectedQualified: true },
  { title: "Medical Officer / Resident Doctor", company: "Kenyatta National Hospital", expectedQualified: true },
  { title: "Clinical Specialist - Surgery & Trauma", company: "MP Shah Hospital", expectedQualified: true },
];

console.log("1. Ingesting test jobs into Surgeon workspace...");
for (let i = 0; i < testJobs.length; i++) {
  const j = testJobs[i];
  const postRes = await apiRequest("/api/jobs", {
    method: "POST",
    headers: { Cookie: cookie },
    body: {
      title: j.title,
      company: j.company,
      location: "Nairobi, Kenya",
      remote: false,
      salary: "Competitive",
      description: `Role at ${j.company}. Duties include general professional operations, medical insurance benefits, health coverage, and reporting.`,
      source: "kenya-crawler",
      sourceUrl: `https://example.com/jobs/${i + 1}`,
      externalJobId: `med-test-${i + 1}`,
    }
  });
  assert.equal(postRes.status, 201, `Failed to post job ${j.title}`);
}

console.log("2. Running AI Re-Evaluation on Surgeon's workspace...");
const reEvalRes = await apiRequest("/api/jobs/re-evaluate", {
  method: "POST",
  headers: { Cookie: cookie }
});
console.log("Re-evaluation result:", reEvalRes.data);
assert.equal(reEvalRes.status, 200);

console.log("3. Fetching Active Jobs via GET /api/jobs...");
const activeRes = await apiRequest("/api/jobs", {
  method: "GET",
  headers: { Cookie: cookie }
});
const activeJobs = activeRes.data || [];

console.log("4. Fetching Disqualified Jobs via GET /api/jobs?tab=rejected...");
const disqRes = await apiRequest("/api/jobs?tab=rejected", {
  method: "GET",
  headers: { Cookie: cookie }
});
const disqJobs = disqRes.data || [];

console.log(`\nActive jobs count: ${activeJobs.length} (Expected: 3 genuine clinical jobs)`);
console.log("Active jobs:", activeJobs.map(j => ({ title: j.title, status: j.status, score: j.matchScore })));

console.log(`\nDisqualified jobs count: ${disqJobs.length} (Expected: 11 non-medical jobs)`);
console.log("Disqualified jobs:", disqJobs.map(j => ({ title: j.title, status: j.status, reason: j.rejectionReason })));

const activeTitles = activeJobs.map(j => j.title);
const disqTitles = disqJobs.map(j => j.title);

for (const tj of testJobs) {
  if (!tj.expectedQualified) {
    assert.ok(
      !activeTitles.includes(tj.title),
      `CRITICAL FAILURE: Non-medical job "${tj.title}" must NOT appear in Active Jobs for Surgeon!`
    );
    assert.ok(
      disqTitles.includes(tj.title),
      `Non-medical job "${tj.title}" must be in Disqualified Jobs!`
    );
    console.log(`  [PASS - PROPERLY DISQUALIFIED] ${tj.title}`);
  } else {
    assert.ok(
      activeTitles.includes(tj.title),
      `Genuine medical job "${tj.title}" SHOULD appear in Active Jobs!`
    );
    console.log(`  [PASS - ACTIVE CLINICAL MATCH] ${tj.title}`);
  }
}

server.close();
console.log("\n===================================================================");
console.log(" ALL 14/14 CLINICAL REJECTION & QUALIFICATION TESTS PASSED!");
console.log(" Zero false matches in active views for doctor/surgeon profile.");
console.log("===================================================================");
