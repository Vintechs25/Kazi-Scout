/**
 * Job Search Routes
 * API endpoints for manual job search and filter management
 */

import { Router, type IRouter } from "express";
import { desc, eq, and, or, like, gt, isNull } from "drizzle-orm";
import { db, jobsTable, searchProfilesTable, applicationsTable } from "@workspace/db";
import type {
  ManualSearchBody,
  ManualSearchResponse,
  GetSearchFiltersResponse,
  SaveSearchFiltersBody,
  SaveSearchFiltersResponse,
  TriggerAutoApplyBody,
  TriggerAutoApplyResponse,
  GetSearchStatsResponse,
  JobStats,
  ApplicationStats,
} from "../types/search-types";
import { 
  searchAllJobs, 
  filterJobs, 
  matchJobsWithProfile,
  JobSearchFilter,
  NormalizedJob,
  ALL_JOB_SOURCES 
} from "../lib/job-search-service";
import { autoApplyToHighMatchJobs } from "../lib/application-service";
import { batchEvaluateQualifiedJobs } from "../lib/ai-job-evaluator";
import { getVerifiedMasterCv } from "../lib/cv-storage";
import { getOrGenerateCandidateEvidence } from "../lib/candidate-evidence";
import { getAuthenticatedAccountId } from "../lib/auth";

const router: IRouter = Router();

function getAccountId(req: any, res: any): string {
  return res?.locals?.accountId || getAuthenticatedAccountId(req) || "local";
}

/**
 * GET /search/filters
 * Get current search filters from active search profiles
 */
router.get("/search/filters", async (req, res): Promise<void> => {
  try {
    const accountId = getAccountId(req, res);
    const accountFilter = accountId === "local"
      ? or(eq(searchProfilesTable.accountId, "local"), isNull(searchProfilesTable.accountId))
      : eq(searchProfilesTable.accountId, accountId);

    const searchProfiles = await db
      .select()
      .from(searchProfilesTable)
      .where(and(eq(searchProfilesTable.enabled, true), accountFilter));

    // Combine all active search profile filters
    const combinedFilter = {
      keywords: [...new Set(searchProfiles.flatMap(sp => sp.keywords))],
      locations: [...new Set(searchProfiles.flatMap(sp => sp.locations))],
      remote: searchProfiles.every(sp => sp.remoteSetting === "remote"),
      excludeKeywords: [...new Set(searchProfiles.flatMap(sp => sp.excludedKeywords))],
      jobTypes: [...new Set(searchProfiles.flatMap(sp => sp.employmentTypes))],
      minSalary: searchProfiles.filter(sp => sp.minimumSalary !== null).length > 0 
        ? Math.min(...searchProfiles.filter(sp => sp.minimumSalary !== null).map(sp => sp.minimumSalary! as number))
        : undefined,
    };

    // Get all available job sources
    const availableSources = ALL_JOB_SOURCES.map(source => ({
      id: source.id,
      name: source.name,
      enabled: source.enabled,
      rateLimit: source.rateLimit,
      countries: source.countries,
      remoteOnly: source.remoteOnly,
    }));

    // Get Kenya-specific sources
    const kenyaSources = ALL_JOB_SOURCES.filter(source => 
      source.countries.includes("Kenya") || source.id.includes("kenya")
    );

    // Get international remote sources
    const internationalSources = ALL_JOB_SOURCES.filter(source => 
      source.remoteOnly && !source.countries.includes("Kenya")
    );

    const response: GetSearchFiltersResponse = {
      filters: combinedFilter,
      activeProfiles: searchProfiles.length,
      availableSources,
      kenyaSources: kenyaSources.map(s => s.id),
      internationalSources: internationalSources.map(s => s.id),
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to get search filters" 
    });
  }
});

/**
 * PUT /search/filters
 * Update global search filters
 */
router.put("/search/filters", async (req, res): Promise<void> => {
  const body: SaveSearchFiltersBody = req.body;
  
  // Simple validation
  if (!body.filters || typeof body.filters !== 'object') {
    res.status(400).json({ error: "Invalid request body: filters is required" });
    return;
  }

  try {
    const accountId = getAccountId(req, res);
    const accountFilter = accountId === "local"
      ? or(eq(searchProfilesTable.accountId, "local"), isNull(searchProfilesTable.accountId))
      : eq(searchProfilesTable.accountId, accountId);

    // Get all search profiles for this account
    const searchProfiles = await db
      .select()
      .from(searchProfilesTable)
      .where(accountFilter);

    // If no profiles exist, create a default one
    if (searchProfiles.length === 0) {
      const [profile] = await db
        .insert(searchProfilesTable)
        .values({
          id: crypto.randomUUID(),
          accountId,
          name: "Default Search",
          keywords: body.filters.keywords,
          locations: body.filters.locations,
          remoteSetting: body.filters.remote ? "remote" : "any",
          minimumMatchScore: body.minMatchScore || 70,
          minimumSalary: body.filters.minSalary,
          excludedKeywords: body.filters.excludeKeywords,
          employmentTypes: body.filters.jobTypes,
          enabled: true,
          createdAt: new Date(),
        })
        .returning();

      const response: SaveSearchFiltersResponse = {
        profileId: profile.id,
        message: "Created default search profile with new filters",
      };
      res.json(response);
      return;
    }

    // Update the first enabled profile (or create a new one)
    const [firstProfile] = searchProfiles.filter(sp => sp.enabled);
    if (firstProfile) {
      await db
        .update(searchProfilesTable)
        .set({
          keywords: body.filters.keywords,
          locations: body.filters.locations,
          remoteSetting: body.filters.remote ? "remote" : "any" as const,
          minimumMatchScore: body.minMatchScore || firstProfile.minimumMatchScore,
          minimumSalary: body.filters.minSalary,
          excludedKeywords: body.filters.excludeKeywords,
          employmentTypes: body.filters.jobTypes,
        })
        .where(and(eq(searchProfilesTable.id, firstProfile.id), accountFilter));

      const response: SaveSearchFiltersResponse = {
        profileId: firstProfile.id,
        message: "Updated first active search profile with new filters",
      };
      res.json(response);
    } else {
      // All profiles are disabled, create a new one
      const [profile] = await db
        .insert(searchProfilesTable)
        .values({
          id: crypto.randomUUID(),
          accountId,
          name: "New Search Profile",
          keywords: body.filters.keywords,
          locations: body.filters.locations,
          remoteSetting: body.filters.remote ? "remote" : "any",
          minimumMatchScore: body.minMatchScore || 70,
          minimumSalary: body.filters.minSalary,
          excludedKeywords: body.filters.excludeKeywords,
          employmentTypes: body.filters.jobTypes,
          enabled: true,
          createdAt: new Date(),
        })
        .returning();

      const response: SaveSearchFiltersResponse = {
        profileId: profile.id,
        message: "Created new search profile with filters",
      };
      res.json(response);
    }
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to save search filters" 
    });
  }
});

/**
 * POST /search/manual
 * Perform a manual job search with specified filters
 */
router.post("/search/manual", async (req, res): Promise<void> => {
  const body: ManualSearchBody = req.body;
  
  // Simple validation
  if (typeof body !== 'object' || body === null) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  try {
    const accountId = getAccountId(req, res);
    const filter: JobSearchFilter = {
      keywords: body.keywords || [],
      locations: body.locations || [],
      remote: body.remote || false,
      excludeKeywords: body.excludeKeywords || [],
      jobTypes: body.jobTypes || [],
      minSalary: body.minSalary,
    };

    // Search for jobs
    const { jobs, sourceStats } = await searchAllJobs(filter, body.limit || 50);

    // Filter jobs
    const filteredJobs = filterJobs(jobs, filter);

    // Load verified CV and evidence profile for this account
    const cvDossier = await getVerifiedMasterCv(accountId);
    const evidence = await getOrGenerateCandidateEvidence(accountId);

    const jobsToEvaluate = filteredJobs.slice(0, 25);
    const aiResults = await batchEvaluateQualifiedJobs(
      jobsToEvaluate,
      evidence,
      cvDossier.text,
      3,
    );

    // Convert to response format with strict AI evaluation metrics
    const results = jobsToEvaluate.map((job) => {
      const aiEval = aiResults.get(job.id);
      return {
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        remote: Boolean(job.remote),
        salary: job.salary,
        source: job.source,
        sourceUrl: job.sourceUrl,
        matchScore: aiEval ? aiEval.matchScore : 0,
        aiDecision: aiEval?.decision ?? "INSUFFICIENT_INFORMATION",
        isAiVerified: Boolean(aiEval?.isAiVerified),
        explanation: aiEval?.explanation ?? "No AI evaluation completed.",
        discoveredAt: job.discoveredAt.toISOString(),
      };
    });

    const highMatches = results.filter(
      (j) => (j as any).aiDecision === "STRONG_MATCH" && (j.matchScore ?? 0) >= 80,
    );

    // Get stats
    const stats = {
      totalFound: jobs.length,
      filtered: filteredJobs.length,
      matched: results.filter((j) => (j as any).aiDecision === "STRONG_MATCH" || (j as any).aiDecision === "POTENTIAL_MATCH").length,
      highMatches: highMatches.length,
      sourceStats: Object.fromEntries(sourceStats),
    };

    const response: ManualSearchResponse = {
      jobs: results as any,
      stats,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to perform manual search" 
    });
  }
});

/**
 * POST /search/apply-auto
 * Trigger auto-application to high-match jobs
 */
router.post("/search/apply-auto", async (req, res): Promise<void> => {
  const body: TriggerAutoApplyBody = req.body;
  
  // Simple validation
  if (typeof body !== 'object' || body === null) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  try {
    const accountId = getAccountId(req, res);
    const result = await autoApplyToHighMatchJobs(
      body.minMatchScore || 80,
      body.maxApplications || 10,
      body.template || "kenya-focused",
      accountId,
    );

    const response: TriggerAutoApplyResponse = {
      applied: result.applied,
      skipped: result.skipped,
      errors: result.errors,
      results: result.results.map(r => ({
        jobId: r.jobId,
        jobTitle: r.jobTitle,
        company: r.company,
        success: r.success,
        error: r.error || undefined,
        applicationId: r.applicationId || undefined,
      })),
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to trigger auto-apply" 
    });
  }
});

/**
 * GET /search/stats
 * Get job search statistics
 */
router.get("/search/stats", async (req, res): Promise<void> => {
  try {
    const accountId = getAccountId(req, res);
    const jobAccountFilter = accountId === "local"
      ? or(eq(jobsTable.accountId, "local"), isNull(jobsTable.accountId))
      : eq(jobsTable.accountId, accountId);
    const appAccountFilter = accountId === "local"
      ? or(eq(applicationsTable.accountId, "local"), isNull(applicationsTable.accountId))
      : eq(applicationsTable.accountId, accountId);

    // Get all jobs for this account
    const allJobs = await db.select().from(jobsTable).where(jobAccountFilter);
    
    // Calculate job stats
    const jobStats: JobStats = {
      total: allJobs.length,
      discovered: allJobs.filter((job: any) => job.status === "DISCOVERED").length,
      matched: allJobs.filter((job: any) => job.status === "MATCHED").length,
      shortlisted: allJobs.filter((job: any) => job.status === "SHORTLISTED").length,
      remote: allJobs.filter((job: any) => Boolean(job.remote)).length,
      kenya: allJobs.filter((job: any) => 
        job.location?.toLowerCase().includes("kenya") ||
        job.location?.toLowerCase().includes("nairobi") ||
        job.location?.toLowerCase().includes("mombasa") ||
        job.location?.toLowerCase().includes("kisumu")
      ).length,
    };

    // Get recent jobs for this account
    const recentJobs = await db
      .select({
        id: jobsTable.id,
        title: jobsTable.title,
        company: jobsTable.company,
        matchScore: jobsTable.matchScore,
        discoveredAt: jobsTable.discoveredAt,
      })
      .from(jobsTable)
      .where(jobAccountFilter)
      .orderBy(desc(jobsTable.discoveredAt))
      .limit(5);

    // Get all applications for this account
    const allApps = await db.select().from(applicationsTable).where(appAccountFilter);
    
    // Calculate application stats
    const appStats: ApplicationStats = {
      total: allApps.length,
      submitted: allApps.filter((app: any) => app.status === "SUBMITTED").length,
      interviews: allApps.filter((app: any) => app.status === "INTERVIEW").length,
      offers: allApps.filter((app: any) => app.status === "OFFER").length,
    };

    // Get high match jobs for this account
    const highMatchJobs = await db
      .select({
        id: jobsTable.id,
        title: jobsTable.title,
        company: jobsTable.company,
        matchScore: jobsTable.matchScore,
      })
      .from(jobsTable)
      .where(and(jobAccountFilter, gt(jobsTable.matchScore, 70 as any)))
      .orderBy(desc(jobsTable.matchScore))
      .limit(5);

    const response: GetSearchStatsResponse = {
      jobs: {
        total: jobStats.total,
        discovered: jobStats.discovered,
        matched: jobStats.matched,
        shortlisted: jobStats.shortlisted,
        remote: jobStats.remote,
        kenya: jobStats.kenya,
      },
      applications: {
        total: appStats.total,
        submitted: appStats.submitted,
        interviews: appStats.interviews,
        offers: appStats.offers,
      },
      recentJobs: recentJobs.map(job => ({
        id: job.id,
        title: job.title,
        company: job.company,
        matchScore: job.matchScore,
      })),
      highMatchJobs: highMatchJobs.map(job => ({
        id: job.id,
        title: job.title,
        company: job.company,
        matchScore: job.matchScore,
      })),
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to get search stats" 
    });
  }
});

/**
 * GET /search/sources
 * Get list of all available job sources
 */
router.get("/search/sources", async (_req, res): Promise<void> => {
  try {
    const sources = ALL_JOB_SOURCES.map(source => ({
      id: source.id,
      name: source.name,
      baseUrl: source.baseUrl,
      enabled: source.enabled,
      rateLimit: source.rateLimit,
      countries: source.countries,
      remoteOnly: source.remoteOnly,
      apiRequired: Boolean(source.apiKey),
      description: getSourceDescription(source.id),
    }));

    res.json({ sources });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to get job sources" 
    });
  }
});

/**
 * POST /search/sources/:id/enable
 * Enable or disable a job source
 */
router.post("/search/sources/:id/enable", async (req, res): Promise<void> => {
  const sourceId = req.params.id;
  const enabled = req.body.enabled === true;

  try {
    // Find the source
    const source = ALL_JOB_SOURCES.find(s => s.id === sourceId);
    if (!source) {
      res.status(404).json({ error: `Job source ${sourceId} not found` });
      return;
    }

    // Update the source (in a real implementation, this would update a database table)
    // For now, we'll just return a success message
    source.enabled = enabled;

    res.json({
      success: true,
      message: `Job source ${source.name} ${enabled ? "enabled" : "disabled"}`,
      source: {
        id: source.id,
        name: source.name,
        enabled: source.enabled,
      },
    });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to update job source" 
    });
  }
});

// Helper function
function getSourceDescription(sourceId: string): string {
  const descriptions: Record<string, string> = {
    "brighter-monday": "Kenya's leading job board with thousands of listings",
    "jobweb-kenya": "Popular Kenyan job portal",
    "myjobmag-kenya": "Kenyan job aggregator with remote opportunities",
    "remoteok": "Global remote job board with diverse opportunities",
    "we-work-remotely": "One of the largest remote job boards",
    "jobspresso": "Curated remote jobs from top companies",
    "remote4me": "Remote job aggregator with international listings",
    "flexjobs": "Premium remote and flexible job board (requires API key)",
    "linkedin": "Professional networking with job listings (requires API key)",
    "indeed": "Global job search engine (requires API key)",
  };
  return descriptions[sourceId] || "Job source";
}

export default router;
