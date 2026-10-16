/**
 * Enhanced Job Search Service (Next Generation)
 * 
 * Features:
 * - CV-guided job discovery (uses roles extracted from CV)
 * - User-approved role selection
 * - Advanced filtering system
 * - Multi-source scraping with aggressive strategies
 * - Requirement verification (checks application instructions)
 * - Comprehensive job matching with skill analysis
 * - Integration with existing job-search-service.ts for backward compatibility
 * 
 * This module provides the next-generation discovery pipeline while maintaining
 * full backward compatibility with the existing system.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, gte, inArray, like, ne, or } from "drizzle-orm";
import {
  db,
  jobsTable,
  jobSourcesTable,
  jobProvenanceTable,
  activityTable,
  cvsTable,
  candidateProfilesTable,
  userRolePreferencesTable,
  userDiscoverySettingsTable,
  cvParsingResultsTable,
  jobRequirementVerificationsTable,
  discoveryRunsTable,
} from "@workspace/db";
import {
  getUserEnabledRoles,
  getUserDiscoverySettings,
  updateDiscoverySettings,
  getUserRolePreferences,
  getSelectedRolesForDiscovery,
  selectRolesForDiscovery,
  type UserRolePreference,
  type UserDiscoverySettings,
} from "./discovery-role-approval";
import { COMPREHENSIVE_KENYA_JOB_SOURCES, SOURCE_BY_ID, getEnabledSources, getSourcesByCategory } from "./kenya-job-sources-comprehensive";
import { parseCvComprehensive, getParsedCv } from "./cv-parser-enhanced";
import { fingerprintJob, normalizeCompany, normalizeText } from "./job-deduplication";
import { splitJobSections, extractContextualYears, extractSkillsFromText, COMPREHENSIVE_SKILL_SYNONYMS } from "./section-parser";
import { evaluatePreIngestionGate } from "./pre-ingestion-gate";
import { getOrGenerateSearchDirective, type SearchDirective } from "./search-directive";
import { getOrGenerateCandidateEvidence } from "./candidate-evidence";
import { verifyApplicationRequirements, enhanceJobWithVerification, canPresentJobToUser, verifyJobAgainstUserProfile, type RequirementVerification } from "./requirement-verification-system";
import { getVerifiedMasterCv } from "./cv-storage";
import type { NormalizedJob, JobSearchFilter } from "./job-search-service";
import type { JobRecord } from "@workspace/db";
import { discoverJobsWithCvGuidance, matchJobToUserEnhanced, type DiscoveryResult, type JobDiscoveryConfig, type EnhancedJobSearchFilter, type EnrichedJob } from "./enhanced-job-search-service";

// ============================================================================
// TYPES
// ============================================================================

export interface EnhancedDiscoveryResult extends DiscoveryResult {
  cvMatched: number;
  requirementVerified: number;
  canApply: number;
  highMatches: EnrichedJob[];
  mediumMatches: EnrichedJob[];
  lowMatches: EnrichedJob[];
}

export interface DiscoveryConfig extends Partial<JobDiscoveryConfig> {
  accountId: string;
  useUserRoles?: boolean; // Use user's enabled roles instead of all roles
  verifyAllRequirements?: boolean; // Verify requirements for all discovered jobs
  aggressiveMode?: boolean; // Use aggressive scraping techniques
  bypassRestrictions?: boolean; // "Bend laws" mode for maximum discovery
}

// ============================================================================
// MAIN ENHANCED DISCOVERY FUNCTION
// ============================================================================

/**
 * Enhanced job discovery with CV-guided role-based search
 * This is the main entry point for the next-generation discovery system
 */
export async function discoverAndMatchJobsEnhanced(
  accountId: string,
  config: Partial<DiscoveryConfig> = {},
): Promise<EnhancedDiscoveryResult> {
  const startTime = Date.now();
  const {
    roles: overrideRoles,
    sources: overrideSources,
    filters = {},
    aggressiveMode = false,
    bypassRestrictions = false,
    verifyRequirements = true,
    maxJobs = 200,
    useUserRoles = true,
  } = config;

  // Get user's role preferences
  const userRolesResult = useUserRoles ? await getUserEnabledRoles(accountId) : { roles: [], preferences: [], searchQueries: [] };
  let rolesToSearch = overrideRoles || userRolesResult.roles;

  if (!rolesToSearch || rolesToSearch.length === 0) {
    try {
      const parsedCv = (await getParsedCv(accountId)) as any;
      if (parsedCv?.roles && Array.isArray(parsedCv.roles) && parsedCv.roles.length > 0) {
        rolesToSearch = parsedCv.roles.map((r: any) => r.roleTitle || r.title).filter(Boolean);
      } else if (parsedCv?.targetRoles && Array.isArray(parsedCv.targetRoles) && parsedCv.targetRoles.length > 0) {
        rolesToSearch = parsedCv.targetRoles;
      }

      if (!rolesToSearch || rolesToSearch.length === 0) {
        const [candidateProfile] = await db
          .select()
          .from(candidateProfilesTable)
          .where(or(eq(candidateProfilesTable.id, accountId), eq(candidateProfilesTable.id, "primary")))
          .limit(1);
        if (candidateProfile?.targetRoles && Array.isArray(candidateProfile.targetRoles) && candidateProfile.targetRoles.length > 0) {
          rolesToSearch = candidateProfile.targetRoles;
        }
      }
    } catch {
      // fallback
    }
  }

  if (!rolesToSearch || rolesToSearch.length === 0) {
    rolesToSearch = [
      "Officer",
      "Specialist",
      "Coordinator",
      "Associate",
      "Manager",
    ];
  }

  // Get user's discovery settings
  const settings = await getUserDiscoverySettings(accountId);

  // Build enhanced configuration
  const discoveryConfig: JobDiscoveryConfig = {
    accountId,
    roles: rolesToSearch,
    sources: overrideSources,
    filters: {
      ...filters,
      roleTitles: rolesToSearch,
      requireApplicationInstructions: settings.requireApplicationInstructions,
    } as EnhancedJobSearchFilter,
    aggressiveMode,
    bypassRestrictions,
    verifyRequirements,
    maxJobs,
    timeout: 300000, // 5 minutes
  };

  // Run CV-guided discovery
  const discoveryResult = await discoverJobsWithCvGuidance(discoveryConfig);

  // Save discovery run to database
  const runId = randomUUID();
  await db.insert(discoveryRunsTable).values({
    id: runId,
    accountId,
    runType: "manual",
    triggeredBy: accountId,
    rolesSearched: rolesToSearch,
    sourcesScraped: discoveryResult.sourcesScraped,
    discovered: discoveryResult.discovered,
    duplicates: discoveryResult.duplicates,
    matched: discoveryResult.matched,
    highMatches: discoveryResult.highMatches.length,
    mediumMatches: discoveryResult.mediumMatches.length,
    lowMatches: discoveryResult.lowMatches.length,
    rejected: discoveryResult.rejected,
    errors: discoveryResult.errors,
    executionTime: discoveryResult.executionTime,
    config: {
      aggressiveMode,
      bypassRestrictions,
      verifyRequirements,
      maxJobs,
    },
    startedAt: new Date(startTime),
    completedAt: new Date(),
    createdAt: new Date(),
  });

  // Update user statistics
  await db
    .update(userDiscoverySettingsTable)
    .set({
      totalDiscoveries: (settings.totalDiscoveries || 0) + 1,
      totalJobsDiscovered: (settings.totalJobsDiscovered || 0) + discoveryResult.discovered,
      totalMatches: (settings.totalMatches || 0) + discoveryResult.matched,
      lastDiscoveryRun: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userDiscoverySettingsTable.accountId, accountId));

  // Log activity
  await db.insert(activityTable).values({
    id: randomUUID(),
    kind: "discovery",
    message: `Enhanced discovery: Found ${discoveryResult.discovered} jobs, ${discoveryResult.matched} matches for roles: ${rolesToSearch.join(', ')}`,
    createdAt: new Date(),
  });

  // Return enhanced result with additional metadata
  return {
    ...discoveryResult,
    cvMatched: discoveryResult.highMatches.length + discoveryResult.mediumMatches.length,
    requirementVerified: [...discoveryResult.highMatches, ...discoveryResult.mediumMatches].filter(j => j.isRequirementVerified || Boolean(j.sourceUrl)).length,
    canApply: [...discoveryResult.highMatches, ...discoveryResult.mediumMatches].filter(j => {
      return (j.requirementVerification?.hasClearInstructions || Boolean(j.sourceUrl)) &&
             !((j.requirementVerification as any)?.doNotApplyConditions?.length);
    }).length,
  };
}

// ============================================================================
// ROLE-BASED DISCOVERY (Simpler interface)
// ============================================================================

/**
 * Discover jobs for specific roles
 */
export async function discoverJobsForRoles(
  accountId: string,
  roleTitles: string[],
  options: Partial<DiscoveryConfig> = {},
): Promise<EnhancedDiscoveryResult> {
  return discoverAndMatchJobsEnhanced(accountId, {
    accountId,
    ...options,
    roles: roleTitles,
    useUserRoles: false,
  });
}

/**
 * Discover jobs using user's selected roles
 */
export async function discoverJobsForSelectedRoles(
  accountId: string,
  options: Partial<DiscoveryConfig> = {},
): Promise<EnhancedDiscoveryResult> {
  const selectedRoles = await getSelectedRolesForDiscovery(accountId);
  
  if (selectedRoles.length === 0) {
    // Fall back to all enabled roles
    const { roles } = await getUserEnabledRoles(accountId);
    return discoverJobsForRoles(accountId, roles, options);
  }
  
  return discoverJobsForRoles(accountId, selectedRoles, options);
}

// ============================================================================
// DISCOVERY SCHEDULER
// ============================================================================

/**
 * Run scheduled discovery based on user settings
 */
export async function runScheduledDiscovery(
  accountId: string,
): Promise<{
  ran: boolean;
  result: EnhancedDiscoveryResult | null;
  nextRun: Date | null;
  message: string;
}> {
  const settings = await getUserDiscoverySettings(accountId);
  
  if (settings.searchFrequency === "manual") {
    return {
      ran: false,
      result: null,
      nextRun: null,
      message: "Discovery is set to manual mode. Use 'Run Now' to start discovery.",
    };
  }
  
  // Check if it's time to run
  const now = new Date();
  const lastRun = settings.lastDiscoveryRun ? new Date(settings.lastDiscoveryRun) : null;
  const nextRun = settings.nextScheduledRun ? new Date(settings.nextScheduledRun) : null;
  
  if (nextRun && now < nextRun) {
    return {
      ran: false,
      result: null,
      nextRun,
      message: `Next discovery scheduled for ${nextRun.toLocaleString()}`,
    };
  }
  
  // Run discovery
  try {
    const result = await discoverAndMatchJobsEnhanced(accountId, {
      accountId,
      aggressiveMode: false,
      verifyRequirements: true,
    });
    
    // Schedule next run
    const scheduleResult = await scheduleNextDiscovery(accountId);
    
    return {
      ran: true,
      result,
      nextRun: scheduleResult.nextRunTime,
      message: `Discovery completed. ${result.discovered} jobs discovered, ${result.matched} matches found.`,
    };
  } catch (err) {
    return {
      ran: false,
      result: null,
      nextRun: null,
      message: `Discovery failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Schedule next discovery run based on frequency
 */
export async function scheduleNextDiscovery(
  accountId: string,
): Promise<{ scheduled: boolean; nextRunTime: Date | null }> {
  const settings = await getUserDiscoverySettings(accountId);
  
  if (settings.searchFrequency === "manual") {
    return { scheduled: false, nextRunTime: null };
  }
  
  // Calculate next run time based on frequency
  const now = new Date();
  let nextRun: Date | null = null;
  
  switch (settings.searchFrequency) {
    case "daily":
      nextRun = new Date(now);
      nextRun.setDate(now.getDate() + 1);
      if (settings.searchTimePreference) {
        const [hours, minutes] = settings.searchTimePreference.split(":");
        nextRun.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      } else {
        nextRun.setHours(9, 0, 0, 0); // Default 9 AM
      }
      break;
    case "every_2_days":
      nextRun = new Date(now);
      nextRun.setDate(now.getDate() + 2);
      nextRun.setHours(9, 0, 0, 0);
      break;
    case "weekly":
      nextRun = new Date(now);
      nextRun.setDate(now.getDate() + 7);
      nextRun.setHours(9, 0, 0, 0);
      break;
    case "biweekly":
      nextRun = new Date(now);
      nextRun.setDate(now.getDate() + 14);
      nextRun.setHours(9, 0, 0, 0);
      break;
  }
  
  if (nextRun) {
    // Save next run time
    await db
      .update(userDiscoverySettingsTable)
      .set({
        nextScheduledRun: nextRun,
        updatedAt: new Date(),
      })
      .where(eq(userDiscoverySettingsTable.accountId, accountId));
    
    return { scheduled: true, nextRunTime: nextRun };
  }
  
  return { scheduled: false, nextRunTime: null };
}

// ============================================================================
// JOB VERIFICATION AND MATCHING
// ============================================================================

/**
 * Verify a specific job's requirements against user's profile
 */
export async function verifyJobRequirementsForUser(
  jobId: string,
  accountId: string,
): Promise<{
  job: JobRecord | null;
  requirementVerification: RequirementVerification;
  canApply: boolean;
  canApplyReason: string;
  cannotApplyReason: string | null;
  matchScore: number;
  decision: "STRONG_MATCH" | "POTENTIAL_MATCH" | "NOT_A_MATCH" | "INELIGIBLE";
}> {
  // Get the job
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  
  if (!job) {
    return {
      job: null,
      requirementVerification: { hasClearInstructions: false, applicationMethod: "unknown", applicationUrl: null, applicationEmail: null, applicationPhone: null, deadline: null, deadlineDate: null, isUrgent: false, daysUntilDeadline: null, requiredDocuments: [], hasRequiredDocuments: false, missingDocuments: [], eligibilityRequirements: [], hardRequirements: [], softRequirements: [], specialInstructions: [], doNotApplyConditions: [], isVerified: false, verificationScore: 0, verificationNotes: ["Job not found"], verificationWarnings: [], verificationErrors: ["Job not found"], verifiedAt: new Date().toISOString(), verificationMethod: "automatic" },
      canApply: false,
      canApplyReason: "",
      cannotApplyReason: "Job not found",
      matchScore: 0,
      decision: "INELIGIBLE",
    };
  }
  
  // Verify requirements
  const requirementVerification = verifyApplicationRequirements(
    job.description || '',
    job.title,
    job.company,
  );
  
  // Check if user can apply
  const verificationResult = await verifyJobAgainstUserProfile(job as any, accountId);
  
  // Get match score
  const matchResult = await matchJobToUserEnhanced(job as any, accountId);
  
  // Save verification to database
  const verificationId = randomUUID();
  await db.insert(jobRequirementVerificationsTable).values({
    id: verificationId,
    jobId: job.id,
    accountId,
    hasClearInstructions: Boolean(requirementVerification.hasClearInstructions),
    applicationMethod: requirementVerification.applicationMethod,
    applicationUrl: requirementVerification.applicationUrl || null,
    applicationEmail: requirementVerification.applicationEmail || null,
    applicationPhone: requirementVerification.applicationPhone || null,
    deadline: requirementVerification.deadline || null,
    deadlineDate: requirementVerification.deadlineDate ? new Date(requirementVerification.deadlineDate) : null,
    isUrgent: Boolean(requirementVerification.isUrgent),
    daysUntilDeadline: requirementVerification.daysUntilDeadline || null,
    requiredDocuments: requirementVerification.requiredDocuments || [],
    eligibilityRequirements: requirementVerification.eligibilityRequirements || [],
    hardRequirements: requirementVerification.hardRequirements || [],
    softRequirements: requirementVerification.softRequirements || [],
    specialInstructions: requirementVerification.specialInstructions || [],
    doNotApplyConditions: requirementVerification.doNotApplyConditions || [],
    isVerified: Boolean(requirementVerification.isVerified),
    verificationScore: requirementVerification.verificationScore,
    verificationNotes: requirementVerification.verificationNotes || [],
    verificationWarnings: requirementVerification.verificationWarnings || [],
    cvMatchScore: matchResult.cvMatch.skillsMatch,
    cvMatchedSkills: matchResult.matchedSkills || [],
    cvMissingSkills: matchResult.missingSkills || [],
    roleMatchScore: matchResult.cvMatch.roleMatch,
    canApply: Boolean(verificationResult.canApply),
    canApplyReason: verificationResult.canApplyReason || null,
    cannotApplyReason: verificationResult.cannotApplyReason || null,
    confidence: verificationResult.confidence,
    verifiedAt: new Date(),
    verificationMethod: "automatic",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  
  return {
    job,
    requirementVerification,
    canApply: verificationResult.canApply,
    canApplyReason: verificationResult.canApplyReason,
    cannotApplyReason: verificationResult.cannotApplyReason,
    matchScore: matchResult.matchScore,
    decision: matchResult.decision,
  };
}

/**
 * Enhanced job matching with CV analysis
 */
export async function matchJobToUserProfileEnhanced(
  job: NormalizedJob | JobRecord,
  accountId: string,
): Promise<{
  matchScore: number;
  decision: "STRONG_MATCH" | "POTENTIAL_MATCH" | "NOT_A_MATCH" | "INELIGIBLE";
  matchedSkills: string[];
  missingSkills: string[];
  experienceCompatibility: string;
  locationEligibility: string;
  hardEligibilityFailure: boolean;
  hardFailureReason: string | null;
  requirementVerification: RequirementVerification;
  canApply: boolean;
  canApplyReason: string;
  cannotApplyReason: string | null;
  cvMatch: {
    skillsMatch: number;
    roleMatch: number;
    locationMatch: number;
  };
}> {
  const matchResult = await matchJobToUserEnhanced(job as any, accountId);
  const verificationResult = await verifyJobAgainstUserProfile(job as any, accountId);
  
  return {
    ...matchResult,
    requirementVerification: verificationResult.requirementVerification,
    canApply: verificationResult.canApply,
    canApplyReason: verificationResult.canApplyReason,
    cannotApplyReason: verificationResult.cannotApplyReason,
  };
}

// ============================================================================
// DISCOVERY HISTORY AND STATISTICS
// ============================================================================

/**
 * Get discovery history for a user
 */
export async function getDiscoveryHistory(
  accountId: string,
  limit = 50,
): Promise<{
  runs: {
    id: string;
    rolesSearched: string[];
    sourcesScraped: string[];
    discovered: number;
    matched: number;
    highMatches: number;
    executionTime: number;
    errors: string[];
    startedAt: string;
    completedAt: string | null;
  }[];
  total: number;
}> {
  const runs = await db
    .select()
    .from(discoveryRunsTable)
    .where(eq(discoveryRunsTable.accountId, accountId))
    .orderBy(desc(discoveryRunsTable.startedAt))
    .limit(limit);
  
  return {
    runs: runs.map(run => ({
      id: run.id,
      rolesSearched: Array.isArray(run.rolesSearched) ? run.rolesSearched : [],
      sourcesScraped: Array.isArray(run.sourcesScraped) ? run.sourcesScraped : [],
      discovered: run.discovered,
      matched: run.matched,
      highMatches: run.highMatches,
      executionTime: run.executionTime,
      errors: Array.isArray(run.errors) ? run.errors : [],
      startedAt: new Date(run.startedAt).toISOString(),
      completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null,
    })),
    total: runs.length,
  };
}

/**
 * Get discovery statistics for a user
 */
export async function getDiscoveryStatistics(
  accountId: string,
): Promise<{
  totalDiscoveries: number;
  totalJobsDiscovered: number;
  totalMatches: number;
  avgJobsPerDiscovery: number;
  avgMatchesPerDiscovery: number;
  lastDiscovery: string | null;
  bestDiscovery: {
    discovered: number;
    matched: number;
    date: string;
  } | null;
  sourcesScraped: number;
  mostSuccessfulSource: string | null;
}> {
  const settings = await getUserDiscoverySettings(accountId);
  
  const runs = await db
    .select()
    .from(discoveryRunsTable)
    .where(eq(discoveryRunsTable.accountId, accountId))
    .orderBy(desc(discoveryRunsTable.startedAt))
    .limit(100);
  
  const totalDiscoveries = runs.length;
  const totalJobsDiscovered = runs.reduce((sum, run) => sum + run.discovered, 0);
  const totalMatches = runs.reduce((sum, run) => sum + run.matched, 0);
  
  const avgJobsPerDiscovery = totalDiscoveries > 0 ? totalJobsDiscovered / totalDiscoveries : 0;
  const avgMatchesPerDiscovery = totalDiscoveries > 0 ? totalMatches / totalDiscoveries : 0;
  
  const lastDiscovery = runs[0] ? new Date(runs[0].startedAt).toISOString() : null;
  
  // Find best discovery
  let bestDiscovery = null;
  let maxDiscovered = 0;
  for (const run of runs) {
    if (run.discovered > maxDiscovered) {
      maxDiscovered = run.discovered;
      bestDiscovery = {
        discovered: run.discovered,
        matched: run.matched,
        date: new Date(run.startedAt).toISOString(),
      };
    }
  }
  
  // Get most successful source
  const allSourcesScraped = new Set<string>();
  runs.forEach(run => {
    const sources = Array.isArray(run.sourcesScraped) ? run.sourcesScraped : [];
    sources.forEach((s: string) => allSourcesScraped.add(s));
  });
  
  return {
    totalDiscoveries: settings.totalDiscoveries || totalDiscoveries,
    totalJobsDiscovered: settings.totalJobsDiscovered || totalJobsDiscovered,
    totalMatches: settings.totalMatches || totalMatches,
    avgJobsPerDiscovery: Math.round(avgJobsPerDiscovery * 100) / 100,
    avgMatchesPerDiscovery: Math.round(avgMatchesPerDiscovery * 100) / 100,
    lastDiscovery,
    bestDiscovery,
    sourcesScraped: allSourcesScraped.size,
    mostSuccessfulSource: allSourcesScraped.size > 0 ? Array.from(allSourcesScraped)[0] : null,
  };
}

// ============================================================================
// SOURCE MANAGEMENT
// ============================================================================

/**
 * Enable/disable a specific source for a user
 */
export async function toggleSourceForUser(
  accountId: string,
  sourceId: string,
  enabled: boolean,
): Promise<UserDiscoverySettings> {
  const settings = await getUserDiscoverySettings(accountId);
  
  const preferredSourceIds = new Set(settings.preferredSourceIds || []);
  const excludedSourceIds = new Set(settings.excludedSourceIds || []);
  
  if (enabled) {
    excludedSourceIds.delete(sourceId);
    preferredSourceIds.add(sourceId);
  } else {
    preferredSourceIds.delete(sourceId);
    excludedSourceIds.add(sourceId);
  }
  
  return updateDiscoverySettings(accountId, {
    preferredSourceIds: Array.from(preferredSourceIds),
    excludedSourceIds: Array.from(excludedSourceIds),
  });
}

/**
 * Get all available sources with user preferences
 */
export async function getSourcesWithUserPreferences(
  accountId: string,
): Promise<{
  allSources: typeof COMPREHENSIVE_KENYA_JOB_SOURCES;
  enabledSources: string[];
  disabledSources: string[];
  preferredSources: string[];
  excludedSources: string[];
}> {
  const settings = await getUserDiscoverySettings(accountId);
  const allSources = COMPREHENSIVE_KENYA_JOB_SOURCES;
  
  // Filter based on settings
  const enabledSources = allSources
    .filter(s => {
      // Check category filters
      if (!settings.enableAllKenyaSources && s.country === "Kenya" && s.category !== "GOVERNMENT_NATIONAL") {
        return false;
      }
      if (!settings.enableGlobalRemoteSources && s.country !== "Kenya") {
        return false;
      }
      if (!settings.enableRecruitmentAgencies && s.category === "RECRUITMENT_AGENCY") {
        return false;
      }
      if (!settings.enableStartups && s.category === "STARTUP_JOBS") {
        return false;
      }
      if (!settings.enableFreelance && s.category === "FREELANCE_GIGS") {
        return false;
      }
      
      // Check explicit exclusions
      if (settings.excludedSourceIds?.includes(s.id)) {
        return false;
      }
      
      return true;
    })
    .map(s => s.id);
  
  const disabledSources = allSources
    .filter(s => !enabledSources.includes(s.id))
    .map(s => s.id);
  
  return {
    allSources,
    enabledSources,
    disabledSources,
    preferredSources: settings.preferredSourceIds || [],
    excludedSources: settings.excludedSourceIds || [],
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get all roles for a user (CV + manual)
 */
export async function getAllRolesForUser(
  accountId: string,
): Promise<{
  cvRoles: UserRolePreference[];
  manualRoles: UserRolePreference[];
  allRoles: UserRolePreference[];
}> {
  const allPreferences = await getUserRolePreferences(accountId);
  
  const cvRoles = allPreferences.filter(p => p.source === "cv");
  const manualRoles = allPreferences.filter(p => p.source === "manual");
  
  return {
    cvRoles,
    manualRoles,
    allRoles: allPreferences,
  };
}

/**
 * Update user discovery settings
 */
export async function updateUserDiscoverySettings(
  accountId: string,
  updates: Partial<UserDiscoverySettings>,
): Promise<UserDiscoverySettings> {
  return updateDiscoverySettings(accountId, updates);
}

// ============================================================================
// EXPORT
// ============================================================================


