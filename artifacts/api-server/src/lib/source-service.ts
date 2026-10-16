import { randomUUID } from "node:crypto";
import { db, jobSourcesTable, countyRegistryTable, jobProvenanceTable, discoveredSourcesTable, jobsTable } from "@workspace/db";
import { eq, sql, desc, and, like, or } from "drizzle-orm";
import { COMPREHENSIVE_SOURCE_CATALOG, SourceDefinition } from "./source-registry-data";
import { ALL_47_KENYAN_COUNTIES, CountyDefinition } from "./county-registry-data";
import { getConnectorForSource } from "./connectors/registry";
import { fingerprintJob, normalizeCompany, normalizeText } from "./job-deduplication";
import { logger } from "./logger";
import { runFullRegistryMigration } from "./registry-migration";
import { processListingPipeline } from "./ingestion-contract";

export interface SourceFilters {
  category?: string;
  country?: string;
  status?: string;
  enabled?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export class SourceService {
  private static seeded = false;

  /**
   * Idempotently seed source catalog and all 47 Kenyan counties into the database.
   */
  public static async initializeCatalog(): Promise<{ sourcesSeeded: number; countiesSeeded: number }> {
    if (this.seeded) return { sourcesSeeded: 0, countiesSeeded: 0 };

    let sourcesSeeded = 0;
    let countiesSeeded = 0;

    try {
      // 1. Seed or sync sources
      const existingSources = await db.select({ id: jobSourcesTable.id }).from(jobSourcesTable);
      const existingSourceIds = new Set(existingSources.map(s => s.id));
      const now = new Date();

      for (const def of COMPREHENSIVE_SOURCE_CATALOG) {
        if (!existingSourceIds.has(def.id)) {
          await db.insert(jobSourcesTable).values({
            id: def.id,
            name: def.name,
            canonicalUrl: def.canonicalUrl,
            category: def.category,
            country: def.country || "Kenya",
            region: def.region ?? null,
            integrationType: def.integrationType,
            connectorType: def.connectorType,
            status: def.status,
            enabled: Boolean(def.enabled),
            supportsApi: Boolean(def.supportsApi),
            supportsFeed: Boolean(def.supportsFeed),
            supportsHtmlExtraction: Boolean(def.supportsHtmlExtraction),
            supportsBrowserAutomation: false,
            supportsSearchOnly: Boolean(def.supportsSearchOnly),
            supportsApplicationRedirect: Boolean(def.supportsApplicationRedirect ?? true),
            authenticationRequired: Boolean(def.authenticationRequired),
            termsReviewed: true,
            accessMethod: "PUBLIC_FEED",
            rateLimit: def.rateLimit ?? 30,
            config: def.config ? def.config : null,
            totalDiscovered: 0,
            totalParsed: 0,
            totalIndexed: 0,
            totalRejected: 0,
            consecutiveFailures: 0,
            createdAt: now,
            updatedAt: now,
          });
          sourcesSeeded++;
        } else {
          await db.update(jobSourcesTable).set({
            canonicalUrl: def.canonicalUrl,
            category: def.category,
            connectorType: def.connectorType,
            integrationType: def.integrationType,
            config: def.config ? def.config : undefined,
            supportsApi: Boolean(def.supportsApi),
            supportsFeed: Boolean(def.supportsFeed),
            supportsHtmlExtraction: Boolean(def.supportsHtmlExtraction),
            updatedAt: now,
          }).where(eq(jobSourcesTable.id, def.id));
        }
      }

      // 2. Seed or sync 47 counties
      const existingCounties = await db.select({ id: countyRegistryTable.id }).from(countyRegistryTable);
      const existingCountyIds = new Set(existingCounties.map(c => c.id));

      for (const county of ALL_47_KENYAN_COUNTIES) {
        if (!existingCountyIds.has(county.id)) {
          await db.insert(countyRegistryTable).values({
            id: county.id,
            code: county.code,
            name: county.name,
            capital: county.capital,
            officialWebsite: county.officialWebsite,
            recruitmentUrl: county.recruitmentUrl,
            cpsbUrl: county.cpsbUrl ?? null,
            announcementsUrl: county.announcementsUrl ?? null,
            discoveryQueries: county.discoveryQueries ?? [],
            status: county.status,
            verifiedDestinations: [],
          });
          countiesSeeded++;
        }
      }

      this.seeded = true;
      logger.info(`[SourceService] Initialized catalog: ${sourcesSeeded} new sources seeded, ${countiesSeeded} counties seeded.`);

      // Reconcile and reflect true database job counts & provenance across all sources
      await this.reconcileAllSourceMetrics();

      // Execute schema migration, stub cleanup, taxonomy seeding & admin regions migration
      await runFullRegistryMigration();
    } catch (err) {
      logger.error("[SourceService] Failed to initialize catalog: " + (err instanceof Error ? err.message : String(err)));
    }

    return { sourcesSeeded, countiesSeeded };
  }

  /**
   * Reconcile all source metrics from jobs and job_provenance tables
   */
  public static async reconcileAllSourceMetrics() {
    try {
      const sources = await db.select({ id: jobSourcesTable.id, name: jobSourcesTable.name, canonicalUrl: jobSourcesTable.canonicalUrl }).from(jobSourcesTable);
      
      for (const s of sources) {
        const directJobs = await db.select({ c: sql<number>`count(*)` }).from(jobsTable)
          .where(or(
            eq(jobsTable.source, s.name),
            eq(jobsTable.source, s.id),
            like(jobsTable.source, `%${s.name}%`)
          ));
        let indexed = Number(directJobs[0]?.c || 0);

        const provCount = await db.select({ c: sql<number>`count(*)` }).from(jobProvenanceTable)
          .where(or(
            eq(jobProvenanceTable.sourceId, s.id),
            eq(jobProvenanceTable.sourceName, s.name),
            like(jobProvenanceTable.sourceName, `%${s.name}%`)
          ));
        let discovered = Math.max(Number(provCount[0]?.c || 0), indexed);

        const aliases: string[] = [];
        if (s.id.includes("myjobmag")) aliases.push("myjobmag", "MyJobMag Kenya");
        if (s.id.includes("careerpoint")) aliases.push("Career Point Kenya", "careerpoint");
        if (s.id.includes("jobwebkenya")) aliases.push("JobWeb Kenya", "jobwebkenya");
        if (s.id.includes("jobicy")) aliases.push("Jobicy", "jobicy");
        if (s.id.includes("remoteok") || s.id.includes("remote-ok")) aliases.push("RemoteOK", "remoteok", "Remote OK");
        if (s.id.includes("weworkremotely")) aliases.push("WeWorkRemotely", "weworkremotely", "We Work Remotely");
        if (s.id.includes("arbeitnow")) aliases.push("Arbeitnow", "arbeitnow", "Arbeitnow Remote");
        if (s.id.includes("working-nomads")) aliases.push("Working Nomads", "workingnomads");
        if (s.id.includes("himalayas")) aliases.push("Himalayas", "himalayas");
        if (s.id.includes("remotive")) aliases.push("Remotive", "remotive");
        if (s.id.includes("careerjet")) aliases.push("Careerjet Kenya", "careerjet-kenya");
        if (s.id.includes("indeed")) aliases.push("Indeed Kenya", "indeed-kenya");
        if (s.id.includes("kra-kenya")) aliases.push("Kenya Revenue Authority", "kra-kenya", "KRA");

        for (const a of aliases) {
          const aJobs = await db.select({ c: sql<number>`count(*)` }).from(jobsTable).where(eq(jobsTable.source, a));
          const aProv = await db.select({ c: sql<number>`count(*)` }).from(jobProvenanceTable).where(or(eq(jobProvenanceTable.sourceId, a), eq(jobProvenanceTable.sourceName, a)));
          indexed = Math.max(indexed, Number(aJobs[0]?.c || 0));
          discovered = Math.max(discovered, Number(aProv[0]?.c || 0), indexed);
        }

        if (indexed > 0 || discovered > 0) {
          await db.update(jobSourcesTable)
            .set({
              totalIndexed: indexed,
              totalDiscovered: discovered,
              status: "ACTIVE",
            })
            .where(eq(jobSourcesTable.id, s.id));
        }
      }
    } catch (err: any) {
      logger.warn(`[SourceService] Could not reconcile source metrics: ${err?.message || err}`);
    }
  }

  /**
   * List sources with filtering and pagination
   */
  public static async listSources(filters: SourceFilters = {}) {
    await this.initializeCatalog();

    const conditions: any[] = [];

    if (filters.category) {
      conditions.push(eq(jobSourcesTable.category, filters.category));
    }
    if (filters.country) {
      conditions.push(eq(jobSourcesTable.country, filters.country));
    }
    if (filters.status) {
      conditions.push(eq(jobSourcesTable.status, filters.status as any));
    }
    if (filters.enabled !== undefined) {
      conditions.push(eq(jobSourcesTable.enabled, filters.enabled));
    }
    if (filters.search) {
      const s = `%${filters.search}%`;
      conditions.push(or(
        like(jobSourcesTable.name, s),
        like(jobSourcesTable.canonicalUrl, s),
        like(jobSourcesTable.id, s)
      ));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const sources = await db.select()
      .from(jobSourcesTable)
      .where(whereClause)
      .orderBy(jobSourcesTable.category, jobSourcesTable.name)
      .limit(filters.limit ?? 250)
      .offset(filters.offset ?? 0);

    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(jobSourcesTable)
      .where(whereClause);

    return {
      sources,
      total: count,
    };
  }

  /**
   * Get single source by ID
   */
  public static async getSourceById(id: string) {
    await this.initializeCatalog();
    const rows = await db.select().from(jobSourcesTable).where(eq(jobSourcesTable.id, id));
    return rows[0] || null;
  }

  /**
   * Toggle source enabled state
   */
  public static async toggleSource(id: string, enabled: boolean) {
    const updated = await db.update(jobSourcesTable)
      .set({
        enabled,
        updatedAt: new Date(),
      })
      .where(eq(jobSourcesTable.id, id))
      .returning();
    return updated[0] || null;
  }

  /**
   * Test connection to a source using its appropriate connector
   */
  public static async testSourceConnection(id: string) {
    const source = await this.getSourceById(id);
    if (!source) throw new Error(`Source not found: ${id}`);

    const connector = getConnectorForSource(source);
    const health = await connector.healthCheck(source);

    let newStatus: any = source.status;
    if (health.ok) {
      newStatus = source.status === "ACTIVE" ? "ACTIVE" : "READY";
    } else {
      newStatus = health.status || (source.authenticationRequired ? "AUTH_REQUIRED" : "DEGRADED");
    }

    await db.update(jobSourcesTable)
      .set({
        status: newStatus,
        lastCheckedAt: new Date(),
        lastErrorMessage: health.message || null,
        consecutiveFailures: health.ok ? 0 : (source.consecutiveFailures || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(jobSourcesTable.id, id));

    return {
      name: source.name,
      ...health,
      assignedStatus: newStatus,
    };
  }

  /**
   * Sync a single source: crawl listings, ingest into jobsTable with deduplication,
   * record provenance, and update totalIndexed & totalDiscovered.
   */
  public static async syncSource(id: string, options: { limit?: number; keywords?: string[]; profileId?: string } = {}) {
    const source = await this.getSourceById(id);
    if (!source) throw new Error(`Source not found: ${id}`);

    const connector = getConnectorForSource(source);
    const limit = options.limit || 40;
    const candidateKeywords = options.keywords && options.keywords.length > 0 ? options.keywords : [];
    const keywords = candidateKeywords.length > 0 
      ? candidateKeywords 
      : ["officer", "manager", "specialist", "assistant", "consultant", "analyst", "coordinator", "lead", "director", "associate"];

    const discovered = await connector.discoverListings(source, { limit, keywords });

    const runId = randomUUID();
    const pipelineResult = await processListingPipeline(
      discovered as any,
      source,
      runId,
      options.profileId,
    );

    return {
      sourceId: source.id,
      name: source.name,
      runId,
      discoveredCount: pipelineResult.fetched,
      parsedCount: pipelineResult.parsed,
      validatedCount: pipelineResult.validated,
      savedCount: pipelineResult.saved,
      indexedCount: pipelineResult.saved,
      totalDiscovered: pipelineResult.totalDiscovered,
      totalIndexed: pipelineResult.totalIndexed,
      yieldRate: pipelineResult.yieldRate,
      rejectReasons: pipelineResult.rejectReasons,
      sampleListings: discovered.slice(0, 3),
    };
  }

  /**
   * List all 47 counties
   */
  public static async listCounties() {
    await this.initializeCatalog();
    return await db.select().from(countyRegistryTable).orderBy(countyRegistryTable.code);
  }

  /**
   * Update county recruitment details
   */
  public static async updateCounty(id: string, updates: Partial<{
    officialWebsite: string;
    recruitmentUrl: string;
    cpsbUrl: string;
    announcementsUrl: string;
    status: string;
  }>) {
    const setPayload: any = {};
    if (updates.officialWebsite !== undefined) setPayload.officialWebsite = updates.officialWebsite;
    if (updates.recruitmentUrl !== undefined) setPayload.recruitmentUrl = updates.recruitmentUrl;
    if (updates.cpsbUrl !== undefined) setPayload.cpsbUrl = updates.cpsbUrl;
    if (updates.announcementsUrl !== undefined) setPayload.announcementsUrl = updates.announcementsUrl;
    if (updates.status !== undefined) setPayload.status = updates.status;

    const res = await db.update(countyRegistryTable)
      .set(setPayload)
      .where(eq(countyRegistryTable.id, id))
      .returning();
    return res[0] || null;
  }

  /**
   * Get discovered sources queue
   */
  public static async listDiscoveredSources(status?: string) {
    if (status) {
      return await db.select()
        .from(discoveredSourcesTable)
        .where(eq(discoveredSourcesTable.status, status))
        .orderBy(desc(discoveredSourcesTable.discoveredAt));
    }
    return await db.select()
      .from(discoveredSourcesTable)
      .orderBy(desc(discoveredSourcesTable.discoveredAt));
  }

  /**
   * Review discovered source proposal
   */
  public static async reviewDiscoveredSource(id: string, decision: "APPROVED" | "REJECTED", notes?: string) {
    const rows = await db.select().from(discoveredSourcesTable).where(eq(discoveredSourcesTable.id, id));
    if (rows.length === 0) throw new Error(`Discovered source not found: ${id}`);
    const item = rows[0];

    await db.update(discoveredSourcesTable)
      .set({
        status: decision,
        reviewedAt: new Date(),
        notes: notes || item.notes,
      })
      .where(eq(discoveredSourcesTable.id, id));

    if (decision === "APPROVED") {
      const newSourceId = `discovered-${item.domain.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
      await db.insert(jobSourcesTable).values({
        id: newSourceId,
        name: item.suggestedName || item.domain,
        canonicalUrl: item.url,
        category: (item.suggestedCategory as any) || "TECH_EMPLOYER",
        country: "Kenya",
        integrationType: "STRUCTURED_HTML",
        connectorType: "STRUCTURED_HTML",
        status: "READY",
        enabled: true,
        supportsHtmlExtraction: true,
        accessMethod: "PUBLIC_HTML",
        createdAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoNothing();
    }

    return { id, decision };
  }

  /**
   * Aggregates real database indexing metrics and source statuses
   */
  public static async getIndexingOverview() {
    await this.initializeCatalog();

    // Source stats
    const sourceRows = await db.select({
      status: jobSourcesTable.status,
      enabled: jobSourcesTable.enabled,
      category: jobSourcesTable.category,
      totalDiscovered: jobSourcesTable.totalDiscovered,
      totalIndexed: jobSourcesTable.totalIndexed,
    }).from(jobSourcesTable);

    let activeSources = 0;
    let degradedSources = 0;
    let configuredSources = 0;
    let disabledSources = 0;
    let searchOnlySources = 0;
    let totalSourcesDiscoveredCount = 0;
    let totalSourcesIndexedCount = 0;

    for (const s of sourceRows) {
      if (!s.enabled) disabledSources++;
      if (s.status === "ACTIVE") activeSources++;
      else if (s.status === "DEGRADED" || s.status === "ERROR") degradedSources++;
      else if (s.status === "CONFIGURED" || s.status === "READY") configuredSources++;
      else if ((s.status as string) === "SEARCH_ONLY") searchOnlySources++;

      totalSourcesDiscoveredCount += (s.totalDiscovered || 0);
      totalSourcesIndexedCount += (s.totalIndexed || 0);
    }

    // Job stats from jobsTable
    const jobStatusCounts = await db.select({
      status: jobsTable.status,
      count: sql<number>`count(*)`,
    }).from(jobsTable).groupBy(jobsTable.status);

    const countsByStatus: Record<string, number> = {};
    let totalJobs = 0;
    for (const r of jobStatusCounts) {
      countsByStatus[r.status] = Number(r.count);
      totalJobs += Number(r.count);
    }

    // AI evaluated count: jobs with aiMatchScore !== null or aiDecision !== null
    const [{ aiEvaluatedCount }] = await db.select({
      aiEvaluatedCount: sql<number>`count(*)`,
    }).from(jobsTable).where(sql`ai_decision IS NOT NULL OR match_score IS NOT NULL`);

    // Duplicate count
    const duplicatesCount = countsByStatus["DUPLICATE"] || 0;

    // Provenance links count
    const [{ provenanceCount }] = await db.select({
      provenanceCount: sql<number>`count(*)`,
    }).from(jobProvenanceTable);

    // Discovered sources proposals
    const [{ pendingProposals }] = await db.select({
      pendingProposals: sql<number>`count(*)`,
    }).from(discoveredSourcesTable).where(eq(discoveredSourcesTable.status, "PROPOSED"));

    return {
      sources: {
        total: sourceRows.length,
        active: activeSources,
        configured: configuredSources,
        searchOnly: searchOnlySources,
        degraded: degradedSources,
        disabled: disabledSources,
      },
      jobs: {
        total: totalJobs,
        byStatus: countsByStatus,
        strongMatches: countsByStatus["STRONG_MATCH"] || countsByStatus["MATCHED"] || 0,
        potentialMatches: countsByStatus["POTENTIAL_MATCH"] || countsByStatus["NEEDS_REVIEW"] || 0,
        notAMatch: countsByStatus["NOT_A_MATCH"] || countsByStatus["REJECTED"] || 0,
        insufficientInfo: countsByStatus["INSUFFICIENT_INFORMATION"] || 0,
        ineligible: countsByStatus["INELIGIBLE"] || 0,
        duplicates: duplicatesCount,
        provenanceRecords: provenanceCount,
        verifiedOpen: (countsByStatus["STRONG_MATCH"] || countsByStatus["MATCHED"] || 0) + (countsByStatus["POTENTIAL_MATCH"] || countsByStatus["NEEDS_REVIEW"] || 0) + (countsByStatus["VERIFIED"] || 0),
        expired: countsByStatus["EXPIRED"] || 0,
        aiEvaluatedCount,
      },
      sourceDiscovery: {
        pendingProposals,
      },
      lastRunAt: new Date().toISOString(),
    };
  }
}
