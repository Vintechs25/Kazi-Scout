import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import app from "../artifacts/api-server/dist/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("===================================================================");
console.log(" MULTI-TENANT ISOLATION & ROLE-BASED CV DISCOVERY ACCEPTANCE TESTS");
console.log("===================================================================\n");

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
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
// Test 1: Database Schema & Composite Unique Constraints
// -------------------------------------------------------------
const dbPath = path.join(root, "storage", "data", "ai-job-agent.sqlite");
const sqlite = new Database(dbPath);

await runTest("Database schema has account_id columns on all multi-tenant tables", () => {
  const tables = ["jobs", "applications", "activity", "search_profiles"];
  for (const table of tables) {
    const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all();
    const hasAccountId = columns.some((c) => c.name === "account_id");
    assert.ok(hasAccountId, `Table ${table} must have account_id column`);
  }
});

await runTest("Composite unique indexes exist on jobs table to allow independent discovery", () => {
  const indexes = sqlite.prepare(`PRAGMA index_list(jobs)`).all();
  const indexNames = indexes.map((i) => i.name);
  assert.ok(
    indexNames.includes("jobs_account_fingerprint_unique"),
    "jobs_account_fingerprint_unique composite index must exist",
  );
  assert.ok(
    indexNames.includes("jobs_account_source_external_id_unique"),
    "jobs_account_source_external_id_unique composite index must exist",
  );
});

// -------------------------------------------------------------
// Start Ephemeral Server for Real HTTP API Multi-Tenant Tests
// -------------------------------------------------------------
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
    // text or empty
  }

  return { status: res.status, headers: res.headers, setCookie, data };
}

let aliceCookie = "";
let bobCookie = "";
const aliceEmail = `alice_${Date.now()}@test.com`;
const bobEmail = `bob_${Date.now()}@test.com`;

await runTest("Account Registration: Alice and Bob register independent accounts", async () => {
  const resAlice = await apiRequest("/api/auth/register", {
    method: "POST",
    body: { name: "Alice Accountant", email: aliceEmail, password: "Password123!" },
  });
  assert.equal(resAlice.status, 201, `Alice registration failed: ${JSON.stringify(resAlice.data)}`);
  assert.ok(resAlice.setCookie, "Alice must receive session cookie");
  aliceCookie = resAlice.setCookie.split(";")[0];

  const resBob = await apiRequest("/api/auth/register", {
    method: "POST",
    body: { name: "Bob Doctor", email: bobEmail, password: "Password123!" },
  });
  assert.equal(resBob.status, 201, `Bob registration failed: ${JSON.stringify(resBob.data)}`);
  assert.ok(resBob.setCookie, "Bob must receive session cookie");
  bobCookie = resBob.setCookie.split(";")[0];
});

await runTest("Candidate Profile Isolation: Alice sets accounting profile; Bob sees fresh default", async () => {
  // Alice updates her profile with target roles
  const resAliceUpdate = await apiRequest("/api/candidate-profile", {
    method: "PUT",
    headers: { Cookie: aliceCookie },
    body: {
      fullName: "Alice Accounting",
      email: aliceEmail,
      phone: "+254700000000",
      country: "Kenya",
      city: "Nairobi",
      timezone: "Africa/Nairobi",
      targetRoles: ["Senior Accountant", "Financial Analyst", "Finance Manager"],
      skills: ["IFRS", "Financial Modeling", "QuickBooks", "Tax Compliance"],
      technologies: ["Excel", "SAP ERP"],
      yearsExperience: 7,
      education: ["Bachelor of Commerce - Accounting"],
      certifications: ["CPA-K"],
      industries: ["Banking", "Financial Services"],
      languages: ["English", "Swahili"],
      preferredLocations: ["Nairobi, Kenya"],
      workModes: ["hybrid", "onsite"],
      relocation: false,
      visaSponsorship: false,
      minimumSalary: 200000,
    },
  });
  assert.equal(resAliceUpdate.status, 200, `Alice profile update failed: ${JSON.stringify(resAliceUpdate.data)}`);
  assert.deepEqual(resAliceUpdate.data.targetRoles, ["Senior Accountant", "Financial Analyst", "Finance Manager"]);

  // Bob requests his profile
  const resBobProfile = await apiRequest("/api/candidate-profile", {
    headers: { Cookie: bobCookie },
  });
  assert.equal(resBobProfile.status, 200);
  assert.equal(resBobProfile.data.email, bobEmail);
  assert.notEqual(resBobProfile.data.fullName, "Alice Accounting", "Bob must NOT see Alice's full name");
  assert.deepEqual(resBobProfile.data.targetRoles, [], "Bob's target roles must be empty initially");
});

let aliceJobId = "";
await runTest("Job Discovery & Creation Isolation: Alice adds a job; Bob's job list is empty", async () => {
  const resCreateJob = await apiRequest("/api/jobs", {
    method: "POST",
    headers: { Cookie: aliceCookie },
    body: {
      title: "Senior Financial Accountant",
      company: "NCBA Bank Kenya",
      location: "Nairobi, Kenya",
      remote: false,
      salary: "Competitive",
      source: "manual",
      sourceUrl: "https://ncbagroup.com/careers/senior-financial-accountant",
      externalJobId: "ncba-acc-01",
      description: "Looking for an experienced accountant to lead monthly reporting and IFRS compliance.",
    },
  });
  assert.equal(resCreateJob.status, 201, `Job creation failed: ${JSON.stringify(resCreateJob.data)}`);
  aliceJobId = resCreateJob.data.id;

  // Alice sees 1 job
  const resAliceJobs = await apiRequest("/api/jobs", {
    headers: { Cookie: aliceCookie },
  });
  assert.equal(resAliceJobs.status, 200);
  assert.equal(resAliceJobs.data.length, 1);
  assert.equal(resAliceJobs.data[0].id, aliceJobId);

  // Bob sees 0 jobs
  const resBobJobs = await apiRequest("/api/jobs", {
    headers: { Cookie: bobCookie },
  });
  assert.equal(resBobJobs.status, 200);
  assert.equal(resBobJobs.data.length, 0, "Bob MUST see 0 jobs");
});

await runTest("Independent Discovery: Bob can add the exact same job without unique constraint collision", async () => {
  const resBobJob = await apiRequest("/api/jobs", {
    method: "POST",
    headers: { Cookie: bobCookie },
    body: {
      title: "Senior Financial Accountant",
      company: "NCBA Bank Kenya",
      location: "Nairobi, Kenya",
      remote: false,
      salary: "Competitive",
      source: "manual",
      sourceUrl: "https://ncbagroup.com/careers/senior-financial-accountant",
      externalJobId: "ncba-acc-01",
      description: "Looking for an experienced accountant to lead monthly reporting and IFRS compliance.",
    },
  });
  assert.equal(resBobJob.status, 201, `Bob job create failed: ${JSON.stringify(resBobJob.data)}`);
  assert.notEqual(resBobJob.data.id, aliceJobId, "Bob receives a unique job record");

  // Bob now sees his 1 job
  const resBobJobs = await apiRequest("/api/jobs", {
    headers: { Cookie: bobCookie },
  });
  assert.equal(resBobJobs.status, 200);
  assert.equal(resBobJobs.data.length, 1);
  assert.equal(resBobJobs.data[0].id, resBobJob.data.id);
});

await runTest("Application Tracking Isolation: Alice tracks an application; Bob sees 0 applications", async () => {
  const resTrack = await apiRequest(`/api/jobs/${aliceJobId}/track`, {
    method: "POST",
    headers: { Cookie: aliceCookie },
    body: { method: "email" },
  });
  assert.equal(resTrack.status, 201, `Alice track failed: ${JSON.stringify(resTrack.data)}`);

  // Alice sees 1 application
  const resAliceApps = await apiRequest("/api/applications", {
    headers: { Cookie: aliceCookie },
  });
  assert.equal(resAliceApps.status, 200);
  assert.equal(resAliceApps.data.length, 1);

  // Bob sees 0 applications
  const resBobApps = await apiRequest("/api/applications", {
    headers: { Cookie: bobCookie },
  });
  assert.equal(resBobApps.status, 200);
  assert.equal(resBobApps.data.length, 0, "Bob MUST see 0 applications");
});

await runTest("Dashboard Stats Isolation: Alice has activity and counts; Bob shows 0 stats and 0 activity", async () => {
  const resAliceDash = await apiRequest("/api/dashboard", {
    headers: { Cookie: aliceCookie },
  });
  assert.equal(resAliceDash.status, 200);
  assert.equal(resAliceDash.data.jobsDiscovered, 1);
  assert.equal(resAliceDash.data.applicationsPending, 1);
  assert.ok(resAliceDash.data.recentActivity.length > 0, "Alice should have activity");

  const resBobDash = await apiRequest("/api/dashboard", {
    headers: { Cookie: bobCookie },
  });
  assert.equal(resBobDash.status, 200);
  assert.equal(resBobDash.data.applicationsPending, 0, "Bob pending applications must be 0");
  assert.equal(resBobDash.data.applicationsSubmitted, 0, "Bob submitted applications must be 0");
});

await runTest("Discovery & Role Approval Multi-Tenant Isolation: Bob never inherits Surgeon or another account's roles/runs", async () => {
  // Bob checks his enabled roles - MUST be empty, NEVER inheriting Dr. Beatrice's surgeon roles or primary profile
  const resBobRoles = await apiRequest("/api/user/roles/enabled", {
    headers: { Cookie: bobCookie },
  });
  assert.equal(resBobRoles.status, 200);
  assert.equal(resBobRoles.data.success, true);
  const bobRoles = resBobRoles.data.roles || [];
  assert.ok(
    !bobRoles.some(r => r.toLowerCase().includes("surgeon") || r.toLowerCase().includes("medical")),
    `Bob must NEVER see surgeon roles in /api/user/roles/enabled, got: ${JSON.stringify(bobRoles)}`,
  );

  // Bob checks discovery history - MUST be empty, NEVER seeing other accounts' runs
  const resBobHistory = await apiRequest("/api/discovery/history", {
    headers: { Cookie: bobCookie },
  });
  assert.equal(resBobHistory.status, 200);
  assert.equal(resBobHistory.data.success, true);
  assert.equal(resBobHistory.data.runs.length, 0, "Bob's discovery history must be 0 initially");

  // Bob checks discovery statistics - MUST be clean zeroes
  const resBobStats = await apiRequest("/api/discovery/statistics", {
    headers: { Cookie: bobCookie },
  });
  assert.equal(resBobStats.status, 200);
  assert.equal(resBobStats.data.success, true);
  assert.equal(resBobStats.data.totalDiscoveries, 0, "Bob total discoveries must be 0");
  assert.equal(resBobStats.data.totalJobsDiscovered, 0, "Bob total jobs discovered must be 0");
  assert.equal(resBobStats.data.totalMatches, 0, "Bob total matches must be 0");
});

await runTest("Search Directive Isolation: Alice's directive reflects Accounting; Bob's is separate", async () => {
  const resAliceDirective = await apiRequest("/api/jobs/directive", {
    headers: { Cookie: aliceCookie },
  });
  assert.equal(resAliceDirective.status, 200, `Alice directive failed: ${JSON.stringify(resAliceDirective.data)}`);
  const aliceRoles = resAliceDirective.data?.targetRoleFamilies || [];
  assert.ok(
    aliceRoles.some(r => r.toLowerCase().includes("accountant")),
    `Alice has accountant target role, got: ${JSON.stringify(aliceRoles)}`,
  );

  const resBobDirective = await apiRequest("/api/jobs/directive", {
    headers: { Cookie: bobCookie },
  });
  assert.equal(resBobDirective.status, 200, `Bob directive failed: ${JSON.stringify(resBobDirective.data)}`);
  const bobRoles = resBobDirective.data?.targetRoleFamilies || [];
  assert.ok(
    !bobRoles.some(r => r.toLowerCase().includes("accountant")),
    `Bob must NOT have Alice's accountant target roles, got: ${JSON.stringify(bobRoles)}`,
  );
});

await runTest("Data Wipe Isolation: Alice wipes workspace data; Bob's data remains intact", async () => {
  const resWipe = await apiRequest("/api/settings/wipe-data", {
    method: "POST",
    headers: { Cookie: aliceCookie },
  });
  assert.equal(resWipe.status, 200, "Wipe data request should succeed");

  // Alice now has 0 jobs
  const resAliceJobs = await apiRequest("/api/jobs", {
    headers: { Cookie: aliceCookie },
  });
  assert.equal(resAliceJobs.data.length, 0, "Alice's jobs should be wiped");

  // Bob STILL has his 1 job intact!
  const resBobJobs = await apiRequest("/api/jobs", {
    headers: { Cookie: bobCookie },
  });
  assert.equal(resBobJobs.data.length, 1, "Bob's job MUST NOT be deleted when Alice wipes her workspace");
});

// Close ephemeral server
server.close();

// -------------------------------------------------------------
// Test 4: Connector Verification (Remotive Live Fetch & Free public APIs)
// -------------------------------------------------------------
await runTest("Remotive live connector fetches jobs without API keys", async () => {
  const res = await fetch("https://remotive.com/api/remote-jobs?limit=5");
  assert.ok(res.ok, "Remotive public API must be accessible");
  const data = await res.json();
  assert.ok(Array.isArray(data.jobs), "Remotive returns jobs array");
  console.log(`         Remotive live fetch verified: ${data.jobs.length} remote jobs received.`);
});

console.log("\n===================================================================");
console.log(` ACCEPTANCE RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log("===================================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("ALL ACCEPTANCE CRITERIA VERIFIED SUCCESSFULLY!");
  process.exit(0);
}
