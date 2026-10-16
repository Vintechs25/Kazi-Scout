import { createInsertSchema } from "drizzle-zod";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const jobSourcesTable = sqliteTable(
  "job_sources",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    category: text("category").notNull(), // Legacy: KENYAN_JOB_BOARD, GOVERNMENT_NATIONAL, COUNTY_GOVERNMENT, NGO_INTERNATIONAL, TECH_EMPLOYER, BANK_FINTECH, RECRUITMENT_AGENCY, GLOBAL_REMOTE, AGGREGATOR, PUBLIC_COMMUNITY, AI_DISCOVERED
    country: text("country").notNull().default("Kenya"),
    region: text("region"),
    integrationType: text("integration_type").notNull().default("PUBLIC_FEED"), // OFFICIAL_API, PUBLIC_FEED, STRUCTURED_HTML, CAREER_PAGE, SEARCH_ONLY, BROWSER_AUTOMATION, MANUAL_URL, COMMUNITY_ANNOUNCEMENT
    connectorType: text("connector_type").notNull().default("FEED"),
    status: text("status", {
      enum: [
        "DISCOVERED",
        "CONFIGURED",
        "READY",
        "ACTIVE",
        "DEGRADED",
        "DISABLED",
        "AUTH_REQUIRED",
        "BLOCKED",
        "ERROR",
        "UNSUPPORTED",
      ],
    }).notNull().default("CONFIGURED"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    supportsApi: integer("supports_api", { mode: "boolean" }).default(false),
    supportsFeed: integer("supports_feed", { mode: "boolean" }).default(false),
    supportsHtmlExtraction: integer("supports_html_extraction", { mode: "boolean" }).default(false),
    supportsBrowserAutomation: integer("supports_browser_automation", { mode: "boolean" }).default(false),
    supportsSearchOnly: integer("supports_search_only", { mode: "boolean" }).default(false),
    supportsApplicationRedirect: integer("supports_application_redirect", { mode: "boolean" }).default(true),
    authenticationRequired: integer("authentication_required", { mode: "boolean" }).default(false),
    termsReviewed: integer("terms_reviewed", { mode: "boolean" }).default(true),
    accessMethod: text("access_method"),
    rateLimit: integer("rate_limit").default(60),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
    lastSuccessfulRunAt: integer("last_successful_run_at", { mode: "timestamp" }),
    lastJobDiscoveredAt: integer("last_job_discovered_at", { mode: "timestamp" }),
    lastErrorAt: integer("last_error_at", { mode: "timestamp" }),
    lastErrorMessage: text("last_error_message"),
    totalDiscovered: integer("total_discovered").default(0),
    totalParsed: integer("total_parsed").default(0),
    totalIndexed: integer("total_indexed").default(0),
    totalRejected: integer("total_rejected").default(0),
    consecutiveFailures: integer("consecutive_failures").default(0),
    config: text("config", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),

    // --- REFINED TAXONOMY & ROUTING CAPABILITIES ---
    // What the source IS:
    // GENERAL_BOARD | INDUSTRY_BOARD | GOVERNMENT_PORTAL | EMPLOYER_CAREERS | RECRUITER | FREELANCE_MARKETPLACE | AGGREGATOR | AI_DISCOVERED
    sourceKind: text("source_kind").notNull().default("GENERAL_BOARD"),

    // Who it SERVES (JSON arrays)
    countries: text("countries", { mode: "json" }).$type<string[]>().default([]), // ISO codes ["KE","UG"], ["*"] = global
    industries: text("industries", { mode: "json" }).$type<string[]>().default([]), // ["healthcare","finance"], ["*"] = all
    occupationGroups: text("occupation_groups", { mode: "json" }).$type<string[]>().default([]), // ISCO codes e.g. ["22","221"], ["*"] = all
    employmentTypes: text("employment_types", { mode: "json" }).$type<string[]>().default([]), // permanent, contract, freelance, internship
    workArrangements: text("work_arrangements", { mode: "json" }).$type<string[]>().default([]), // onsite, hybrid, remote
    languages: text("languages", { mode: "json" }).$type<string[]>().default([]), // ["en","sw","fr"]

    // Capabilities the router and parser need
    searchUrlTemplate: text("search_url_template"), // e.g. https://x.com/jobs?q={query}&l={location}
    returnsFullDescription: integer("returns_full_description", { mode: "boolean" }).default(false),
    hasJsonLdJobPosting: integer("has_json_ld", { mode: "boolean" }).default(false),

    // Lifecycle
    isDefunct: integer("is_defunct", { mode: "boolean" }).default(false),
    replacedBySourceId: text("replaced_by_source_id"),

    // Quality metrics recomputed after every run
    yieldRate: real("yield_rate"), // totalIndexed / totalDiscovered
    rejectReasons: text("reject_reasons", { mode: "json" }).$type<Record<string, number>>(),
  },
);

// Generalizes county_registry across any country's administrative subdivisions
export const adminRegionsTable = sqliteTable(
  "admin_regions",
  {
    id: text("id").primaryKey(), // e.g. ke-county-047, ke-nairobi, ug-kampala
    countryCode: text("country_code").notNull().default("KE"),
    level: text("level", { enum: ["country", "region", "county", "city"] }).notNull().default("county"),
    code: text("code"),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    officialWebsite: text("official_website"),
    recruitmentUrl: text("recruitment_url"),
    announcementsUrl: text("announcements_url"),
    status: text("status").notNull().default("CONFIGURED"),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
    lastError: text("last_error"),
  },
);

// Preserved for backwards compatibility with existing county queries
export const countyRegistryTable = sqliteTable(
  "county_registry",
  {
    id: text("id").primaryKey(), // county-001 to county-047
    code: integer("code").notNull(), // 1 to 47
    name: text("name").notNull(),
    capital: text("capital"),
    officialWebsite: text("official_website"),
    recruitmentUrl: text("recruitment_url"),
    cpsbUrl: text("cpsb_url"),
    announcementsUrl: text("announcements_url"),
    discoveryQueries: text("discovery_queries", { mode: "json" }).$type<string[]>().default([]),
    status: text("status").notNull().default("CONFIGURED"),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    verifiedDestinations: text("verified_destinations", { mode: "json" }).$type<string[]>().default([]),
  },
);

export const jobProvenanceTable = sqliteTable(
  "job_provenance",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    sourceId: text("source_id").notNull(),
    sourceName: text("source_name").notNull(),
    originalUrl: text("original_url").notNull(),
    discoveredAt: integer("discovered_at", { mode: "timestamp" }).notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).default(false),
  },
);

export const discoveredSourcesTable = sqliteTable(
  "discovered_sources",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    suggestedName: text("suggested_name"),
    suggestedCategory: text("suggested_category"),
    evidence: text("evidence"),
    status: text("status").notNull().default("PROPOSED"), // PROPOSED, REVIEWING, APPROVED, REJECTED, REGISTERED
    ssrfChecked: integer("ssrf_checked", { mode: "boolean" }).default(false),
    robotsAllowed: integer("robots_allowed", { mode: "boolean" }),
    discoveredAt: integer("discovered_at", { mode: "timestamp" }).notNull(),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
    notes: text("notes"),

    // Automated qualification metrics
    testFetchOk: integer("test_fetch_ok", { mode: "boolean" }).default(false),
    listingsFound: integer("listings_found").default(0),
    sampleParseOk: integer("sample_parse_ok", { mode: "boolean" }).default(false),
    jsonLdFound: integer("json_ld_found", { mode: "boolean" }).default(false),
    suggestedCountries: text("suggested_countries", { mode: "json" }).$type<string[]>().default([]),
    suggestedIndustries: text("suggested_industries", { mode: "json" }).$type<string[]>().default([]),
    suggestedOccupationGroups: text("suggested_occupation_groups", { mode: "json" }).$type<string[]>().default([]),
  },
);

// Universal Occupation Taxonomy (ISCO-08 / O*NET aligned)
export const occupationTaxonomyTable = sqliteTable(
  "occupation_taxonomy",
  {
    id: text("id").primaryKey(),
    iscoCode: text("isco_code").notNull(), // e.g. "2211" General Medical Practitioner
    title: text("title").notNull(),
    parentId: text("parent_id"),
    synonyms: text("synonyms", { mode: "json" }).$type<string[]>().default([]),
    industries: text("industries", { mode: "json" }).$type<string[]>().default([]),
    typicalRegistrations: text("typical_registrations", { mode: "json" }).$type<string[]>().default([]), // e.g. ["KMPDC", "LSK", "ICPAK", "EBK"]
    searchKeywords: text("search_keywords", { mode: "json" }).$type<string[]>().default([]),
  },
);

// Dynamic per-profile source selection table (populated by SourceRouter)
export const profileSourceSelectionTable = sqliteTable(
  "profile_source_selection",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id").notNull(),
    sourceId: text("source_id").notNull(),
    mode: text("mode", { enum: ["AUTO", "PINNED", "EXCLUDED"] }).notNull().default("AUTO"),
    relevanceScore: real("relevance_score").notNull().default(50),
    reason: text("reason").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
);

// Observability run log for every source execution
export const sourceRunLogTable = sqliteTable(
  "source_run_log",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    sourceId: text("source_id").notNull(),
    profileId: text("profile_id"),
    query: text("query"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    durationMs: integer("duration_ms").default(0),
    fetched: integer("fetched").default(0),
    parsed: integer("parsed").default(0),
    validated: integer("validated").default(0),
    saved: integer("saved").default(0),
    rejectReasons: text("reject_reasons", { mode: "json" }).$type<Record<string, number>>(),
    error: text("error"),
  },
);

// Discard audit log for rejected job listings (purged after 14 days)
export const rejectedCandidatesTable = sqliteTable(
  "rejected_candidates",
  {
    id: text("id").primaryKey(),
    runId: text("run_id"),
    sourceId: text("source_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    reason: text("reason").notNull(), // e.g. "MISSING_EMPLOYER", "SEARCH_QUERY_STUB", "SHORT_DESCRIPTION", "EXPIRED"
    rawSnippet: text("raw_snippet"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
);

// Insert schemas and types
export const insertJobSourceSchema = createInsertSchema(jobSourcesTable);
export type InsertJobSource = typeof jobSourcesTable.$inferInsert;
export type JobSourceRecord = typeof jobSourcesTable.$inferSelect;

export const insertAdminRegionSchema = createInsertSchema(adminRegionsTable);
export type InsertAdminRegion = typeof adminRegionsTable.$inferInsert;
export type AdminRegionRecord = typeof adminRegionsTable.$inferSelect;

export const insertCountySchema = createInsertSchema(countyRegistryTable);
export type InsertCounty = typeof countyRegistryTable.$inferInsert;
export type CountyRecord = typeof countyRegistryTable.$inferSelect;

export const insertJobProvenanceSchema = createInsertSchema(jobProvenanceTable);
export type InsertJobProvenance = typeof jobProvenanceTable.$inferInsert;
export type JobProvenanceRecord = typeof jobProvenanceTable.$inferSelect;

export const insertDiscoveredSourceSchema = createInsertSchema(discoveredSourcesTable);
export type InsertDiscoveredSource = typeof discoveredSourcesTable.$inferInsert;
export type DiscoveredSourceRecord = typeof discoveredSourcesTable.$inferSelect;

export const insertOccupationTaxonomySchema = createInsertSchema(occupationTaxonomyTable);
export type InsertOccupationTaxonomy = typeof occupationTaxonomyTable.$inferInsert;
export type OccupationTaxonomyRecord = typeof occupationTaxonomyTable.$inferSelect;

export const insertProfileSourceSelectionSchema = createInsertSchema(profileSourceSelectionTable);
export type InsertProfileSourceSelection = typeof profileSourceSelectionTable.$inferInsert;
export type ProfileSourceSelectionRecord = typeof profileSourceSelectionTable.$inferSelect;

export const insertSourceRunLogSchema = createInsertSchema(sourceRunLogTable);
export type InsertSourceRunLog = typeof sourceRunLogTable.$inferInsert;
export type SourceRunLogRecord = typeof sourceRunLogTable.$inferSelect;

export const insertRejectedCandidateSchema = createInsertSchema(rejectedCandidatesTable);
export type InsertRejectedCandidate = typeof rejectedCandidatesTable.$inferInsert;
export type RejectedCandidateRecord = typeof rejectedCandidatesTable.$inferSelect;
