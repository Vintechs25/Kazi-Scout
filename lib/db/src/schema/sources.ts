import { createInsertSchema } from "drizzle-zod";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const jobSourcesTable = sqliteTable(
  "job_sources",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    category: text("category").notNull(), // KENYAN_JOB_BOARD, GOVERNMENT_NATIONAL, COUNTY_GOVERNMENT, NGO_INTERNATIONAL, TECH_EMPLOYER, BANK_FINTECH, RECRUITMENT_AGENCY, GLOBAL_REMOTE, AGGREGATOR, PUBLIC_COMMUNITY, AI_DISCOVERED
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
  },
);

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
  },
);

export const insertJobSourceSchema = createInsertSchema(jobSourcesTable);
export type InsertJobSource = typeof jobSourcesTable.$inferInsert;
export type JobSourceRecord = typeof jobSourcesTable.$inferSelect;

export const insertCountySchema = createInsertSchema(countyRegistryTable);
export type InsertCounty = typeof countyRegistryTable.$inferInsert;
export type CountyRecord = typeof countyRegistryTable.$inferSelect;

export const insertJobProvenanceSchema = createInsertSchema(jobProvenanceTable);
export type InsertJobProvenance = typeof jobProvenanceTable.$inferInsert;
export type JobProvenanceRecord = typeof jobProvenanceTable.$inferSelect;

export const insertDiscoveredSourceSchema = createInsertSchema(discoveredSourcesTable);
export type InsertDiscoveredSource = typeof discoveredSourcesTable.$inferInsert;
export type DiscoveredSourceRecord = typeof discoveredSourcesTable.$inferSelect;
