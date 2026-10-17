import { createInsertSchema } from "drizzle-zod";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const searchProfilesTable = sqliteTable("search_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  keywords: text("keywords", { mode: "json" }).$type<string[]>().notNull().default([]),
  locations: text("locations", { mode: "json" }).$type<string[]>().notNull().default([]),
  remoteSetting: text("remote_setting", { enum: ["any", "remote", "hybrid", "onsite"] }).notNull().default("any"),
  minimumMatchScore: integer("minimum_match_score").notNull().default(80),
  minimumSalary: real("minimum_salary"),
  excludedKeywords: text("excluded_keywords", { mode: "json" }).$type<string[]>().notNull().default([]),
  employmentTypes: text("employment_types", { mode: "json" }).$type<string[]>().notNull().default([]),
  accountId: text("account_id"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const insertSearchProfileSchema = createInsertSchema(searchProfilesTable);
export type InsertSearchProfile = typeof searchProfilesTable.$inferInsert;
export type SearchProfile = typeof searchProfilesTable.$inferSelect;
