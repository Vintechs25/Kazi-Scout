import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import app from "../artifacts/api-server/dist/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "storage", "data", "ai-job-agent.sqlite");
const sqlite = new Database(dbPath);

console.log("===================================================================");
console.log(" ROLE-BASED CV PARSING & MULTI-TENANT PROFILE SYNC TEST SUITE");
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

// Start ephemeral server
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

// -------------------------------------------------------------
// Test 1: Medical Doctor / Surgeon CV Parsing & Directive Generation
// -------------------------------------------------------------
let doctorCookie = "";
const doctorEmail = `surgeon_${Date.now()}@hospital.org`;
let doctorCvId = "";

await runTest("Surgeon Registration: Doctor registers separate account", async () => {
  const res = await apiRequest("/api/auth/register", {
    method: "POST",
    body: { name: "Dr. Beatrice Ochieng", email: doctorEmail, password: "SecurePassword123!" },
  });
  assert.equal(res.status, 201);
  doctorCookie = res.setCookie.split(";")[0];
});

await runTest("Surgeon CV Ingestion: Ingests verified surgical CV into account", async () => {
  // Obtain account ID from session
  const resProfile = await apiRequest("/api/candidate-profile", {
    headers: { Cookie: doctorCookie },
  });
  assert.equal(resProfile.status, 200);

  const cvText = `
    CURRICULUM VITAE OF DR. BEATRICE OCHIENG
    Email: ${doctorEmail}
    Phone: +254 722 987 654
    Location: Kisumu, Kenya

    PROFESSIONAL SUMMARY
    Consultant Surgeon and General Surgeon with 12 years of clinical practice in emergency abdominal surgery, laparoscopic procedures, patient triage, and surgical residency training.

    EDUCATION & CREDENTIALS
    - Bachelor of Medicine, Bachelor of Surgery (M.B., B.S.), Makerere University
    - Fellow of the West African College of Surgeons (FWACS)
    - Licensed Specialist with Kenya Medical Practitioners and Dentists Council (KMPDC)

    EXPERIENCE
    Consultant General Surgeon | Kisumu County Referral Hospital | 2018 - Present
    - Performed emergency and elective laparoscopic surgeries.
    - Led surgical ward rounds and supervised junior medical officers.
  `;

  // Insert CV record into db for this user
  doctorCvId = crypto.randomUUID();
  
  // Register CV via database with verified text
  const authStatus = await apiRequest("/api/auth/status", { headers: { Cookie: doctorCookie } });
  const accountId = authStatus.data?.user?.id;
  assert.ok(accountId, "User must be authenticated and return id");

  sqlite.prepare(`
    INSERT INTO cvs (id, account_id, file_name, storage_name, file_type, category, title, size_bytes, extracted_text, is_master, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    doctorCvId,
    accountId,
    "Dr_Beatrice_Ochieng_CV.pdf",
    "dr_beatrice_cv.pdf",
    "pdf",
    "cv",
    "Surgical Master CV",
    1024,
    cvText,
    1,
    Date.now(),
  );

  // Call parse endpoint
  const parseRes = await apiRequest(`/api/cvs/${doctorCvId}/parse`, {
    method: "POST",
    headers: { Cookie: doctorCookie },
    body: { consent: true, provider: "gemini" },
  });

  assert.equal(parseRes.status, 200, `CV Parse failed: ${JSON.stringify(parseRes.data)}`);
  assert.ok(parseRes.data.draft, "Parse response must contain profile draft");
  assert.ok(
    parseRes.data.draft.targetRoles.some(r => /surgeon|doctor|physician/i.test(r)),
    `Parsed target roles should include surgery/medicine, got: ${JSON.stringify(parseRes.data.draft.targetRoles)}`,
  );
});

await runTest("Surgeon Profile & Directive Sync: Candidate profile and Search Directive updated to Surgery", async () => {
  // Check candidate profile was synced
  const resProfile = await apiRequest("/api/candidate-profile", {
    headers: { Cookie: doctorCookie },
  });
  assert.equal(resProfile.status, 200);
  assert.ok(
    resProfile.data.targetRoles.some(r => /surgeon|doctor|physician/i.test(r)),
    `Candidate profile targetRoles must contain surgery, got: ${JSON.stringify(resProfile.data.targetRoles)}`,
  );
  assert.equal(resProfile.data.country, "Kenya");
  assert.equal(resProfile.data.city, "Kisumu");

  // Check search directive
  const resDirective = await apiRequest("/api/jobs/directive", {
    headers: { Cookie: doctorCookie },
  });
  assert.equal(resDirective.status, 200);
  assert.ok(
    resDirective.data.targetRoleFamilies.some(r => /surgeon|doctor|physician/i.test(r)),
    `Search Directive targetRoleFamilies must contain surgery, got: ${JSON.stringify(resDirective.data.targetRoleFamilies)}`,
  );
  assert.ok(
    resDirective.data.searchQueries.some(q => /surgeon|doctor|physician|medical/i.test(q)),
    `Search Directive search queries must search for medical roles, got: ${JSON.stringify(resDirective.data.searchQueries)}`,
  );
  assert.ok(
    !resDirective.data.targetRoleFamilies.includes("Officer") &&
    !resDirective.data.targetRoleFamilies.includes("Specialist"),
    "Directive must NOT fall back to generic words like 'Officer' or 'Specialist'",
  );
});

// -------------------------------------------------------------
// Test 2: Multi-Tenant Cross-Contamination Check
// -------------------------------------------------------------
await runTest("Isolation Verification: A new Engineer account does NOT see Doctor's CV or Directive", async () => {
  const engEmail = `engineer_${Date.now()}@build.co.ke`;
  const resEngReg = await apiRequest("/api/auth/register", {
    method: "POST",
    body: { name: "Eng. Samuel Kiptoo", email: engEmail, password: "SecurePassword123!" },
  });
  assert.equal(resEngReg.status, 201);
  const engCookie = resEngReg.setCookie.split(";")[0];

  // Engineer checks CV list
  const resCvs = await apiRequest("/api/cvs", {
    headers: { Cookie: engCookie },
  });
  assert.equal(resCvs.status, 200);
  assert.equal(resCvs.data.length, 0, "New engineer must have 0 CVs");

  // Engineer checks directive: must NOT contain surgeon roles
  const resEngDirective = await apiRequest("/api/jobs/directive", {
    headers: { Cookie: engCookie },
  });
  assert.equal(resEngDirective.status, 200);
  assert.ok(
    !resEngDirective.data.targetRoleFamilies.some(r => /surgeon|doctor/i.test(r)),
    "Engineer directive must NOT contain surgeon roles from other tenant",
  );
});

server.close();

console.log("\n===================================================================");
console.log(` CV ROLE DISCOVERY RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log("===================================================================\n");

if (failed > 0) process.exit(1);
else process.exit(0);
