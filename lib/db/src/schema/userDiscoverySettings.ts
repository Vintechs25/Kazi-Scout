/**
 * User Discovery Settings Schema
 * Stores user preferences for job discovery and matching
 */

import { createInsertSchema } from "drizzle-zod";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// User role preferences for discovery
export const userRolePreferencesTable = sqliteTable(
  "user_role_preferences",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    roleTitle: text("role_title").notNull(),
    source: text("source", { enum: ["cv", "manual", "suggested"] }).notNull().default("cv"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    priority: text("priority", { enum: ["high", "medium", "low"] }).notNull().default("medium"),
    weight: integer("weight").notNull().default(50),
    searchQueries: text("search_queries", { mode: "json" }).$type<string[]>().default([]),
    keywords: text("keywords", { mode: "json" }).$type<string[]>().default([]),
    exclusionKeywords: text("exclusion_keywords", { mode: "json" }).$type<string[]>().default([]),
    minSalary: integer("min_salary"),
    maxSalary: integer("max_salary"),
    locationPreferences: text("location_preferences", { mode: "json" }).$type<string[]>().default([]),
    remoteOnly: integer("remote_only", { mode: "boolean" }).notNull().default(false),
    experienceLevel: text("experience_level", { mode: "json" }).$type<string[]>().default([]),
    industryPreferences: text("industry_preferences", { mode: "json" }).$type<string[]>().default([]),
    companySize: text("company_size", { mode: "json" }).$type<string[]>().default([]),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("user_role_preferences_account_idx").on(table.accountId),
    index("user_role_preferences_enabled_idx").on(table.enabled),
    index("user_role_preferences_priority_idx").on(table.priority),
  ],
);

// User discovery settings
export const userDiscoverySettingsTable = sqliteTable(
  "user_discovery_settings",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    // Role selection
    selectedRoleIds: text("selected_role_ids", { mode: "json" }).$type<string[]>().default([]),
    // Search settings
    searchFrequency: text("search_frequency", {
      enum: ["manual", "daily", "every_2_days", "weekly", "biweekly"],
    }).notNull().default("manual"),
    searchTimePreference: text("search_time_preference"), // HH:mm format
    maxJobsPerSearch: integer("max_jobs_per_search").notNull().default(100),
    autoApproveHighMatches: integer("auto_approve_high_matches", { mode: "boolean" }).notNull().default(false),
    minMatchScoreForAutoApprove: integer("min_match_score_for_auto_approve").notNull().default(85),
    // Source preferences
    preferredSourceIds: text("preferred_source_ids", { mode: "json" }).$type<string[]>().default([]),
    excludedSourceIds: text("excluded_source_ids", { mode: "json" }).$type<string[]>().default([]),
    enableAllKenyaSources: integer("enable_all_kenya_sources", { mode: "boolean" }).notNull().default(true),
    enableGlobalRemoteSources: integer("enable_global_remote_sources", { mode: "boolean" }).notNull().default(true),
    enableRecruitmentAgencies: integer("enable_recruitment_agencies", { mode: "boolean" }).notNull().default(true),
    enableStartups: integer("enable_startups", { mode: "boolean" }).notNull().default(true),
    enableFreelance: integer("enable_freelance", { mode: "boolean" }).notNull().default(false),
    // Filters
    defaultMinSalary: integer("default_min_salary"),
    defaultMaxSalary: integer("default_max_salary"),
    defaultLocations: text("default_locations", { mode: "json" }).$type<string[]>().default([]),
    defaultRemoteOnly: integer("default_remote_only", { mode: "boolean" }).notNull().default(false),
    defaultJobTypes: text("default_job_types", { mode: "json" }).$type<string[]>().default([]),
    defaultExperienceLevels: text("default_experience_levels", { mode: "json" }).$type<string[]>().default([]),
    defaultIndustries: text("default_industries", { mode: "json" }).$type<string[]>().default([]),
    defaultCompanies: text("default_companies", { mode: "json" }).$type<string[]>().default([]),
    defaultExcludeKeywords: text("default_exclude_keywords", { mode: "json" }).$type<string[]>().default([]),
    requireApplicationInstructions: integer("require_application_instructions", { mode: "boolean" }).notNull().default(true),
    // Advanced
    enableAISuggestions: integer("enable_ai_suggestions", { mode: "boolean" }).notNull().default(true),
    enableKeywordExpansion: integer("enable_keyword_expansion", { mode: "boolean" }).notNull().default(true),
    expansionKeywords: text("expansion_keywords", { mode: "json" }).$type<string[]>().default([]),
    // Notifications
    notifyNewJobs: integer("notify_new_jobs", { mode: "boolean" }).notNull().default(true),
    notificationChannels: text("notification_channels", { mode: "json" }).$type<("in_app" | "email" | "sms")[]>().default(["in_app"]),
    // Timing
    lastDiscoveryRun: integer("last_discovery_run", { mode: "timestamp" }),
    nextScheduledRun: integer("next_scheduled_run", { mode: "timestamp" }),
    // Statistics
    totalDiscoveries: integer("total_discoveries").notNull().default(0),
    totalJobsDiscovered: integer("total_jobs_discovered").notNull().default(0),
    totalMatches: integer("total_matches").notNull().default(0),
    totalApplications: integer("total_applications").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("user_discovery_settings_account_idx").on(table.accountId),
  ],
);

// CV parsing results (enhanced)
export const cvParsingResultsTable = sqliteTable(
  "cv_parsing_results",
  {
    id: text("id").primaryKey(),
    cvId: text("cv_id").notNull(),
    accountId: text("account_id").notNull(),
    // Parsing metadata
    parsingMethod: text("parsing_method", { enum: ["ai", "deterministic", "hybrid"] }).notNull(),
    providerUsed: text("provider_used"),
    modelUsed: text("model_used"),
    confidence: integer("confidence").notNull().default(70),
    parsedAt: integer("parsed_at", { mode: "timestamp" }).notNull(),
    // Personal info
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    location: text("location"),
    linkedIn: text("linked_in"),
    gitHub: text("gitHub"),
    portfolio: text("portfolio"),
    // Summary
    professionalSummary: text("professional_summary"),
    careerObjective: text("career_objective"),
    // Work experience (JSON)
    workExperience: text("work_experience", { mode: "json" }).$type<{
      roleTitle: string;
      company: string;
      startDate: string | null;
      endDate: string | null;
      isCurrent: boolean;
      description: string | null;
    }[]>().default([]),
    // Education (JSON)
    education: text("education", { mode: "json" }).$type<{
      institution: string;
      degree: string | null;
      fieldOfStudy: string | null;
      startDate: string | null;
      endDate: string | null;
    }[]>().default([]),
    // Certifications (JSON)
    certifications: text("certifications", { mode: "json" }).$type<{
      name: string;
      issuer: string | null;
      issueDate: string | null;
    }[]>().default([]),
    // Projects (JSON)
    projects: text("projects", { mode: "json" }).$type<{
      name: string;
      description: string | null;
      technologies: string[];
    }[]>().default([]),
    // Skills (JSON)
    skills: text("skills", { mode: "json" }).$type<{
      name: string;
      category: string;
      proficiency: string;
    }[]>().default([]),
    technicalSkills: text("technical_skills", { mode: "json" }).$type<string[]>().default([]),
    softSkills: text("soft_skills", { mode: "json" }).$type<string[]>().default([]),
    // Extracted roles (JSON)
    extractedRoles: text("extracted_roles", { mode: "json" }).$type<{
      roleTitle: string;
      confidence: number;
      source: string;
      sourceId: string;
      reasoning: string[];
      seniorityLevel: string;
      domain: string;
    }[]>().default([]),
    primaryRoles: text("primary_roles", { mode: "json" }).$type<string[]>().default([]),
    secondaryRoles: text("secondary_roles", { mode: "json" }).$type<string[]>().default([]),
    // Inferred data
    totalExperienceYears: integer("total_experience_years").notNull().default(0),
    totalExperienceMonths: integer("total_experience_months").notNull().default(0),
    currentRole: text("current_role"),
    currentCompany: text("current_company"),
    // Search data
    searchKeywords: text("search_keywords", { mode: "json" }).$type<string[]>().default([]),
    searchQueries: text("search_queries", { mode: "json" }).$type<string[]>().default([]),
    // Raw data
    fingerprint: text("fingerprint").notNull().unique(),
    rawTextLength: integer("raw_text_length").notNull().default(0),
    truncated: integer("truncated", { mode: "boolean" }).notNull().default(false),
    // Errors
    parsingErrors: text("parsing_errors", { mode: "json" }).$type<string[]>().default([]),
    warnings: text("warnings", { mode: "json" }).$type<string[]>().default([]),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("cv_parsing_results_cv_idx").on(table.cvId),
    index("cv_parsing_results_account_idx").on(table.accountId),
    index("cv_parsing_results_fingerprint_idx").on(table.fingerprint),
  ],
);

// Job requirement verification results
export const jobRequirementVerificationsTable = sqliteTable(
  "job_requirement_verifications",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull().unique(),
    accountId: text("account_id"),
    // Verification data
    hasClearInstructions: integer("has_clear_instructions", { mode: "boolean" }).notNull(),
    applicationMethod: text("application_method", {
      enum: ["online", "email", "portal", "walk_in", "phone", "post", "referral", "social", "unknown"],
    }).notNull().default("unknown"),
    applicationUrl: text("application_url"),
    applicationEmail: text("application_email"),
    applicationPhone: text("application_phone"),
    deadline: text("deadline"),
    deadlineDate: integer("deadline_date", { mode: "timestamp" }),
    isUrgent: integer("is_urgent", { mode: "boolean" }).notNull().default(false),
    daysUntilDeadline: integer("days_until_deadline"),
    requiredDocuments: text("required_documents", { mode: "json" }).$type<string[]>().default([]),
    eligibilityRequirements: text("eligibility_requirements", { mode: "json" }).$type<string[]>().default([]),
    hardRequirements: text("hard_requirements", { mode: "json" }).$type<string[]>().default([]),
    softRequirements: text("soft_requirements", { mode: "json" }).$type<string[]>().default([]),
    specialInstructions: text("special_instructions", { mode: "json" }).$type<string[]>().default([]),
    doNotApplyConditions: text("do_not_apply_conditions", { mode: "json" }).$type<string[]>().default([]),
    // Verification status
    isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
    verificationScore: integer("verification_score").notNull().default(0),
    verificationNotes: text("verification_notes", { mode: "json" }).$type<string[]>().default([]),
    verificationWarnings: text("verification_warnings", { mode: "json" }).$type<string[]>().default([]),
    // CV matching
    cvMatchScore: integer("cv_match_score"),
    cvMatchedSkills: text("cv_matched_skills", { mode: "json" }).$type<string[]>().default([]),
    cvMissingSkills: text("cv_missing_skills", { mode: "json" }).$type<string[]>().default([]),
    roleMatchScore: integer("role_match_score"),
    // User can apply
    canApply: integer("can_apply", { mode: "boolean" }).notNull().default(true),
    canApplyReason: text("can_apply_reason"),
    cannotApplyReason: text("cannot_apply_reason"),
    confidence: integer("confidence").notNull().default(0),
    // Metadata
    verifiedAt: integer("verified_at", { mode: "timestamp" }).notNull(),
    verificationMethod: text("verification_method", { enum: ["automatic", "manual", "ai"] }).notNull().default("automatic"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("job_requirement_verifications_job_idx").on(table.jobId),
    index("job_requirement_verifications_account_idx").on(table.accountId),
    index("job_requirement_verifications_is_verified_idx").on(table.isVerified),
    index("job_requirement_verifications_can_apply_idx").on(table.canApply),
  ],
);

// Discovery runs (audit log)
export const discoveryRunsTable = sqliteTable(
  "discovery_runs",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id"),
    // Run metadata
    runType: text("run_type", { enum: ["manual", "scheduled", "background"] }).notNull().default("manual"),
    triggeredBy: text("triggered_by"), // user_id or system
    // Results
    rolesSearched: text("roles_searched", { mode: "json" }).$type<string[]>().default([]),
    sourcesScraped: text("sources_scraped", { mode: "json" }).$type<string[]>().default([]),
    discovered: integer("discovered").notNull().default(0),
    duplicates: integer("duplicates").notNull().default(0),
    matched: integer("matched").notNull().default(0),
    highMatches: integer("high_matches").notNull().default(0),
    mediumMatches: integer("medium_matches").notNull().default(0),
    lowMatches: integer("low_matches").notNull().default(0),
    rejected: integer("rejected").notNull().default(0),
    errors: text("errors", { mode: "json" }).$type<string[]>().default([]),
    // Performance
    executionTime: integer("execution_time").notNull().default(0), // in ms
    // Settings used
    config: text("config", { mode: "json" }).$type<Record<string, any>>().default({}),
    // Timing
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("discovery_runs_account_idx").on(table.accountId),
    index("discovery_runs_started_at_idx").on(table.startedAt),
  ],
);

// Scheduled jobs (for cron-like scheduling)
export const scheduledJobsTable = sqliteTable(
  "scheduled_jobs",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    jobType: text("job_type").notNull(), // e.g., "discovery", "application_check", "cleanup"
    nextRunAt: integer("next_run_at", { mode: "timestamp" }).notNull(),
    interval: text("interval", { enum: ["hourly", "daily", "every_2_days", "weekly", "biweekly", "monthly"] }).notNull(),
    lastRunAt: integer("last_run_at", { mode: "timestamp" }),
    lastSuccessAt: integer("last_success_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("scheduled_jobs_account_idx").on(table.accountId),
    index("scheduled_jobs_next_run_at_idx").on(table.nextRunAt),
    index("scheduled_jobs_is_active_idx").on(table.isActive),
  ],
);

export const insertUserRolePreferenceSchema = createInsertSchema(userRolePreferencesTable);
export type InsertUserRolePreference = typeof userRolePreferencesTable.$inferInsert;
export type UserRolePreferenceRecord = typeof userRolePreferencesTable.$inferSelect;

export const insertUserDiscoverySettingsSchema = createInsertSchema(userDiscoverySettingsTable);
export type InsertUserDiscoverySettings = typeof userDiscoverySettingsTable.$inferInsert;
export type UserDiscoverySettingsRecord = typeof userDiscoverySettingsTable.$inferSelect;

export const insertCvParsingResultSchema = createInsertSchema(cvParsingResultsTable);
export type InsertCvParsingResult = typeof cvParsingResultsTable.$inferInsert;
export type CvParsingResultRecord = typeof cvParsingResultsTable.$inferSelect;

export const insertJobRequirementVerificationSchema = createInsertSchema(jobRequirementVerificationsTable);
export type InsertJobRequirementVerification = typeof jobRequirementVerificationsTable.$inferInsert;
export type JobRequirementVerificationRecord = typeof jobRequirementVerificationsTable.$inferSelect;

export const insertDiscoveryRunSchema = createInsertSchema(discoveryRunsTable);
export type InsertDiscoveryRun = typeof discoveryRunsTable.$inferInsert;
export type DiscoveryRunRecord = typeof discoveryRunsTable.$inferSelect;

export const insertScheduledJobSchema = createInsertSchema(scheduledJobsTable);
export type InsertScheduledJob = typeof scheduledJobsTable.$inferInsert;
export type ScheduledJobRecord = typeof scheduledJobsTable.$inferSelect;
