import { createInsertSchema } from "drizzle-zod";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const candidateProfilesTable = sqliteTable("candidate_profiles", {
  id: text("id").primaryKey().$defaultFn(() => "primary"),
  fullName: text("full_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  country: text("country").notNull().default(""),
  city: text("city").notNull().default(""),
  timezone: text("timezone").notNull().default(""),
  targetRoles: text("target_roles", { mode: "json" }).$type<string[]>().notNull().default([]),
  skills: text("skills", { mode: "json" }).$type<string[]>().notNull().default([]),
  technologies: text("technologies", { mode: "json" }).$type<string[]>().notNull().default([]),
  yearsExperience: real("years_experience"),
  education: text("education", { mode: "json" }).$type<string[]>().notNull().default([]),
  certifications: text("certifications", { mode: "json" }).$type<string[]>().notNull().default([]),
  industries: text("industries", { mode: "json" }).$type<string[]>().notNull().default([]),
  languages: text("languages", { mode: "json" }).$type<string[]>().notNull().default([]),
  preferredLocations: text("preferred_locations", { mode: "json" }).$type<string[]>().notNull().default([]),
  workModes: text("work_modes", { mode: "json" }).$type<Array<"remote" | "hybrid" | "onsite">>().notNull().default([]),
  relocation: integer("relocation", { mode: "boolean" }).notNull().default(false),
  visaSponsorship: integer("visa_sponsorship", { mode: "boolean" }).notNull().default(false),
  minimumSalary: real("minimum_salary"),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const insertCandidateProfileSchema = createInsertSchema(candidateProfilesTable);
export type InsertCandidateProfile = typeof candidateProfilesTable.$inferInsert;
export type CandidateProfile = typeof candidateProfilesTable.$inferSelect;
