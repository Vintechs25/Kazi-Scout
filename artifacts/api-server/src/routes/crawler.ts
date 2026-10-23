/**
 * Crawler API Routes
 * 
 * Provides endpoints for managing the aggressive job crawling system.
 * Simplified version to avoid type issues.
 */

import { Router } from "express";

const router = Router();

// Mock data for now - will integrate with actual crawler
const mockSources = [
  { id: "brightermonday", name: "BrighterMonday Kenya", category: "job_board", url: "https://www.brightermonday.co.ke/jobs" },
  { id: "myjobmag", name: "MyJobMag Kenya", category: "job_board", url: "https://www.myjobmag.co.ke/jobs" },
  { id: "jobwebkenya", name: "JobWeb Kenya", category: "job_board", url: "https://jobwebkenya.com/jobs/" },
  { id: "psck", name: "Public Service Commission", category: "government", url: "https://psckjobs.go.ke/ActiveJobsAdverts.aspx" },
  { id: "kra", name: "Kenya Revenue Authority", category: "government", url: "https://www.kra.go.ke/careers" },
];

/**
 * GET /api/crawler/sources
 * Get list of available Kenya job sources
 */
router.get("/sources", (req, res) => {
  try {
    return res.json({
      success: true,
      count: mockSources.length,
      sources: mockSources,
      categories: ["job_board", "government", "ngo", "healthcare", "finance", "education"],
      fields: ["all", "tech", "healthcare", "finance", "ngo", "government"],
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/crawler/sources/:category
 * Get sources filtered by category
 */
router.get("/sources/:category", (req, res) => {
  try {
    const { category } = req.params;
    const filtered = mockSources.filter(s => s.category === category);
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
 * Start the crawler
 */
router.post("/start", (req, res) => {
  try {
    const { config = {} } = req.body;
    return res.json({
      success: true,
      message: "Crawler started",
      sessionId: "mock-session-id",
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
router.post("/run", (req, res) => {
  try {
    const { sessionId = "default", sourceIds = [], maxJobs = 100 } = req.body;
    return res.json({
      success: true,
      message: "Crawler running",
      sessionId,
      sourceIds,
      maxJobs,
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
 * Crawl a specific source
 */
router.post("/crawl-source", (req, res) => {
  try {
    const { sourceId, sessionId = "default" } = req.body;
    
    const source = mockSources.find(s => s.id === sourceId);
    if (!source) {
      return res.status(404).json({
        success: false,
        error: `Source ${sourceId} not found`,
      });
    }
    
    return res.json({
      success: true,
      sourceId,
      stats: {
        totalSources: 1,
        sourcesProcessed: 0,
        sourcesFailed: 0,
        jobsFound: 0,
        jobsSaved: 0,
        jobsDuplicated: 0,
        captchasSolved: 0,
        cloudflareBypassed: 0,
        pagesScraped: 0,
        errors: 0,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 0,
      },
      jobs: 0,
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
 * Crawl all Kenya sources
 */
router.post("/crawl-all", (req, res) => {
  try {
    const { sessionId = "default", config = {} } = req.body;
    return res.json({
      success: true,
      message: "Crawling all sources",
      sessionId,
      totalSources: mockSources.length,
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
 * Stop the crawler
 */
router.post("/stop", (req, res) => {
  try {
    const { sessionId = "default" } = req.body;
    return res.json({
      success: true,
      message: "Crawler stopped",
      sessionId,
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
 * Get crawler status
 */
router.get("/status", (req, res) => {
  try {
    const { sessionId = "default" } = req.query;
    return res.json({
      success: true,
      sessionId: String(sessionId),
      isRunning: false,
      sourcesProcessed: 0,
      jobsFound: 0,
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
 * Get crawler statistics
 */
router.get("/stats", (req, res) => {
  try {
    const { sessionId = "default", days = 7 } = req.query;
    return res.json({
      success: true,
      sessionId: String(sessionId),
      days: Number(days),
      totalJobs: 0,
      newJobs: 0,
      sourcesScraped: 0,
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
 * Get crawler results
 */
router.get("/results", (req, res) => {
  try {
    const { sessionId = "default", limit = 100, offset = 0 } = req.query;
    return res.json({
      success: true,
      sessionId: String(sessionId),
      limit: Number(limit),
      offset: Number(offset),
      count: 0,
      jobs: [],
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
 * Clear all crawled data for a session
 */
router.delete("/clear", (req, res) => {
  try {
    const { sessionId = "default" } = req.query;
    
    return res.json({
      success: true,
      sessionId: String(sessionId),
      message: "Data cleared",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/crawler/clear-all
 * Clear all crawled data
 */
router.delete("/clear-all", (req, res) => {
  try {
    return res.json({
      success: true,
      message: "All data cleared",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/crawler/sessions
 * List all active crawling sessions
 */
router.get("/sessions", (req, res) => {
  try {
    const sessions: any[] = [];
    
    return res.json({
      success: true,
      count: sessions.length,
      sessions,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
