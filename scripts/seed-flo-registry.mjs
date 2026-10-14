import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts", "api-server", "package.json"));
const esbuild = require("esbuild");
const Database = require("better-sqlite3");

console.log("=== SEEDING FLO SOURCE CATALOG & 47 COUNTIES ===");

const dbPath = path.resolve(root, "storage/data/ai-job-agent.sqlite");
const db = new Database(dbPath);

// 1. Load and compile source-registry-data.ts
const sourceDataTs = fs.readFileSync(path.join(root, "artifacts/api-server/src/lib/source-registry-data.ts"), "utf-8");
const sourceDataJs = esbuild.transformSync(sourceDataTs, { loader: "ts", format: "cjs" }).code;
const sourceModule = { exports: {} };
const runSource = new Function("module", "exports", sourceDataJs);
runSource(sourceModule, sourceModule.exports);
const sources = sourceModule.exports.COMPREHENSIVE_SOURCE_CATALOG;

console.log(`Loaded ${sources.length} sources from catalog.`);

// 2. Load and compile county-registry-data.ts
const countyDataTs = fs.readFileSync(path.join(root, "artifacts/api-server/src/lib/county-registry-data.ts"), "utf-8");
const countyDataJs = esbuild.transformSync(countyDataTs, { loader: "ts", format: "cjs" }).code;
const countyModule = { exports: {} };
const runCounty = new Function("module", "exports", countyDataJs);
runCounty(countyModule, countyModule.exports);
const counties = countyModule.exports.ALL_47_KENYAN_COUNTIES;

console.log(`Loaded ${counties.length} counties from catalog.`);

// 3. Insert sources into job_sources table
const insertSource = db.prepare(`
  INSERT OR REPLACE INTO job_sources (
    id, name, canonical_url, category, country, region,
    integration_type, connector_type, status, enabled,
    supports_api, supports_feed, supports_html_extraction,
    supports_browser_automation, supports_search_only,
    supports_application_redirect, authentication_required,
    terms_reviewed, access_method, rate_limit,
    total_discovered, total_parsed, total_indexed, total_rejected,
    consecutive_failures, config, created_at, updated_at
  ) VALUES (
    @id, @name, @canonicalUrl, @category, @country, @region,
    @integrationType, @connectorType, @status, @enabled,
    @supportsApi, @supportsFeed, @supportsHtmlExtraction,
    @supportsBrowserAutomation, @supportsSearchOnly,
    @supportsApplicationRedirect, @authenticationRequired,
    @termsReviewed, @accessMethod, @rateLimit,
    0, 0, 0, 0, 0, @config, @createdAt, @updatedAt
  )
`);

const now = Date.now();
const insertManySources = db.transaction((items) => {
  let count = 0;
  for (const s of items) {
    insertSource.run({
      id: s.id,
      name: s.name,
      canonicalUrl: s.canonicalUrl,
      category: s.category,
      country: s.country || "Kenya",
      region: s.region || null,
      integrationType: s.integrationType,
      connectorType: s.connectorType,
      status: s.status,
      enabled: s.enabled ? 1 : 0,
      supportsApi: s.supportsApi ? 1 : 0,
      supportsFeed: s.supportsFeed ? 1 : 0,
      supportsHtmlExtraction: s.supportsHtmlExtraction ? 1 : 0,
      supportsBrowserAutomation: 0,
      supportsSearchOnly: s.supportsSearchOnly ? 1 : 0,
      supportsApplicationRedirect: s.supportsApplicationRedirect ? 1 : 0,
      authenticationRequired: s.authenticationRequired ? 1 : 0,
      termsReviewed: 1,
      accessMethod: "PUBLIC_FEED",
      rateLimit: s.rateLimit || 30,
      config: s.config ? JSON.stringify(s.config) : null,
      createdAt: now,
      updatedAt: now,
    });
    count++;
  }
  return count;
});

const sourcesInserted = insertManySources(sources);
console.log(`Successfully seeded ${sourcesInserted} sources into job_sources table.`);

// 4. Insert counties into county_registry table
const insertCounty = db.prepare(`
  INSERT OR REPLACE INTO county_registry (
    id, code, name, capital, official_website,
    recruitment_url, cpsb_url, announcements_url,
    discovery_queries, status, verified_destinations
  ) VALUES (
    @id, @code, @name, @capital, @officialWebsite,
    @recruitmentUrl, @cpsbUrl, @announcementsUrl,
    @discoveryQueries, @status, '[]'
  )
`);

const insertManyCounties = db.transaction((items) => {
  let count = 0;
  for (const c of items) {
    insertCounty.run({
      id: c.id,
      code: c.code,
      name: c.name,
      capital: c.capital || null,
      officialWebsite: c.officialWebsite || null,
      recruitmentUrl: c.recruitmentUrl || null,
      cpsbUrl: c.cpsbUrl || null,
      announcementsUrl: c.announcementsUrl || null,
      discoveryQueries: c.discoveryQueries ? JSON.stringify(c.discoveryQueries) : "[]",
      status: c.status || "CONFIGURED",
    });
    count++;
  }
  return count;
});

const countiesInserted = insertManyCounties(counties);
console.log(`Successfully seeded ${countiesInserted} counties into county_registry table.`);

db.close();
console.log("=== SEEDING COMPLETE ===");
