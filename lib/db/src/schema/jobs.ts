import { createInsertSchema } from "drizzle-zod";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const jobsTable = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    normalizedCompany: text("normalized_company").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    location: text("location"),
    normalizedLocation: text("normalized_location").notNull(),
    remote: integer("remote", { mode: "boolean" }).notNull().default(false),
    salary: text("salary"),
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    externalJobId: text("external_job_id"),
    description: text("description").notNull(),
    fingerprint: text("fingerprint").notNull(),
    matchScore: integer("match_score"),
    status: text("status", {
      enum: ["DISCOVERED", "MATCHED", "SHORTLISTED", "REJECTED", "IGNORED", "NEEDS_REVIEW"],
    }).notNull().default("DISCOVERED"),
    discoveredAt: integer("discovered_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("jobs_fingerprint_unique").on(table.fingerprint),
    uniqueIndex("jobs_source_external_id_unique").on(table.source, table.externalJobId),
    index("jobs_company_idx").on(table.normalizedCompany),
    index("jobs_title_idx").on(table.normalizedTitle),
    index("jobs_location_idx").on(table.normalizedLocation),
    index("jobs_status_idx").on(table.status),
    index("jobs_match_score_idx").on(table.matchScore),
    index("jobs_discovered_at_idx").on(table.discoveredAt),
  ],
);

export const insertJobSchema = createInsertSchema(jobsTable);
export type InsertJob = typeof jobsTable.$inferInsert;
export type JobRecord = typeof jobsTable.$inferSelect;
