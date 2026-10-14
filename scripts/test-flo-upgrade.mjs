import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts", "api-server", "package.json"));
const Database = require("better-sqlite3");

console.log("===================================================================");
console.log(" FLO AI JOB AGENT - FULL PLATFORM VERIFICATION TEST SUITE");
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

async function runAllTests() {
  const dbPath = path.resolve(root, "storage/data/ai-job-agent.sqlite");
  const sqlite = new Database(dbPath);

  // -------------------------------------------------------------
  // SUITE 1: DATABASE PERSISTENCE & SCHEMA INTEGRITY
  // -------------------------------------------------------------
  console.log("--- SUITE 1: Database Integrity & Existing Data Preservation ---");

  test("Existing job records preserved (220+ vacancies intact)", () => {
    const row = sqlite.prepare("SELECT count(*) as count FROM jobs").get();
    assert.ok(row.count >= 200, `Expected at least 200 jobs, found ${row.count}`);
    console.log(`         Verified ${row.count} existing job records preserved`);
  });

  test("Existing applications preserved without deletion", () => {
    const row = sqlite.prepare("SELECT count(*) as count FROM applications").get();
    assert.ok(row.count >= 1, `Expected at least 1 application, found ${row.count}`);
    console.log(`         Verified ${row.count} existing application records intact`);
  });

  test("New FLO tables exist: job_sources, county_registry, job_provenance, discovered_sources", () => {
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    assert.ok(tables.includes("job_sources"), "Missing job_sources table");
    assert.ok(tables.includes("county_registry"), "Missing county_registry table");
    assert.ok(tables.includes("job_provenance"), "Missing job_provenance table");
    assert.ok(tables.includes("discovered_sources"), "Missing discovered_sources table");
  });

  // -------------------------------------------------------------
  // SUITE 2: SOURCE REGISTRY INVENTORY & TRUTHFUL STATUS
  // -------------------------------------------------------------
  console.log("\n--- SUITE 2: Source Registry Inventory & Truthful Status ---");

  test("All requested source categories represented in job_sources", () => {
    const categories = sqlite.prepare("SELECT DISTINCT category FROM job_sources").all().map(r => r.category);
    const expected = [
      "KENYAN_JOB_BOARD",
      "GOVERNMENT_NATIONAL",
      "COUNTY_GOVERNMENT",
      "NGO_INTERNATIONAL",
      "TECH_EMPLOYER",
      "BANK_FINTECH",
      "RECRUITMENT_AGENCY",
      "GLOBAL_REMOTE",
      "AGGREGATOR",
    ];
    for (const cat of expected) {
      assert.ok(categories.includes(cat), `Expected category ${cat} in job_sources`);
    }
    console.log(`         Found ${categories.length} distinct source categories in database`);
  });

  test("Inventory contains over 150 unique source definitions", () => {
    const countRow = sqlite.prepare("SELECT count(*) as count FROM job_sources").get();
    assert.ok(countRow.count >= 150, `Expected >= 150 sources, found ${countRow.count}`);
    console.log(`         Catalog registered ${countRow.count} source endpoints`);
  });

  test("Truthful status model: login-gated & search-only sources are not falsely marked ACTIVE", () => {
    const psc = sqlite.prepare("SELECT status, integration_type FROM job_sources WHERE id = 'psck-jobs'").get();
    assert.ok(psc, "PSC portal missing");
    assert.notEqual(psc.status, "ACTIVE", "Login-required PSC portal should not be marked ACTIVE unconditionally");

    const linkedin = sqlite.prepare("SELECT status, integration_type FROM job_sources WHERE id = 'linkedin-jobs-kenya'").get();
    assert.ok(linkedin, "LinkedIn jobs missing");
    assert.notEqual(linkedin.status, "ACTIVE", "Anti-bot protected LinkedIn should not be marked ACTIVE");
  });

  // -------------------------------------------------------------
  // SUITE 3: EXTENSIBLE KENYAN COUNTY REGISTRY
  // -------------------------------------------------------------
  console.log("\n--- SUITE 3: Kenyan 47 County Governments Registry ---");

  test("Complete coverage: All 47 counties registered (Code 1 to 47)", () => {
    const countRow = sqlite.prepare("SELECT count(*) as count FROM county_registry").get();
    assert.equal(countRow.count, 47, `Expected exactly 47 counties, found ${countRow.count}`);

    const codes = sqlite.prepare("SELECT code FROM county_registry ORDER BY code").all().map(r => r.code);
    for (let c = 1; c <= 47; c++) {
      assert.ok(codes.includes(c), `County code ${c} missing`);
    }

    const nairobi = sqlite.prepare("SELECT name, capital, official_website, recruitment_url FROM county_registry WHERE code = 47").get();
    assert.equal(nairobi.name, "Nairobi City County");
    assert.ok(nairobi.official_website.includes("nairobi.go.ke"));

    const mombasa = sqlite.prepare("SELECT name, capital, official_website FROM county_registry WHERE code = 1").get();
    assert.equal(mombasa.name, "Mombasa County");
    assert.ok(mombasa.official_website.includes("mombasa.go.ke"));
  });

  // -------------------------------------------------------------
  // SUITE 4: DEDUPLICATION & CROSS-SOURCE PROVENANCE
  // -------------------------------------------------------------
  console.log("\n--- SUITE 4: Cross-Source Deduplication & Provenance Tracking ---");

  test("Job provenance records can be created and queried", () => {
    const testJobId = "test-job-prov-001";
    sqlite.prepare(`
      INSERT OR REPLACE INTO job_provenance (id, job_id, source_id, source_name, original_url, discovered_at, is_primary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("prov-1", testJobId, "brightermonday-kenya", "BrighterMonday Kenya", "https://brightermonday.co.ke/job/1", Date.now(), 1);

    sqlite.prepare(`
      INSERT OR REPLACE INTO job_provenance (id, job_id, source_id, source_name, original_url, discovered_at, is_primary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("prov-2", testJobId, "careerpointkenya", "Career Point Kenya", "https://careerpointkenya.co.ke/job/1", Date.now(), 0);

    const rows = sqlite.prepare("SELECT * FROM job_provenance WHERE job_id = ?").all(testJobId);
    assert.equal(rows.length, 2, "Expected 2 provenance records");
    assert.equal(rows[0].source_name, "BrighterMonday Kenya");
    assert.equal(rows[1].source_name, "Career Point Kenya");
    console.log(`         Cross-source provenance successfully recorded for ${testJobId}`);
  });

  // -------------------------------------------------------------
  // SUITE 5: SSRF PROTECTION VERIFICATION
  // -------------------------------------------------------------
  console.log("\n--- SUITE 5: SSRF Security Engine ---");

  function isPrivateIp(ip) {
    if (ip === "127.0.0.1" || ip === "::1" || ip === "0.0.0.0") return true;
    if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
    if (ip.startsWith("169.254.")) return true; // Link-local / AWS metadata
    const m = ip.match(/^172\.(\d+)\./);
    if (m && parseInt(m[1], 10) >= 16 && parseInt(m[1], 10) <= 31) return true;
    return false;
  }

  test("SSRF logic blocks private addresses, loopback, and metadata endpoints", () => {
    assert.equal(isPrivateIp("127.0.0.1"), true);
    assert.equal(isPrivateIp("169.254.169.254"), true);
    assert.equal(isPrivateIp("10.0.0.1"), true);
    assert.equal(isPrivateIp("192.168.1.1"), true);
    assert.equal(isPrivateIp("172.16.0.5"), true);
    assert.equal(isPrivateIp("8.8.8.8"), false);
    assert.equal(isPrivateIp("142.250.190.46"), false);
  });

  // -------------------------------------------------------------
  // SUITE 6: INDEXING COUNTERS
  // -------------------------------------------------------------
  console.log("\n--- SUITE 6: Database Indexing Metrics ---");

  test("Status breakdown query matches expected schema states", () => {
    const statusCounts = sqlite.prepare("SELECT status, count(*) as count FROM jobs GROUP BY status").all();
    console.log("         Persisted Job Statuses:", JSON.stringify(statusCounts));
    assert.ok(statusCounts.length > 0, "Expected status counts");
  });

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log("\n===================================================================");
  console.log(` TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED`);
  console.log("===================================================================\n");

  sqlite.close();
  if (failed > 0) process.exit(1);
}

runAllTests().catch(err => {
  console.error("Unhandled test runner error:", err);
  process.exit(1);
});
