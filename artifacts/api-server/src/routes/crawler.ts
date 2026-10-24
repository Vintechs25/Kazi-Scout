/**
 * Dedicated Crawler API Routes
 * 
 * Provides production-grade endpoints for managing and executing the
 * aggressive Kenya and multi-domain job crawling system.
 * 
 * Directly connected to:
 * - Aggressive Kenya Crawler (ALL_KENYA_SOURCES, 50+ verified feeds and HTML boards)
 * - PDF Vacancy Notice Parser (County Public Service Boards & PSC circulars)
 * - Database Ingestion & Provenance Tracking (jobsTable & jobProvenanceTable)
 * - Pre-Ingestion Quality & Verification Gate
 */

import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { eq, desc, sql } from "drizzle-orm";
import { db, jobsTable, jobSourcesTable, jobProvenanceTable } from "@workspace/db";
import {
  ALL_KENYA_SOURCES,
  aggressiveCrawlKenya,
  crawlJobsByKeywords,
  crawlJobsByField,
  type CareerField,
  type CrawledJob,
  type SourceSpec,
} from "../lib/connectors/kenya-aggressive-crawler";
import { evaluatePreIngestionGate } from "../lib/pre-ingestion-gate";
import { fingerprintJob } from "../lib/job-deduplication";
import { validateListing } from "../lib/ingestion-contract";
import { getDeterministicSearchDirective } from "../lib/search-directive";
import { getAuthenticatedAccountId } from "../lib/auth";

const router: IRouter = Router();

// ============================================================================
// TYPES & IN-MEMORY SESSION STORE
// ============================================================================

export interface CrawlerSessionStats {
  totalSources: number;
  sourcesProcessed: number;
  sourcesFailed: number;
  jobsFound: number;
  jobsSaved: number;
  jobsDuplicated: number;
  jobsRejected: number;
  pagesScraped: number;
  startTime: string;
  endTime: string | null;
  durationMs: number;
}

export interface CrawlerSessionState {
  sessionId: string;
  status: "idle" | "running" | "completed" | "stopped" | "error";
  accountId: string;
  config: {
    roles?: string[];
    fields?: CareerField[];
    sourceIds?: string[];
    maxJobs?: number;
    aggressiveMode?: boolean;
    verifyRequirements?: boolean;
    saveToDb?: boolean;
  };
  stats: CrawlerSessionStats;
  jobs: CrawledJob[];
  errors: string[];
  abortController?: AbortController;
}

const sessions = new Map<string, CrawlerSessionState>();

function createSession(
  sessionId = `crawl_${Date.now()}_${randomUUID().slice(0, 8)}`,
  accountId = "local",
  config: CrawlerSessionState["config"] = {}
): CrawlerSessionState {
  const session: CrawlerSessionState = {
    sessionId,
    status: "idle",
    accountId,
    config: {
      maxJobs: 200,
      aggressiveMode: true,
      verifyRequirements: true,
      saveToDb: true,
      ...config,
    },
    stats: {
      totalSources: 0,
      sourcesProcessed: 0,
      sourcesFailed: 0,
      jobsFound: 0,
      jobsSaved: 0,
      jobsDuplicated: 0,
      jobsRejected: 0,
      pagesScraped: 0,
      startTime: new Date().toISOString(),
      endTime: null,
      durationMs: 0,
    },
    jobs: [],
    errors: [],
  };

  // Limit in-memory history to 50 runs
  if (sessions.size >= 50) {
    const oldestKey = sessions.keys().next().value;
    if (oldestKey) sessions.delete(oldestKey);
  }

  sessions.set(sessionId, session);
  return session;
}

function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
}

// ============================================================================
// CRAWL EXECUTION ENGINE
// ============================================================================

async function executeCrawl(session: CrawlerSessionState): Promise<CrawlerSessionState> {
  const t0 = Date.now();
  session.status = "running";
  session.stats.startTime = new Date().toISOString();
  session.stats.durationMs = 0;

  const {
    roles = [],
    fields = ["all"],
    sourceIds,
    maxJobs = 200,
    aggressiveMode = true,
    saveToDb = true,
  } = session.config;

  try {
    let rawJobs: CrawledJob[] = [];

    if (roles.length > 0) {
      // CV or role-directed keyword crawl
      session.stats.totalSources = sourceIds?.length || ALL_KENYA_SOURCES.length;
      rawJobs = await crawlJobsByKeywords(roles, maxJobs);
    } else if (sourceIds && sourceIds.length > 0) {
      // Specific sources targeted
      session.stats.totalSources = sourceIds.length;
      rawJobs = await aggressiveCrawlKenya({
        sourceIds,
        maxJobs,
        multiPage: aggressiveMode,
        maxPages: aggressiveMode ? 6 : 2,
        concurrency: 8,
      });
    } else {
      // General field/all aggressive sweep
      session.stats.totalSources = ALL_KENYA_SOURCES.length;
      rawJobs = await aggressiveCrawlKenya({
        fields: fields.length > 0 ? fields : ["all"],
        maxJobs,
        multiPage: aggressiveMode,
        maxPages: aggressiveMode ? 6 : 2,
        concurrency: 8,
      });
    }

    session.stats.jobsFound = rawJobs.length;
    session.stats.sourcesProcessed = session.stats.totalSources;

    // Zero-AI deterministic qualification gate validation & directive matching
    let directive: any = null;
    try {
      directive = await getDeterministicSearchDirective(session.accountId, roles);
    } catch {
      // fallback to neutral gate
    }

    const seenFingerprints = new Set<string>();
    const validJobs: CrawledJob[] = [];

    for (const cj of rawJobs) {
      const fp = fingerprintJob({
        company: cj.company,
        title: cj.title,
        location: cj.location ?? null,
        description: cj.description,
      });

      if (seenFingerprints.has(fp)) {
        session.stats.jobsDuplicated++;
        continue;
      }
      seenFingerprints.add(fp);

      const validation = validateListing({
        title: cj.title,
        company: cj.company,
        url: cj.url,
        description: cj.description,
        deadline: null,
      });

      if (!validation.valid) {
        session.stats.jobsRejected++;
        continue;
      }

      if (directive) {
        const gate = evaluatePreIngestionGate(
          {
            title: cj.title,
            company: cj.company,
            location: cj.location ?? null,
            remote: cj.remote,
            description: cj.description,
            source: cj.sourceId,
            sourceUrl: cj.sourceUrl,
            jobType: cj.jobType ?? undefined,
          },
          directive
        );

        if (!gate.qualified) {
          session.stats.jobsRejected++;
          continue;
        }
      }

      validJobs.push(cj);

      // Persist to database if requested
      if (saveToDb) {
        try {
          const insertId = `job-${Date.now()}-${randomUUID().slice(0, 8)}`;
          await db
            .insert(jobsTable)
            .values({
              id: insertId,
              accountId: session.accountId,
              title: cj.title,
              company: cj.company,
              normalizedCompany: normalizeText(cj.company),
              normalizedTitle: normalizeText(cj.title),
              location: cj.location || "Kenya",
              normalizedLocation: normalizeText(cj.location || "kenya"),
              remote: Boolean(cj.remote),
              salary: cj.salary || null,
              source: cj.sourceId,
              sourceUrl: cj.sourceUrl,
              externalJobId: cj.url,
              description: cj.description || `${cj.title} at ${cj.company}`,
              fingerprint: fp,
              status: "DISCOVERED",
              matchScore: 65,
              matchReason: `Crawled from official source ${cj.sourceName}`,
              discoveredAt: cj.postedDate || new Date(),
            })
            .onConflictDoUpdate({
              target: [jobsTable.accountId, jobsTable.fingerprint],
              set: {
                title: cj.title,
                company: cj.company,
                location: cj.location || "Kenya",
                description: cj.description || `${cj.title} at ${cj.company}`,
                sourceUrl: cj.sourceUrl,
              },
            });

          await db
            .insert(jobProvenanceTable)
            .values({
              id: randomUUID(),
              jobId: insertId,
              sourceId: cj.sourceId,
              sourceName: cj.sourceName,
              originalUrl: cj.sourceUrl || cj.url,
              discoveredAt: new Date(),
              isPrimary: true,
            })
            .catch(() => {});

          session.stats.jobsSaved++;
        } catch (dbErr: any) {
          session.errors.push(`Database save note: ${dbErr?.message || dbErr}`);
        }
      }
    }

    session.jobs = validJobs;
    session.status = "completed";
  } catch (err: any) {
    session.status = "error";
    session.errors.push(`Crawler execution error: ${err?.message || err}`);
  } finally {
    session.stats.endTime = new Date().toISOString();
    session.stats.durationMs = Date.now() - t0;
  }

  return session;
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * GET /api/crawler/sources
 * Get list of available verified Kenya and global job sources
 */
router.get("/sources", async (_req, res) => {
  try {
    const dbSources = await db
      .select({
        id: jobSourcesTable.id,
        name: jobSourcesTable.name,
        canonicalUrl: jobSourcesTable.canonicalUrl,
        category: jobSourcesTable.category,
        country: jobSourcesTable.country,
        status: jobSourcesTable.status,
        enabled: jobSourcesTable.enabled,
      })
      .from(jobSourcesTable)
      .limit(200)
      .catch(() => []);

    const catalogSources = ALL_KENYA_SOURCES.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.fields[0] || "general",
      url: s.htmlPages?.[0] || s.feeds?.[0] || s.jsonEndpoints?.[0] || "",
      country: s.country,
      fields: s.fields,
      type: s.feeds ? "feed" : s.jsonEndpoints ? "json" : "html",
    }));

    return res.json({
      success: true,
      count: catalogSources.length,
      sources: catalogSources,
      databaseConfiguredCount: dbSources.length,
      databaseSources: dbSources,
      categories: [
        "all",
        "tech",
        "healthcare",
        "finance",
        "ngo",
        "government",
        "education",
        "legal",
        "engineering",
        "agriculture",
        "hospitality",
        "media",
        "logistics",
        "insurance",
      ],
      fields: [
        "all",
        "tech",
        "healthcare",
        "finance",
        "ngo",
        "government",
        "education",
        "legal",
        "engineering",
        "agriculture",
        "hospitality",
        "media",
        "logistics",
        "insurance",
      ],
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to list sources",
    });
  }
});

/**
 * GET /api/crawler/sources/:category
 * Get sources filtered by career field / category
 */
router.get("/sources/:category", (req, res) => {
  try {
    const category = req.params.category.toLowerCase();
    const filtered = ALL_KENYA_SOURCES.filter(
      (s) => s.fields.includes(category as CareerField) || (category === "all" && s.fields.includes("all"))
    ).map((s) => ({
      id: s.id,
      name: s.name,
      category: s.fields[0] || "general",
      url: s.htmlPages?.[0] || s.feeds?.[0] || s.jsonEndpoints?.[0] || "",
      country: s.country,
      fields: s.fields,
    }));

    return res.json({
      success: true,
      category,
      count: filtered.length,
      sources: filtered,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/crawler/start
 * Initialize a crawler session
 */
router.post("/start", (req, res) => {
  try {
    const accountId = getAuthenticatedAccountId(req) || "local";
    const { config = {} } = req.body;
    const session = createSession(undefined, accountId, config);

    return res.json({
      success: true,
      message: "Crawler session initialized",
      sessionId: session.sessionId,
      config: session.config,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/crawler/run
 * Run the crawler with specified parameters
 */
router.post("/run", async (req, res) => {
  try {
    const accountId = getAuthenticatedAccountId(req) || "local";
    const {
      sessionId = `crawl_${Date.now()}_${randomUUID().slice(0, 8)}`,
      sourceIds = [],
      roles = [],
      fields = ["all"],
      maxJobs = 150,
      aggressiveMode = true,
      saveToDb = true,
    } = req.body;

    let session = sessions.get(sessionId);
    if (!session) {
      session = createSession(sessionId, accountId, {
        sourceIds,
        roles,
        fields,
        maxJobs,
        aggressiveMode,
        saveToDb,
      });
    } else {
      session.config = {
        ...session.config,
        sourceIds: sourceIds.length > 0 ? sourceIds : session.config.sourceIds,
        roles: roles.length > 0 ? roles : session.config.roles,
        fields: fields.length > 0 ? fields : session.config.fields,
        maxJobs,
        aggressiveMode,
        saveToDb,
      };
    }

    const completedSession = await executeCrawl(session);

    return res.json({
      success: completedSession.status !== "error",
      message: `Crawl completed: ${completedSession.jobs.length} valid jobs found, ${completedSession.stats.jobsSaved} saved.`,
      sessionId: completedSession.sessionId,
      status: completedSession.status,
      stats: completedSession.stats,
      jobsCount: completedSession.jobs.length,
      sampleJobs: completedSession.jobs.slice(0, 10),
      errors: completedSession.errors,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/crawler/crawl-source
 * Crawl a specific source by sourceId
 */
router.post("/crawl-source", async (req, res) => {
  try {
    const accountId = getAuthenticatedAccountId(req) || "local";
    const { sourceId, maxJobs = 50, saveToDb = true } = req.body;

    if (!sourceId) {
      return res.status(400).json({ success: false, error: "sourceId is required" });
    }

    const source = ALL_KENYA_SOURCES.find((s) => s.id === sourceId);
    if (!source) {
      return res.status(404).json({
        success: false,
        error: `Source '${sourceId}' not found in crawler catalog`,
      });
    }

    const session = createSession(undefined, accountId, {
      sourceIds: [sourceId],
      maxJobs,
      saveToDb,
    });

    const completed = await executeCrawl(session);

    return res.json({
      success: true,
      sourceId,
      sourceName: source.name,
      stats: completed.stats,
      jobsFound: completed.jobs.length,
      jobs: completed.jobs,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/crawler/crawl-all
 * Crawl all verified Kenyan and remote sources
 */
router.post("/crawl-all", async (req, res) => {
  try {
    const accountId = getAuthenticatedAccountId(req) || "local";
    const { maxJobs = 300, aggressiveMode = true, saveToDb = true } = req.body;

    const session = createSession(undefined, accountId, {
      fields: ["all"],
      maxJobs,
      aggressiveMode,
      saveToDb,
    });

    const completed = await executeCrawl(session);

    return res.json({
      success: true,
      message: `Full crawl completed across all sources`,
      sessionId: completed.sessionId,
      stats: completed.stats,
      jobsFound: completed.jobs.length,
      jobsSaved: completed.stats.jobsSaved,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/crawler/stop
 * Stop a running crawler session
 */
router.post("/stop", (req, res) => {
  try {
    const { sessionId } = req.body;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.status = "stopped";
      session.stats.endTime = new Date().toISOString();
      return res.json({
        success: true,
        message: "Crawler stopped",
        sessionId,
      });
    }

    // Stop all active sessions
    for (const session of sessions.values()) {
      if (session.status === "running") {
        session.status = "stopped";
        session.stats.endTime = new Date().toISOString();
      }
    }

    return res.json({
      success: true,
      message: "All crawler sessions stopped",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/crawler/status
 * Get live status of crawler
 */
router.get("/status", (req, res) => {
  try {
    const { sessionId } = req.query;
    if (sessionId && sessions.has(String(sessionId))) {
      const s = sessions.get(String(sessionId))!;
      return res.json({
        success: true,
        sessionId: s.sessionId,
        status: s.status,
        isRunning: s.status === "running",
        stats: s.stats,
        jobsFound: s.jobs.length,
      });
    }

    // Find any running session
    const runningSession = Array.from(sessions.values()).find((s) => s.status === "running");
    if (runningSession) {
      return res.json({
        success: true,
        sessionId: runningSession.sessionId,
        status: runningSession.status,
        isRunning: true,
        stats: runningSession.stats,
        jobsFound: runningSession.jobs.length,
      });
    }

    const latest = Array.from(sessions.values()).pop();
    return res.json({
      success: true,
      sessionId: latest?.sessionId || "none",
      status: latest?.status || "idle",
      isRunning: false,
      stats: latest?.stats || null,
      jobsFound: latest?.jobs.length || 0,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/crawler/stats
 * Get aggregated crawler statistics
 */
router.get("/stats", async (_req, res) => {
  try {
    const [dbCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(jobsTable)
      .catch(() => [{ count: 0 }]);

    let totalDiscoveredAcrossSessions = 0;
    let totalSavedAcrossSessions = 0;

    for (const s of sessions.values()) {
      totalDiscoveredAcrossSessions += s.stats.jobsFound;
      totalSavedAcrossSessions += s.stats.jobsSaved;
    }

    return res.json({
      success: true,
      activeSources: ALL_KENYA_SOURCES.length,
      totalJobsInDatabase: Number(dbCount?.count || 0),
      sessionRunsRecorded: sessions.size,
      totalDiscoveredInSessions: totalDiscoveredAcrossSessions,
      totalSavedInSessions: totalSavedAcrossSessions,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/crawler/results
 * Get crawler results for a session
 */
router.get("/results", (req, res) => {
  try {
    const { sessionId, limit = 50, offset = 0 } = req.query;
    const session = sessionId ? sessions.get(String(sessionId)) : Array.from(sessions.values()).pop();

    if (!session) {
      return res.json({
        success: true,
        sessionId: null,
        count: 0,
        total: 0,
        jobs: [],
      });
    }

    const l = Math.max(1, Math.min(Number(limit) || 50, 200));
    const o = Math.max(0, Number(offset) || 0);
    const paginated = session.jobs.slice(o, o + l);

    return res.json({
      success: true,
      sessionId: session.sessionId,
      status: session.status,
      count: paginated.length,
      total: session.jobs.length,
      offset: o,
      limit: l,
      jobs: paginated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/crawler/clear
 * Clear a specific session
 */
router.delete("/clear", (req, res) => {
  try {
    const { sessionId } = req.query;
    if (sessionId && sessions.has(String(sessionId))) {
      sessions.delete(String(sessionId));
      return res.json({ success: true, message: `Session ${sessionId} cleared` });
    }
    return res.status(404).json({ success: false, error: "Session not found" });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/crawler/clear-all
 * Clear all crawler sessions
 */
router.delete("/clear-all", (_req, res) => {
  try {
    sessions.clear();
    return res.json({ success: true, message: "All crawler session data cleared" });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/crawler/sessions
 * List all crawler sessions
 */
router.get("/sessions", (_req, res) => {
  try {
    const sessionList = Array.from(sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      status: s.status,
      startTime: s.stats.startTime,
      durationMs: s.stats.durationMs,
      jobsFound: s.stats.jobsFound,
      jobsSaved: s.stats.jobsSaved,
      sourcesCount: s.stats.totalSources,
      config: s.config,
    }));

    return res.json({
      success: true,
      count: sessionList.length,
      sessions: sessionList,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
