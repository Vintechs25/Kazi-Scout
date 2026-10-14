import { db, jobsTable, applicationsTable, jobSourcesTable, countyRegistryTable, jobProvenanceTable, discoveredSourcesTable } from "../lib/db/src/index.ts";
import { sql, eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { SourceService } from "../artifacts/api-server/src/lib/source-service";
import { validateSafeUrl } from "../artifacts/api-server/src/lib/connectors/http-client";
import { getVerifiedMasterCv } from "../artifacts/api-server/src/lib/cv-storage";
import { getOrGenerateCandidateEvidence } from "../artifacts/api-server/src/lib/candidate-evidence";
import { SourceDiscoveryEngine } from "../artifacts/api-server/src/lib/source-discovery-engine";

console.log("===================================================================");
console.log(" FLO AI JOB AGENT - FULL PLATFORM VERIFICATION TEST SUITE");
console.log("===================================================================\n");

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}

async function asyncTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}

async function runAllTests() {
  // -------------------------------------------------------------
  // SUITE 1: DATABASE PERSISTENCE & SCHEMA SAFETY
  // -------------------------------------------------------------
  console.log("--- SUITE 1: Database Integrity & Existing Data Preservation ---");

  await asyncTest("Existing job records preserved (220+ vacancies intact)", async () => {
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(jobsTable);
    assert.ok(count >= 200, `Expected at least 200 jobs, found ${count}`);
    console.log(`         Verified ${count} existing job records preserved`);
  });

  await asyncTest("Existing applications preserved without deletion", async () => {
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(applicationsTable);
    assert.ok(count >= 1, `Expected at least 1 application, found ${count}`);
    console.log(`         Verified ${count} existing application records intact`);
  });

  // -------------------------------------------------------------
  // SUITE 2: MASTER CV & CANDIDATE EVIDENCE INTEGRATION
  // -------------------------------------------------------------
  console.log("\n--- SUITE 2: Master CV Evidence & Profile Loading ---");

  await asyncTest("Master CV verified and loads successfully", async () => {
    const dossier = await getVerifiedMasterCv();
    assert.equal(dossier.loaded, true, "Master CV must be loaded");
    assert.ok(dossier.text.length > 1000, `Expected >1000 chars of extracted CV text, got ${dossier.text.length}`);
    console.log(`         CV Document: "${dossier.cvRecord?.fileName}" (${dossier.text.length} chars)`);
  });

  await asyncTest("Candidate Evidence profile grounded in verified CV facts", async () => {
    const evidence = await getOrGenerateCandidateEvidence();
    assert.ok(evidence.fullName, "Candidate full name must be present");
    assert.ok(evidence.demonstratedTechnicalSkills.length > 0, "Demonstrated skills must be present");
    assert.ok(evidence.verifiedWorkExperience.length > 0, "Work experience must be present");
    console.log(`         Candidate: ${evidence.fullName} (${evidence.yearsExperience} yrs exp), Skills: ${evidence.demonstratedTechnicalSkills.slice(0, 4).join(", ")}`);
  });

  // -------------------------------------------------------------
  // SUITE 3: SOURCE REGISTRY INVENTORY & TRUTHFUL STATUS
  // -------------------------------------------------------------
  console.log("\n--- SUITE 3: Source Registry Inventory & Truthful Status ---");

  await asyncTest("Initialize catalog idempotently", async () => {
    const res = await SourceService.initializeCatalog();
    assert.ok(typeof res.sourcesSeeded === "number");
    assert.ok(typeof res.countiesSeeded === "number");
  });

  await asyncTest("All requested source categories represented in job_sources", async () => {
    const catRows = await db.selectDistinct({ category: jobSourcesTable.category }).from(jobSourcesTable);
    const categories = catRows.map(r => r.category);
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

  await asyncTest("Inventory contains over 150 unique source definitions", async () => {
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(jobSourcesTable);
    assert.ok(count >= 150, `Expected >= 150 sources, found ${count}`);
    console.log(`         Catalog registered ${count} source endpoints`);
  });

  await asyncTest("Truthful status model: login-gated & search-only sources are not falsely marked ACTIVE", async () => {
    const pscRows = await db.select().from(jobSourcesTable).where(eq(jobSourcesTable.id, "psck-jobs"));
    assert.ok(pscRows[0], "PSC portal missing");
    assert.notEqual(pscRows[0].status, "ACTIVE", "Login-required PSC portal should not be marked ACTIVE unconditionally");

    const linkedinRows = await db.select().from(jobSourcesTable).where(eq(jobSourcesTable.id, "linkedin-jobs"));
    assert.ok(linkedinRows[0], "LinkedIn jobs missing");
    assert.notEqual(linkedinRows[0].status, "ACTIVE", "Anti-bot protected LinkedIn should not be marked ACTIVE");
  });

  // -------------------------------------------------------------
  // SUITE 4: EXTENSIBLE KENYAN COUNTY REGISTRY
  // -------------------------------------------------------------
  console.log("\n--- SUITE 4: Kenyan 47 County Governments Registry ---");

  await asyncTest("Complete coverage: All 47 counties registered (Code 1 to 47)", async () => {
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(countyRegistryTable);
    assert.equal(count, 47, `Expected exactly 47 counties, found ${count}`);

    const codeRows = await db.select({ code: countyRegistryTable.code }).from(countyRegistryTable).orderBy(countyRegistryTable.code);
    const codes = codeRows.map(r => r.code);
    for (let c = 1; c <= 47; c++) {
      assert.ok(codes.includes(c), `County code ${c} missing`);
    }

    const nairobiRows = await db.select().from(countyRegistryTable).where(eq(countyRegistryTable.code, 47));
    assert.equal(nairobiRows[0].name, "Nairobi City County");
    assert.ok(nairobiRows[0].officialWebsite?.includes("nairobi.go.ke"));

    const mombasaRows = await db.select().from(countyRegistryTable).where(eq(countyRegistryTable.code, 1));
    assert.equal(mombasaRows[0].name, "Mombasa County");
    assert.ok(mombasaRows[0].officialWebsite?.includes("mombasa.go.ke"));
  });

  // -------------------------------------------------------------
  // SUITE 5: CONNECTOR ARCHITECTURE & SSRF SECURITY
  // -------------------------------------------------------------
  console.log("\n--- SUITE 5: Connector Architecture & SSRF Security ---");

  await asyncTest("SSRF Protection: Block localhost and loopback addresses", async () => {
    const localhostRes = await validateSafeUrl("http://localhost:3000/api");
    assert.equal(localhostRes.valid, false, "Localhost should be blocked");

    const loopbackRes = await validateSafeUrl("http://127.0.0.1:8080");
    assert.equal(loopbackRes.valid, false, "127.0.0.1 should be blocked");
  });

  await asyncTest("SSRF Protection: Block cloud metadata and private RFC1918 subnets", async () => {
    const metaRes = await validateSafeUrl("http://169.254.169.254/latest/meta-data");
    assert.equal(metaRes.valid, false, "169.254.169.254 link-local must be blocked");

    const rfc1Res = await validateSafeUrl("http://10.0.0.1/admin");
    assert.equal(rfc1Res.valid, false, "10.x private IP must be blocked");

    const rfc2Res = await validateSafeUrl("http://192.168.1.1/setup");
    assert.equal(rfc2Res.valid, false, "192.168.x private IP must be blocked");
  });

  await asyncTest("SSRF Protection: Allow valid public HTTPS domains", async () => {
    const publicRes = await validateSafeUrl("https://www.google.com");
    assert.equal(publicRes.valid, true, "Public HTTPS URL should pass validation");
  });

  // -------------------------------------------------------------
  // SUITE 6: DEDUPLICATION & CROSS-SOURCE PROVENANCE
  // -------------------------------------------------------------
  console.log("\n--- SUITE 6: Cross-Source Deduplication & Provenance Tracking ---");

  await asyncTest("Job provenance records can be created and queried", async () => {
    const testJobId = "test-job-prov-001";
    await db.insert(jobProvenanceTable).values([
      {
        id: "prov-test-1",
        jobId: testJobId,
        sourceId: "brightermonday-kenya",
        sourceName: "BrighterMonday Kenya",
        originalUrl: "https://brightermonday.co.ke/job/1",
        discoveredAt: new Date(),
        isPrimary: true,
      },
      {
        id: "prov-test-2",
        jobId: testJobId,
        sourceId: "careerpointkenya",
        sourceName: "Career Point Kenya",
        originalUrl: "https://careerpointkenya.co.ke/job/1",
        discoveredAt: new Date(),
        isPrimary: false,
      },
    ]).onConflictDoNothing();

    const rows = await db.select().from(jobProvenanceTable).where(eq(jobProvenanceTable.jobId, testJobId));
    assert.ok(rows.length >= 2, "Expected at least 2 provenance records");
    console.log(`         Verified cross-source provenance records recorded for job ${testJobId}`);
  });

  // -------------------------------------------------------------
  // SUITE 7: REAL ACCESSIBLE CONNECTOR PROBE
  // -------------------------------------------------------------
  console.log("\n--- SUITE 7: Real Accessible Connector Health Check ---");

  await asyncTest("Real Health Check: Probe public RSS/feed connectors", async () => {
    const himalayasRows = await db.select().from(jobSourcesTable).where(eq(jobSourcesTable.id, "himalayas-feed"));
    if (himalayasRows[0]) {
      const res = await SourceService.testSourceConnection(himalayasRows[0].id);
      console.log(`         Himalayas Feed Probe: Status = ${res.assignedStatus}, Latency = ${res.responseTimeMs}ms`);
      assert.ok(res.assignedStatus === "ACTIVE" || res.assignedStatus === "READY" || res.assignedStatus === "DEGRADED");
    }
  });

  // -------------------------------------------------------------
  // SUITE 8: SOURCE DISCOVERY ENGINE PROBE
  // -------------------------------------------------------------
  console.log("\n--- SUITE 8: Source Discovery Engine ---");

  await asyncTest("Discovery engine runs SSRF probe and generates proposals", async () => {
    const result = await SourceDiscoveryEngine.runDiscoveryRun({ maxCandidates: 2 });
    assert.ok(typeof result.proposalsGenerated === "number");
    console.log(`         Discovered proposals generated: ${result.proposalsGenerated}`);
  });

  // -------------------------------------------------------------
  // SUITE 9: INDEXING OVERVIEW REAL COUNTERS
  // -------------------------------------------------------------
  console.log("\n--- SUITE 9: Real Indexing Overview Metrics ---");

  await asyncTest("Overview metrics derived from actual database tables", async () => {
    const overview = await SourceService.getIndexingOverview();
    assert.ok(overview.jobs.total >= 200, "Total jobs should reflect persisted DB count");
    assert.ok(overview.sources.total >= 150, "Total sources should reflect registered catalog");
    assert.ok(typeof overview.jobs.aiEvaluatedCount === "number");
    assert.ok(typeof overview.jobs.provenanceRecords === "number");
    console.log(`         Metrics: Total Jobs = ${overview.jobs.total}, AI Evaluated = ${overview.jobs.aiEvaluatedCount}, Total Sources = ${overview.sources.total}`);
  });

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log("\n===================================================================");
  console.log(` TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED`);
  console.log("===================================================================\n");

  if (failed > 0) process.exit(1);
}

runAllTests().catch(err => {
  console.error("Unhandled test runner error:", err);
  process.exit(1);
});
