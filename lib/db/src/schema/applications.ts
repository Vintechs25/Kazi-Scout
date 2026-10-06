import { createInsertSchema } from "drizzle-zod";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { jobsTable } from "./jobs";

export const applicationsTable = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().references(() => jobsTable.id, { onDelete: "restrict" }),
    method: text("method", { enum: ["manual", "email", "browser"] }).notNull(),
    status: text("status", {
      enum: ["NEEDS_REVIEW", "PREPARING", "READY_TO_SUBMIT", "SUBMITTED", "EMAIL_SENT", "AWAITING_RESPONSE", "RECRUITER_RESPONSE", "INTERVIEW", "ASSESSMENT", "OFFER", "REJECTED", "WITHDRAWN", "BLOCKED"],
    }).notNull().default("NEEDS_REVIEW"),
    matchScore: integer("match_score"),
    appliedAt: integer("applied_at", { mode: "timestamp" }).notNull(),
    lastActivityAt: integer("last_activity_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("applications_job_id_unique").on(table.jobId),
    index("applications_status_idx").on(table.status),
    index("applications_applied_at_idx").on(table.appliedAt),
  ],
);

export const insertApplicationSchema = createInsertSchema(applicationsTable);
export type InsertApplication = typeof applicationsTable.$inferInsert;
export type Application = typeof applicationsTable.$inferSelect;
