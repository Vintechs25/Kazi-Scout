/**
 * Discovery Role Approval System
 * 
 * This module enables users to:
 * 1. View all roles extracted from their CVs
 * 2. Select which roles to use for job discovery
 * 3. Set priority levels for different roles
 * 4. Add custom roles to search for
 * 5. Save and manage their role preferences
 * 
 * Uses database storage for persistence
 */

import { randomUUID } from "node:crypto";
import { z } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { eq, and, desc, or } from "drizzle-orm";
import {
  userRolePreferencesTable,
  userDiscoverySettingsTable,
  cvParsingResultsTable,
  candidateProfilesTable,
  type UserRolePreferenceRecord,
  type UserDiscoverySettingsRecord,
  type CvParsingResultRecord,
  type InsertUserRolePreference,
  type InsertUserDiscoverySettings,
  insertUserRolePreferenceSchema,
  insertUserDiscoverySettingsSchema,
} from "@workspace/db";
import { getParsedCv } from "./cv-parser-enhanced";

// ============================================================================
// SCHEMAS
// ============================================================================

const userRolePreferenceSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  roleTitle: z.string(),
  source: z.enum(["cv", "manual", "suggested"]),
  enabled: z.boolean().default(true),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  weight: z.number().min(1).max(100).default(50),
  searchQueries: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  exclusionKeywords: z.array(z.string()).default([]),
  minSalary: z.number().nullable().default(null),
  maxSalary: z.number().nullable().default(null),
  locationPreferences: z.array(z.string()).default([]),
  remoteOnly: z.boolean().default(false),
  experienceLevel: z.array(z.string()).default([]),
  industryPreferences: z.array(z.string()).default([]),
  companySize: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const userDiscoverySettingsSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  // Role selection
  selectedRoleIds: z.array(z.string()).default([]),
  // Search settings
  searchFrequency: z.enum(["manual", "daily", "every_2_days", "weekly", "biweekly"]).default("manual"),
  searchTimePreference: z.string().nullable().default(null), // HH:mm format
  maxJobsPerSearch: z.number().min(10).max(500).default(100),
  autoApproveHighMatches: z.boolean().default(false),
  minMatchScoreForAutoApprove: z.number().min(0).max(100).default(85),
  // Source preferences
  preferredSourceIds: z.array(z.string()).default([]),
  excludedSourceIds: z.array(z.string()).default([]),
  enableAllKenyaSources: z.boolean().default(true),
  enableGlobalRemoteSources: z.boolean().default(true),
  enableRecruitmentAgencies: z.boolean().default(true),
  enableStartups: z.boolean().default(true),
  enableFreelance: z.boolean().default(false),
  // Filters
  defaultFilters: z.object({
    minSalary: z.number().nullable().default(null),
    maxSalary: z.number().nullable().default(null),
    locations: z.array(z.string()).default([]),
    remoteOnly: z.boolean().default(false),
    jobTypes: z.array(z.string()).default([]),
    experienceLevels: z.array(z.string()).default([]),
    industries: z.array(z.string()).default([]),
    companies: z.array(z.string()).default([]),
    excludeKeywords: z.array(z.string()).default([]),
  }).default({}),
  // Advanced
  enableAISuggestions: z.boolean().default(true),
  enableKeywordExpansion: z.boolean().default(true),
  expansionKeywords: z.array(z.string()).default([]),
  requireApplicationInstructions: z.boolean().default(true),
  // Notifications
  notifyNewJobs: z.boolean().default(true),
  notificationChannels: z.array(z.enum(["in_app", "email", "sms"])).default(["in_app"]),
  // Timing
  lastDiscoveryRun: z.string().nullable().default(null),
  nextScheduledRun: z.string().nullable().default(null),
  // Statistics
  totalDiscoveries: z.number().default(0),
  totalJobsDiscovered: z.number().default(0),
  totalMatches: z.number().default(0),
  totalApplications: z.number().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type UserRolePreference = z.infer<typeof userRolePreferenceSchema>;
export type UserDiscoverySettings = z.infer<typeof userDiscoverySettingsSchema>;

// ============================================================================
// DATABASE HELPER FUNCTIONS
// ============================================================================

/**
 * Convert database record to UserRolePreference
 */
function dbToUserRolePreference(record: UserRolePreferenceRecord): UserRolePreference {
  return {
    id: record.id,
    accountId: record.accountId,
    roleTitle: record.roleTitle,
    source: record.source as "cv" | "manual" | "suggested",
    enabled: Boolean(record.enabled),
    priority: record.priority as "high" | "medium" | "low",
    weight: record.weight,
    searchQueries: record.searchQueries || [],
    keywords: record.keywords || [],
    exclusionKeywords: record.exclusionKeywords || [],
    minSalary: record.minSalary || null,
    maxSalary: record.maxSalary || null,
    locationPreferences: record.locationPreferences || [],
    remoteOnly: Boolean(record.remoteOnly),
    experienceLevel: record.experienceLevel || [],
    industryPreferences: record.industryPreferences || [],
    companySize: record.companySize || [],
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
  };
}

/**
 * Convert UserRolePreference to database insert/update object
 */
function userRolePreferenceToDb(
  preference: UserRolePreference,
): InsertUserRolePreference {
  return {
    id: preference.id,
    accountId: preference.accountId,
    roleTitle: preference.roleTitle,
    source: preference.source,
    enabled: preference.enabled ? 1 : 0,
    priority: preference.priority,
    weight: preference.weight,
    searchQueries: preference.searchQueries,
    keywords: preference.keywords,
    exclusionKeywords: preference.exclusionKeywords,
    minSalary: preference.minSalary ?? null,
    maxSalary: preference.maxSalary ?? null,
    locationPreferences: preference.locationPreferences,
    remoteOnly: preference.remoteOnly ? 1 : 0,
    experienceLevel: preference.experienceLevel,
    industryPreferences: preference.industryPreferences,
    companySize: preference.companySize,
    createdAt: new Date(preference.createdAt || Date.now()),
    updatedAt: new Date(preference.updatedAt || Date.now()),
  } as any;
}

/**
 * Convert database record to UserDiscoverySettings
 */
function dbToUserDiscoverySettings(record: UserDiscoverySettingsRecord): UserDiscoverySettings {
  return {
    id: record.id,
    accountId: record.accountId,
    selectedRoleIds: record.selectedRoleIds || [],
    searchFrequency: record.searchFrequency as "manual" | "daily" | "every_2_days" | "weekly" | "biweekly",
    searchTimePreference: record.searchTimePreference || null,
    maxJobsPerSearch: record.maxJobsPerSearch,
    autoApproveHighMatches: Boolean(record.autoApproveHighMatches),
    minMatchScoreForAutoApprove: record.minMatchScoreForAutoApprove,
    preferredSourceIds: record.preferredSourceIds || [],
    excludedSourceIds: record.excludedSourceIds || [],
    enableAllKenyaSources: Boolean(record.enableAllKenyaSources),
    enableGlobalRemoteSources: Boolean(record.enableGlobalRemoteSources),
    enableRecruitmentAgencies: Boolean(record.enableRecruitmentAgencies),
    enableStartups: Boolean(record.enableStartups),
    enableFreelance: Boolean(record.enableFreelance),
    defaultFilters: {
      minSalary: record.defaultMinSalary || null,
      maxSalary: record.defaultMaxSalary || null,
      locations: record.defaultLocations || [],
      remoteOnly: Boolean(record.defaultRemoteOnly),
      jobTypes: record.defaultJobTypes || [],
      experienceLevels: record.defaultExperienceLevels || [],
      industries: record.defaultIndustries || [],
      companies: record.defaultCompanies || [],
      excludeKeywords: record.defaultExcludeKeywords || [],
    },
    enableAISuggestions: Boolean(record.enableAISuggestions),
    enableKeywordExpansion: Boolean(record.enableKeywordExpansion),
    expansionKeywords: record.expansionKeywords || [],
    requireApplicationInstructions: Boolean(record.requireApplicationInstructions),
    notifyNewJobs: Boolean(record.notifyNewJobs),
    notificationChannels: (record.notificationChannels || ["in_app"]) as ("in_app" | "email" | "sms")[],
    lastDiscoveryRun: record.lastDiscoveryRun ? new Date(record.lastDiscoveryRun).toISOString() : null,
    nextScheduledRun: record.nextScheduledRun ? new Date(record.nextScheduledRun).toISOString() : null,
    totalDiscoveries: record.totalDiscoveries,
    totalJobsDiscovered: record.totalJobsDiscovered,
    totalMatches: record.totalMatches,
    totalApplications: record.totalApplications,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
  };
}

/**
 * Convert UserDiscoverySettings to database insert/update object
 */
function userDiscoverySettingsToDb(
  settings: UserDiscoverySettings,
): InsertUserDiscoverySettings {
  return {
    id: settings.id,
    accountId: settings.accountId,
    selectedRoleIds: settings.selectedRoleIds,
    searchFrequency: settings.searchFrequency,
    searchTimePreference: settings.searchTimePreference ?? null,
    maxJobsPerSearch: settings.maxJobsPerSearch,
    autoApproveHighMatches: settings.autoApproveHighMatches ? 1 : 0,
    minMatchScoreForAutoApprove: settings.minMatchScoreForAutoApprove,
    preferredSourceIds: settings.preferredSourceIds,
    excludedSourceIds: settings.excludedSourceIds,
    enableAllKenyaSources: settings.enableAllKenyaSources ? 1 : 0,
    enableGlobalRemoteSources: settings.enableGlobalRemoteSources ? 1 : 0,
    enableRecruitmentAgencies: settings.enableRecruitmentAgencies ? 1 : 0,
    enableStartups: settings.enableStartups ? 1 : 0,
    enableFreelance: settings.enableFreelance ? 1 : 0,
    defaultMinSalary: settings.defaultFilters?.minSalary ?? null,
    defaultMaxSalary: settings.defaultFilters?.maxSalary ?? null,
    defaultLocations: settings.defaultFilters?.locations ?? [],
    defaultRemoteOnly: settings.defaultFilters?.remoteOnly ? 1 : 0,
    defaultJobTypes: settings.defaultFilters?.jobTypes ?? [],
    defaultExperienceLevels: settings.defaultFilters?.experienceLevels ?? [],
    defaultIndustries: settings.defaultFilters?.industries ?? [],
    defaultCompanies: settings.defaultFilters?.companies ?? [],
    defaultExcludeKeywords: settings.defaultFilters?.excludeKeywords ?? [],
    requireApplicationInstructions: settings.requireApplicationInstructions ? 1 : 0,
    enableAISuggestions: settings.enableAISuggestions ? 1 : 0,
    enableKeywordExpansion: settings.enableKeywordExpansion ? 1 : 0,
    expansionKeywords: settings.expansionKeywords ?? [],
    notifyNewJobs: settings.notifyNewJobs ? 1 : 0,
    notificationChannels: settings.notificationChannels ?? ["in_app"],
    lastDiscoveryRun: settings.lastDiscoveryRun ? new Date(settings.lastDiscoveryRun) : null,
    nextScheduledRun: settings.nextScheduledRun ? new Date(settings.nextScheduledRun) : null,
    totalDiscoveries: settings.totalDiscoveries ?? 0,
    totalJobsDiscovered: settings.totalJobsDiscovered ?? 0,
    totalMatches: settings.totalMatches ?? 0,
    totalApplications: settings.totalApplications ?? 0,
    createdAt: new Date(settings.createdAt || Date.now()),
    updatedAt: new Date(settings.updatedAt || Date.now()),
  } as any;
}

// ============================================================================
// EXTRACTED ROLES FROM CV
// ============================================================================

/**
 * Get extracted roles from all CVs for an account
 */
export async function getExtractedRolesFromAllCvs(
  accountId?: string,
): Promise<{
  roles: { roleTitle: string; confidence: number; source: string; sourceId: string; reasoning: string[]; seniorityLevel: string; domain: string }[];
  primaryRoles: string[];
  allRoles: string[];
}> {
  // Try to get from CV parsing results first
  if (accountId) {
    const cvResults = await db
      .select()
      .from(cvParsingResultsTable)
      .where(eq(cvParsingResultsTable.accountId, accountId))
      .orderBy(desc(cvParsingResultsTable.updatedAt))
      .limit(1);
    
    if (cvResults.length > 0) {
      const result = cvResults[0];
      try {
        const extractedRoles = result.extractedRoles || [];
        const primaryRoles = result.primaryRoles || [];
        const allRoles = result.secondaryRoles || [];
        
        if (extractedRoles.length > 0) {
          return {
            roles: extractedRoles,
            primaryRoles: Array.isArray(primaryRoles) ? primaryRoles : [],
            allRoles: Array.isArray(allRoles) ? allRoles : [],
          };
        }
      } catch (err) {
        console.warn("[Role Approval] Error parsing CV results:", err);
      }
    }
  }
  
  // Fallback: return empty
  return { roles: [], primaryRoles: [], allRoles: [] };
}

/**
 * Generate search queries from roles
 */
function generateSearchQueriesFromRoles(roles: string[]): string[] {
  const queries: string[] = [];
  
  for (const role of roles) {
    const roleLower = role.toLowerCase();
    
    // Basic queries
    queries.push(role);
    queries.push(`${role} jobs`);
    queries.push(`${role} job`);
    queries.push(`${role} vacancy`);
    queries.push(`${role} vacancies`);
    
    // Location variants
    const locations = ["Kenya", "Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Remote", "Worldwide"];
    for (const loc of locations) {
      queries.push(`${role} ${loc}`);
      queries.push(`${role} job ${loc}`);
    }
    
    // Experience level variants
    const levels = ["Junior", "Entry Level", "0-2 years", "0-5 years", "Fresher", "Trainee", "Intern"];
    for (const level of levels) {
      queries.push(`${role} ${level}`);
    }
  }
  
  return [...new Set(queries)];
}

// ============================================================================
// ROLE MANAGEMENT
// ============================================================================

/**
 * Initialize role preferences from CV for a user
 */
export async function initializeRolePreferencesFromCv(
  accountId: string,
): Promise<UserRolePreference[]> {
  // Query DB directly to prevent recursion with getUserRolePreferences
  const existingDbRecords = await db
    .select()
    .from(userRolePreferencesTable)
    .where(eq(userRolePreferencesTable.accountId, accountId));
  const existingRoleTitles = new Set(existingDbRecords.map(p => p.roleTitle.toLowerCase()));
  
  // Get roles from CV
  const { roles, primaryRoles } = await getExtractedRolesFromAllCvs(accountId);
  let candidateRoles = [...primaryRoles];

  // If no CV parsing results found, fallback to candidate profile target roles
  if (candidateRoles.length === 0) {
    try {
      const profiles = await db
        .select()
        .from(candidateProfilesTable)
        .limit(1);
      if (profiles.length > 0) {
        const targetRoles = profiles[0].targetRoles;
        if (Array.isArray(targetRoles) && targetRoles.length > 0) {
          candidateRoles.push(...targetRoles);
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // If still empty, return empty array (do not inject biased role assumptions)
  if (candidateRoles.length === 0) {
    return [];
  }
  
  // Create preferences for each unique role
  const preferences: UserRolePreference[] = [];
  const uniquePrimaryRoles = [...new Set(candidateRoles)];
  
  for (let i = 0; i < uniquePrimaryRoles.length; i++) {
    const roleTitle = uniquePrimaryRoles[i];
    
    // Skip if already exists
    if (existingRoleTitles.has(roleTitle.toLowerCase())) {
      continue;
    }
    
    // Find matching role from extracted roles for confidence
    const matchingRole = roles.find(r => r.roleTitle === roleTitle);
    const weight = matchingRole ? Math.max(100 - (i * 15), 20) : 50;
    
    const preference: UserRolePreference = {
      id: randomUUID(),
      accountId,
      roleTitle,
      source: "cv",
      enabled: i < 3, // Enable top 3 by default
      priority: i < 3 ? "high" : i < 6 ? "medium" : "low",
      weight,
      searchQueries: generateSearchQueriesFromRoles([roleTitle]),
      keywords: [],
      exclusionKeywords: [],
      minSalary: null,
      maxSalary: null,
      locationPreferences: ["Kenya", "Nairobi", "Remote"],
      remoteOnly: false,
      experienceLevel: ["Entry Level", "Junior", "0-2 years", "0-5 years"],
      industryPreferences: [],
      companySize: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    preferences.push(preference);
    
    // Save to database
    await db.insert(userRolePreferencesTable)
      .values(userRolePreferenceToDb(preference));
  }
  
  return preferences;
}

const LEGACY_BIASED_ROLES = new Set([
  "it support specialist",
  "ict officer",
  "junior systems administrator",
  "junior software developer",
  "help desk technician",
  "it intern",
]);

/**
 * Get all role preferences for a user, dynamically prioritizing the candidate profile's actual verified target roles
 */
export async function getUserRolePreferences(
  accountId: string,
): Promise<UserRolePreference[]> {
  // 1. Fetch Candidate Profile for this user (checking accountId, "primary", or "local")
  let profileTargetRoles: string[] = [];
  try {
    const candidateProfiles = await db
      .select({ targetRoles: candidateProfilesTable.targetRoles })
      .from(candidateProfilesTable)
      .where(or(
        eq(candidateProfilesTable.id, accountId),
        eq(candidateProfilesTable.id, "primary"),
        eq(candidateProfilesTable.id, "local")
      ))
      .limit(1);

    if (candidateProfiles.length > 0 && Array.isArray(candidateProfiles[0].targetRoles)) {
      profileTargetRoles = candidateProfiles[0].targetRoles
        .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
        .map(r => r.trim());
    }
  } catch (err) {
    console.warn("[Role Approval] Error checking candidate profile:", err);
  }

  // 2. Query existing records for this account
  let records = await db
    .select()
    .from(userRolePreferencesTable)
    .where(or(
      eq(userRolePreferencesTable.accountId, accountId),
      eq(userRolePreferencesTable.accountId, "local")
    ))
    .orderBy(desc(userRolePreferencesTable.updatedAt));

  // 3. Detect if all existing records are obsolete hardcoded IT legacy placeholders
  const hasOnlyLegacyBiased = records.length > 0 && records.every(r => 
    LEGACY_BIASED_ROLES.has(r.roleTitle.toLowerCase().trim())
  );

  // If candidate profile has specified target roles and either:
  // - records are empty, OR
  // - records only consist of the obsolete legacy IT rows, OR
  // - none of the profile target roles are present in the preferences
  if (profileTargetRoles.length > 0 && (records.length === 0 || hasOnlyLegacyBiased)) {
    // Purge the obsolete legacy records
    if (hasOnlyLegacyBiased) {
      await db
        .delete(userRolePreferencesTable)
        .where(or(
          eq(userRolePreferencesTable.accountId, accountId),
          eq(userRolePreferencesTable.accountId, "local"),
          eq(userRolePreferencesTable.accountId, "primary")
        ))
        .catch(() => {});
    }

    // Auto-populate from candidate profile's verified target roles!
    const newPreferences: UserRolePreference[] = [];
    const now = new Date().toISOString();
    for (let i = 0; i < profileTargetRoles.length; i++) {
      const roleTitle = profileTargetRoles[i];
      const pref: UserRolePreference = {
        id: randomUUID(),
        accountId,
        roleTitle,
        source: "manual",
        enabled: i < 5,
        priority: i < 2 ? "high" : i < 4 ? "medium" : "low",
        weight: Math.max(100 - i * 15, 20),
        searchQueries: generateSearchQueriesFromRoles([roleTitle]),
        keywords: [],
        exclusionKeywords: [],
        minSalary: null,
        maxSalary: null,
        locationPreferences: ["Kenya", "Remote"],
        remoteOnly: false,
        experienceLevel: ["All Levels", "Mid-Level", "Senior"],
        industryPreferences: [],
        companySize: [],
        createdAt: now,
        updatedAt: now,
      };
      newPreferences.push(pref);
      await db.insert(userRolePreferencesTable).values(userRolePreferenceToDb(pref)).catch(() => {});
    }
    return newPreferences;
  }

  if (records.length === 0) {
    // Initialize from CV if not exists
    const initialized = await initializeRolePreferencesFromCv(accountId);
    if (initialized.length > 0) {
      return initialized;
    }
    // Final fallback to candidate profile roles
    if (profileTargetRoles.length > 0) {
      return profileTargetRoles.map((roleTitle, i) => ({
        id: randomUUID(),
        accountId,
        roleTitle,
        source: "manual",
        enabled: true,
        priority: "high",
        weight: 80,
        searchQueries: generateSearchQueriesFromRoles([roleTitle]),
        keywords: [],
        exclusionKeywords: [],
        minSalary: null,
        maxSalary: null,
        locationPreferences: ["Kenya", "Remote"],
        remoteOnly: false,
        experienceLevel: ["All Levels", "Mid-Level", "Senior"],
        industryPreferences: [],
        companySize: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    }
    return [];
  }

  return records.map(dbToUserRolePreference);
}

/**
 * Get enabled roles for a user (used for discovery)
 * Prioritizes candidate profile's target roles if enabled roles are empty or only legacy biased
 */
export async function getUserEnabledRoles(
  accountId: string,
): Promise<{
  roles: string[];
  preferences: UserRolePreference[];
  searchQueries: string[];
}> {
  const preferences = await getUserRolePreferences(accountId);
  let enabledRoles = preferences
    .filter(p => p.enabled)
    .sort((a, b) => {
      // Sort by priority then weight
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority] || b.weight - a.weight;
    });

  // Filter out any legacy biased IT roles if candidate profile has target roles
  try {
    const [cp] = await db
      .select({ targetRoles: candidateProfilesTable.targetRoles })
      .from(candidateProfilesTable)
      .where(or(
        eq(candidateProfilesTable.id, accountId),
        eq(candidateProfilesTable.id, "primary"),
        eq(candidateProfilesTable.id, "local")
      ))
      .limit(1);

    const cpRoles = Array.isArray(cp?.targetRoles)
      ? cp.targetRoles.filter((r): r is string => Boolean(r && typeof r === "string" && r.trim().length > 0))
      : [];

    if (cpRoles.length > 0) {
      const filtered = enabledRoles.filter(p => !LEGACY_BIASED_ROLES.has(p.roleTitle.toLowerCase().trim()));
      if (filtered.length > 0) {
        enabledRoles = filtered;
      } else {
        // Use candidate profile target roles directly!
        const searchQueries = generateSearchQueriesFromRoles(cpRoles);
        return {
          roles: cpRoles,
          preferences: [],
          searchQueries,
        };
      }
    }
  } catch (err) {
    console.warn("[Role Approval] Error checking candidate profile in getUserEnabledRoles:", err);
  }
  
  if (enabledRoles.length === 0 && preferences.length > 0) {
    enabledRoles = preferences.slice(0, 5);
  }

  if (enabledRoles.length === 0) {
    const fallback = ["Software Developer", "IT Specialist", "Project Coordinator"];
    return {
      roles: fallback,
      preferences: [],
      searchQueries: generateSearchQueriesFromRoles(fallback),
    };
  }
  
  const searchQueries = enabledRoles.flatMap(p => p.searchQueries);
  
  return {
    roles: enabledRoles.map(p => p.roleTitle),
    preferences: enabledRoles,
    searchQueries,
  };
}

/**
 * Update a role preference
 */
export async function updateRolePreference(
  accountId: string,
  roleId: string,
  updates: Partial<Omit<UserRolePreference, "id" | "accountId" | "createdAt">>,
): Promise<UserRolePreference | null> {
  const preferences = await getUserRolePreferences(accountId);
  const preference = preferences.find(p => p.id === roleId);
  
  if (!preference) return null;
  
  const updatedPreference: UserRolePreference = {
    ...preference,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  // Update in database
  await db
    .update(userRolePreferencesTable)
    .set(userRolePreferenceToDb(updatedPreference))
    .where(and(
      eq(userRolePreferencesTable.id, roleId),
      eq(userRolePreferencesTable.accountId, accountId)
    ));
  
  return updatedPreference;
}

/**
 * Add a custom role
 */
export async function addCustomRole(
  accountId: string,
  roleTitle: string,
): Promise<UserRolePreference> {
  const preferences = await getUserRolePreferences(accountId);
  
  // Check if role already exists
  const existing = preferences.find(p => p.roleTitle.toLowerCase() === roleTitle.toLowerCase());
  if (existing) {
    return existing;
  }
  
  const newPreference: UserRolePreference = {
    id: randomUUID(),
    accountId,
    roleTitle,
    source: "manual",
    enabled: true,
    priority: "medium",
    weight: 50,
    searchQueries: generateSearchQueriesFromRoles([roleTitle]),
    keywords: [],
    exclusionKeywords: [],
    minSalary: null,
    maxSalary: null,
    locationPreferences: ["Kenya", "Nairobi", "Remote"],
    remoteOnly: false,
    experienceLevel: ["Entry Level", "Junior"],
    industryPreferences: [],
    companySize: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  // Save to database
  await db.insert(userRolePreferencesTable)
    .values(userRolePreferenceToDb(newPreference));
  
  return newPreference;
}

/**
 * Remove a role preference
 */
export async function removeRolePreference(
  accountId: string,
  roleId: string,
): Promise<boolean> {
  const [record] = await db
    .select()
    .from(userRolePreferencesTable)
    .where(and(
      eq(userRolePreferencesTable.id, roleId),
      eq(userRolePreferencesTable.accountId, accountId)
    ))
    .limit(1);
  
  if (!record) return false;
  
  await db
    .delete(userRolePreferencesTable)
    .where(eq(userRolePreferencesTable.id, roleId));
  
  return true;
}

/**
 * Enable/disable a role
 */
export async function toggleRoleEnabled(
  accountId: string,
  roleId: string,
  enabled: boolean,
): Promise<UserRolePreference | null> {
  return updateRolePreference(accountId, roleId, { enabled });
}

/**
 * Set role priority
 */
export async function setRolePriority(
  accountId: string,
  roleId: string,
  priority: "high" | "medium" | "low",
): Promise<UserRolePreference | null> {
  return updateRolePreference(accountId, roleId, { priority });
}

/**
 * Set role weight (1-100)
 */
export async function setRoleWeight(
  accountId: string,
  roleId: string,
  weight: number,
): Promise<UserRolePreference | null> {
  return updateRolePreference(accountId, roleId, { weight: Math.max(1, Math.min(100, weight)) });
}

// ============================================================================
// DISCOVERY SETTINGS
// ============================================================================

/**
 * Get or create discovery settings for a user
 */
export async function getUserDiscoverySettings(
  accountId: string,
): Promise<UserDiscoverySettings> {
  const [record] = await db
    .select()
    .from(userDiscoverySettingsTable)
    .where(eq(userDiscoverySettingsTable.accountId, accountId))
    .limit(1);
  
  if (!record) {
    const settings: UserDiscoverySettings = {
      id: randomUUID(),
      accountId,
      selectedRoleIds: [],
      searchFrequency: "manual",
      searchTimePreference: null,
      maxJobsPerSearch: 100,
      autoApproveHighMatches: false,
      minMatchScoreForAutoApprove: 85,
      preferredSourceIds: [],
      excludedSourceIds: [],
      enableAllKenyaSources: true,
      enableGlobalRemoteSources: true,
      enableRecruitmentAgencies: true,
      enableStartups: true,
      enableFreelance: false,
      defaultFilters: {
        locations: [],
        minSalary: null,
        maxSalary: null,
        remoteOnly: false,
        jobTypes: [],
        experienceLevels: [],
        industries: [],
        companies: [],
        excludeKeywords: [],
      },
      enableAISuggestions: true,
      enableKeywordExpansion: true,
      expansionKeywords: [],
      requireApplicationInstructions: true,
      notifyNewJobs: true,
      notificationChannels: ["in_app"],
      lastDiscoveryRun: null,
      nextScheduledRun: null,
      totalDiscoveries: 0,
      totalJobsDiscovered: 0,
      totalMatches: 0,
      totalApplications: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    // Save to database
    await db.insert(userDiscoverySettingsTable)
      .values(userDiscoverySettingsToDb(settings));
    
    return settings;
  }
  
  return dbToUserDiscoverySettings(record);
}

/**
 * Update discovery settings
 */
export async function updateDiscoverySettings(
  accountId: string,
  updates: Partial<Omit<UserDiscoverySettings, "id" | "accountId" | "createdAt">>,
): Promise<UserDiscoverySettings> {
  const settings = await getUserDiscoverySettings(accountId);
  
  const updatedSettings: UserDiscoverySettings = {
    ...settings,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  // Update in database
  await db
    .update(userDiscoverySettingsTable)
    .set(userDiscoverySettingsToDb(updatedSettings))
    .where(eq(userDiscoverySettingsTable.accountId, accountId));
  
  return updatedSettings;
}

/**
 * Set search frequency
 */
export async function setSearchFrequency(
  accountId: string,
  frequency: "manual" | "daily" | "every_2_days" | "weekly" | "biweekly",
): Promise<UserDiscoverySettings> {
  return updateDiscoverySettings(accountId, { searchFrequency: frequency });
}

/**
 * Set preferred sources
 */
export async function setPreferredSources(
  accountId: string,
  sourceIds: string[],
): Promise<UserDiscoverySettings> {
  return updateDiscoverySettings(accountId, { preferredSourceIds: sourceIds });
}

/**
 * Set excluded sources
 */
export async function setExcludedSources(
  accountId: string,
  sourceIds: string[],
): Promise<UserDiscoverySettings> {
  return updateDiscoverySettings(accountId, { excludedSourceIds: sourceIds });
}

/**
 * Toggle Kenya sources
 */
export async function toggleKenyaSources(
  accountId: string,
  enabled: boolean,
): Promise<UserDiscoverySettings> {
  return updateDiscoverySettings(accountId, { enableAllKenyaSources: enabled });
}

/**
 * Toggle global remote sources
 */
export async function toggleGlobalRemoteSources(
  accountId: string,
  enabled: boolean,
): Promise<UserDiscoverySettings> {
  return updateDiscoverySettings(accountId, { enableGlobalRemoteSources: enabled });
}

/**
 * Set default filters
 */
export async function setDefaultFilters(
  accountId: string,
  filters: UserDiscoverySettings["defaultFilters"],
): Promise<UserDiscoverySettings> {
  return updateDiscoverySettings(accountId, { defaultFilters: filters });
}

/**
 * Get selected roles for discovery
 */
export async function getSelectedRolesForDiscovery(
  accountId: string,
): Promise<string[]> {
  const settings = await getUserDiscoverySettings(accountId);
  const preferences = await getUserRolePreferences(accountId);
  
  if (!settings) {
    return [];
  }
  
  const selectedRoles = settings.selectedRoleIds
    .map(id => preferences.find(p => p.id === id))
    .filter((p): p is UserRolePreference => p !== undefined)
    .map(p => p.roleTitle);
  
  return selectedRoles;
}

/**
 * Select roles for discovery
 */
export async function selectRolesForDiscovery(
  accountId: string,
  roleIds: string[],
): Promise<UserDiscoverySettings> {
  return updateDiscoverySettings(accountId, { selectedRoleIds: roleIds });
}

// ============================================================================
// ROLE SUGGESTIONS & AI
// ============================================================================

/**
 * Get suggested roles based on CV analysis
 */
export async function getSuggestedRoles(
  accountId: string,
): Promise<{
  roles: { roleTitle: string; confidence: number; source: string; sourceId: string; reasoning: string[]; seniorityLevel: string; domain: string }[];
  primary: string[];
  secondary: string[];
  reasoning: string[];
}> {
  const { roles, primaryRoles, allRoles } = await getExtractedRolesFromAllCvs(accountId);
  
  // Get user's current preferences
  const preferences = await getUserRolePreferences(accountId);
  const selectedRoles = await getSelectedRolesForDiscovery(accountId);
  const currentRoles = [...new Set([...preferences.map(p => p.roleTitle), ...selectedRoles])];
  
  // Filter out already selected roles
  const newSuggestions = roles.filter(
    role => !currentRoles.some(cr => cr.toLowerCase() === role.roleTitle.toLowerCase())
  );
  
  // Sort by confidence
  newSuggestions.sort((a, b) => b.confidence - a.confidence);
  
  return {
    roles: newSuggestions,
    primary: primaryRoles.filter(r => !currentRoles.some(cr => cr.toLowerCase() === r.toLowerCase())),
    secondary: allRoles.filter(r => !currentRoles.some(cr => cr.toLowerCase() === r.toLowerCase()) && !primaryRoles.includes(r)),
    reasoning: [
      `We analyzed your CV and found ${roles.length} potential roles.`,
      `Your current profile suggests roles like: ${primaryRoles.join(', ')}`,
      `Consider adding roles that match your education and certifications.`,
    ],
  };
}

/**
 * Get role statistics for a user
 */
export async function getRoleStatistics(
  accountId: string,
): Promise<{
  totalRoles: number;
  enabledRoles: number;
  highPriorityRoles: number;
  manualRoles: number;
  cvRoles: number;
  selectedForDiscovery: number;
}> {
  const preferences = await getUserRolePreferences(accountId);
  const settings = await getUserDiscoverySettings(accountId);
  
  return {
    totalRoles: preferences.length,
    enabledRoles: preferences.filter(p => p.enabled).length,
    highPriorityRoles: preferences.filter(p => p.priority === "high").length,
    manualRoles: preferences.filter(p => p.source === "manual").length,
    cvRoles: preferences.filter(p => p.source === "cv").length,
    selectedForDiscovery: settings.selectedRoleIds.length,
  };
}

// ============================================================================
// DISCOVERY GUIDANCE
// ============================================================================

/**
 * Generate discovery guidance based on user's role preferences
 */
export async function generateDiscoveryGuidance(
  accountId: string,
): Promise<{
  guidance: string[];
  enabledRoles: string[];
  searchQueries: string[];
  sourceRecommendations: string[];
  filters: any;
}> {
  const { roles, preferences, searchQueries } = await getUserEnabledRoles(accountId);
  const settings = await getUserDiscoverySettings(accountId);
  
  const guidance: string[] = [];
  const sourceRecommendations: string[] = [];
  
  if (roles.length === 0) {
    guidance.push("No roles are currently enabled for discovery. Please enable at least one role from your CV or add custom roles.");
  } else {
    guidance.push(`Discovery will search for ${roles.length} roles: ${roles.join(', ')}`);
    
    // Add role-specific guidance
    for (const role of roles) {
      const preference = preferences.find(p => p.roleTitle === role);
      if (preference) {
        if (preference.remoteOnly) {
          guidance.push(`- ${role}: Will only search for remote positions`);
          sourceRecommendations.push("We Work Remotely", "RemoteOK", "FlexJobs");
        }
        if (preference.minSalary) {
          guidance.push(`- ${role}: Will filter for positions paying at least ${preference.minSalary}`);
        }
      }
    }
    
    // Add source recommendations based on roles
    const hasTechRoles = roles.some(r => /developer|engineer|it|ict|technical/i.test(r.toLowerCase()));
    const hasHealthcareRoles = roles.some(r => /health|medical|hospital|nurse|doctor/i.test(r.toLowerCase()));
    const hasBankingRoles = roles.some(r => /bank|finance|fintech|payment/i.test(r.toLowerCase()));
    
    if (hasTechRoles) {
      sourceRecommendations.push("BrighterMonday (IT)", "MyJobMag (IT)", "Google for Jobs (Tech)");
    }
    if (hasHealthcareRoles) {
      sourceRecommendations.push("Kenya Medical Jobs", "Health Jobs Kenya");
    }
    if (hasBankingRoles) {
      sourceRecommendations.push("KCB Careers", "Equity Bank Careers", "Safaricom Careers");
    }
  }
  
  // Add filter guidance
  if (settings.defaultFilters.minSalary) {
    guidance.push(`Jobs will be filtered by minimum salary: ${settings.defaultFilters.minSalary}`);
  }
  if (settings.defaultFilters.remoteOnly) {
    guidance.push("Only remote positions will be shown");
  }
  
  return {
    guidance,
    enabledRoles: roles,
    searchQueries,
    sourceRecommendations,
    filters: settings.defaultFilters,
  };
}

// ============================================================================
// UTILITY: Sync from CV parsing
// ============================================================================

/**
 * Sync role preferences from CV parsing results
 */
export async function syncRolesFromCvParsing(
  accountId: string,
  cvParsingResult: CvParsingResultRecord,
): Promise<{
  added: number;
  updated: number;
  skipped: number;
}> {
  let added = 0;
  let updated = 0;
  let skipped = 0;
  
  try {
    const extractedRoles = cvParsingResult.extractedRoles || [];
    const primaryRoles = cvParsingResult.primaryRoles || [];
    
    const existingPreferences = await getUserRolePreferences(accountId);
    const existingRoleTitles = new Set(existingPreferences.map(p => p.roleTitle.toLowerCase()));
    
    for (const role of extractedRoles) {
      const roleTitle = role.roleTitle;
      const roleLower = roleTitle.toLowerCase();
      
      // Skip if already exists
      if (existingRoleTitles.has(roleLower)) {
        skipped++;
        continue;
      }
      
      const isPrimary = primaryRoles.includes(roleTitle);
      const preference: UserRolePreference = {
        id: randomUUID(),
        accountId,
        roleTitle,
        source: "cv",
        enabled: isPrimary,
        priority: isPrimary ? "high" : "medium",
        weight: role.confidence || 50,
        searchQueries: generateSearchQueriesFromRoles([roleTitle]),
        keywords: [],
        exclusionKeywords: [],
        minSalary: null,
        maxSalary: null,
        locationPreferences: ["Kenya", "Nairobi", "Remote"],
        remoteOnly: false,
        experienceLevel: ["Entry Level", "Junior"],
        industryPreferences: [role.domain || "General"],
        companySize: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      await db.insert(userRolePreferencesTable)
        .values(userRolePreferenceToDb(preference));
      
      added++;
    }
    
    return { added, updated, skipped };
  } catch (err) {
    console.error("[Role Sync] Error syncing roles from CV:", err);
    return { added: 0, updated: 0, skipped: 0 };
  }
}

// ============================================================================
// EXPORT
// ============================================================================

export {
  userRolePreferenceSchema,
  userDiscoverySettingsSchema,
  generateSearchQueriesFromRoles,
};
