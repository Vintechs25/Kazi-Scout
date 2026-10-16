import { Router, type IRouter } from "express";
import { SourceService } from "../lib/source-service";
import { SourceDiscoveryEngine } from "../lib/source-discovery-engine";
import { getConnectorForSource } from "../lib/connectors/registry";
import { db, jobProvenanceTable, sourceRunLogTable, rejectedCandidatesTable, occupationTaxonomyTable, adminRegionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { SourceRouter } from "../lib/source-router";

const router: IRouter = Router();

// 1. List sources
router.get("/sources", async (req, res) => {
  try {
    const { category, country, status, enabled, search, limit, offset } = req.query;
    const result = await SourceService.listSources({
      category: category as string,
      country: country as string,
      status: status as string,
      enabled: enabled !== undefined ? enabled === "true" : undefined,
      search: search as string,
      limit: limit ? parseInt(limit as string, 10) : 250,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });
    res.json({
      ...result,
      items: result.sources,
    });
  } catch (error: any) {
    logger.error("[SourcesRouter] Error listing sources: " + (error?.message || error));
    res.status(500).json({ error: error.message || "Failed to list sources" });
  }
});

// Bulk sources operations
router.post("/sources/bulk", async (req, res): Promise<void> => {
  try {
    const { action, sourceIds, category } = req.body || {};
    let targetIds: string[] = Array.isArray(sourceIds) ? sourceIds : [];

    if (category) {
      const list = await SourceService.listSources({ category, limit: 500 });
      targetIds = list.sources.map((s) => s.id);
    }

    if (targetIds.length === 0) {
      res.status(400).json({ error: "No sourceIds or category provided." });
      return;
    }

    if (action === "enable" || action === "disable") {
      const enable = action === "enable";
      for (const id of targetIds) {
        await SourceService.toggleSource(id, enable);
      }
      res.json({ success: true, count: targetIds.length, action });
      return;
    } else if (action === "test") {
      const results: Record<string, any> = {};
      for (const id of targetIds) {
        try {
          const testRes = await SourceService.testSourceConnection(id);
          results[id] = testRes;
        } catch (e: any) {
          results[id] = { ok: false, message: e?.message || "Failed" };
        }
      }
      res.json({ success: true, count: targetIds.length, action: "test", results });
      return;
    } else if (action === "sync") {
      const results: Record<string, any> = {};
      let totalDiscovered = 0;
      let totalIndexed = 0;
      for (const id of targetIds) {
        try {
          const syncRes = await SourceService.syncSource(id);
          results[id] = syncRes;
          totalDiscovered += syncRes.discoveredCount;
          totalIndexed += syncRes.indexedCount;
        } catch (e: any) {
          results[id] = { error: e?.message || "Failed" };
        }
      }
      res.json({
        success: true,
        count: targetIds.length,
        action: "sync",
        totalDiscovered,
        totalIndexed,
        results,
      });
      return;
    } else {
      res.status(400).json({ error: "Invalid action. Supported: enable, disable, test, sync" });
      return;
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed bulk sources operation" });
  }
});

// 2. Get single source
router.get("/sources/:id", async (req, res) => {
  try {
    const source = await SourceService.getSourceById(req.params.id);
    if (!source) {
      res.status(404).json({ error: "Source not found" });
      return;
    }
    res.json(source);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get source" });
  }
});

// 3. Enable source
router.post("/sources/:id/enable", async (req, res) => {
  try {
    const updated = await SourceService.toggleSource(req.params.id, true);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to enable source" });
  }
});

// 4. Disable source
router.post("/sources/:id/disable", async (req, res) => {
  try {
    const updated = await SourceService.toggleSource(req.params.id, false);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to disable source" });
  }
});

// 5. Test source connection
router.post("/sources/:id/test", async (req, res) => {
  try {
    const testResult = await SourceService.testSourceConnection(req.params.id);
    res.json(testResult);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to test source" });
  }
});

// 6. Run discovery now on single source
router.post("/sources/:id/sync", async (req, res) => {
  try {
    const source = await SourceService.getSourceById(req.params.id);
    if (!source) {
      res.status(404).json({ error: "Source not found" });
      return;
    }

    const result = await SourceService.syncSource(req.params.id, { limit: 40 });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to sync source" });
  }
});

// 7. List all 47 counties
router.get("/counties", async (req, res) => {
  try {
    const counties = await SourceService.listCounties();
    res.json({ counties, total: counties.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to list counties" });
  }
});

// 8. Update county recruitment portal info
router.patch("/counties/:id", async (req, res) => {
  try {
    const updated = await SourceService.updateCounty(req.params.id, req.body);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update county" });
  }
});

// 9. Indexing overview / metrics panel
router.get("/indexing/overview", async (req, res) => {
  try {
    const overview = await SourceService.getIndexingOverview();
    res.json(overview);
  } catch (error: any) {
    logger.error("[SourcesRouter] Error getting indexing overview: " + (error?.message || error));
    res.status(500).json({ error: error.message || "Failed to get indexing overview" });
  }
});

// 10. Discovered sources proposals queue
router.get("/sources-discovered", async (req, res) => {
  try {
    const { status } = req.query;
    const proposals = await SourceService.listDiscoveredSources(status as string);
    res.json({ proposals, count: proposals.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to list proposals" });
  }
});

// 11. Review discovered source proposal
router.post("/sources-discovered/:id/review", async (req, res) => {
  try {
    const { decision, notes } = req.body;
    if (decision !== "APPROVED" && decision !== "REJECTED") {
      res.status(400).json({ error: "decision must be APPROVED or REJECTED" });
      return;
    }
    const result = await SourceService.reviewDiscoveredSource(req.params.id, decision, notes);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to review proposal" });
  }
});

// 12. Run source discovery run
router.post("/sources-discovered/run", async (req, res) => {
  try {
    const result = await SourceDiscoveryEngine.runDiscoveryRun({ maxCandidates: 5 });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Discovery run failed" });
  }
});

// 13. Get provenance history for a job
router.get("/jobs/:id/provenance", async (req, res) => {
  try {
    const records = await db.select()
      .from(jobProvenanceTable)
      .where(eq(jobProvenanceTable.jobId, req.params.id))
    res.json({ provenance: records });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get job provenance" });
  }
});

// 14. Get routed/selected sources for profile
router.get("/sources-selected", async (req, res) => {
  try {
    const profileId = (req.query.profileId as string) || "primary";
    const selected = await SourceRouter.routeSourcesForProfile(profileId);
    res.json({
      profileId,
      count: selected.length,
      sources: selected,
    });
  } catch (error: any) {
    logger.error("[SourcesRouter] Error routing sources for profile: " + (error?.message || error));
    res.status(500).json({ error: error.message || "Failed to route sources for profile" });
  }
});

// 15. Set source mode (AUTO, PINNED, EXCLUDED) for profile
router.post("/sources/:id/mode", async (req, res) => {
  try {
    const { mode, profileId = "primary", reason } = req.body || {};
    if (!["AUTO", "PINNED", "EXCLUDED"].includes(mode)) {
      res.status(400).json({ error: "mode must be AUTO, PINNED, or EXCLUDED" });
      return;
    }
    await SourceRouter.setSourceMode(profileId, req.params.id, mode, reason);
    res.json({ success: true, sourceId: req.params.id, mode, profileId });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to update source mode" });
  }
});

// 16. Get source run logs
router.get("/sources/runs", async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const runs = await db.select()
      .from(sourceRunLogTable)
      .orderBy(desc(sourceRunLogTable.startedAt))
      .limit(limit);
    res.json({ runs, count: runs.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get run logs" });
  }
});

// 17. Get rejected candidates discard log
router.get("/sources/rejected", async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const rejected = await db.select()
      .from(rejectedCandidatesTable)
      .orderBy(desc(rejectedCandidatesTable.createdAt))
      .limit(limit);
    res.json({ rejected, count: rejected.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get rejected candidates" });
  }
});

// 18. Get occupation taxonomy
router.get("/sources/taxonomy", async (req, res) => {
  try {
    const taxonomy = await db.select().from(occupationTaxonomyTable);
    res.json({ taxonomy, count: taxonomy.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get occupation taxonomy" });
  }
});

// 19. Get admin regions
router.get("/admin-regions", async (req, res) => {
  try {
    const regions = await db.select().from(adminRegionsTable);
    res.json({ regions, count: regions.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get admin regions" });
  }
});

export default router;
