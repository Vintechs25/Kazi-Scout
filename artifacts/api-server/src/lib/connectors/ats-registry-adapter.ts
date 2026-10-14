import { secureFetch } from "./http-client";
import type { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";
import { fetchAllAtsJobs } from "../ats-registry";

export class AtsRegistryAdapter implements IJobConnector {
  readonly connectorType = "ATS_REGISTRY";

  validateConfiguration(source: JobSourceRecord): boolean {
    return Boolean(source.canonicalUrl);
  }

  getCapabilities(_source: JobSourceRecord): ConnectorCapabilities {
    return {
      supportsApi: true,
      supportsFeed: false,
      supportsHtml: false,
      supportsSearchOnly: false,
      supportsApplicationRedirect: true,
      supportsFullDescriptionExtraction: true,
      paginationSupported: false,
      rateLimitPerMinute: 60,
    };
  }

  async healthCheck(source: JobSourceRecord): Promise<ConnectorHealthReport> {
    const startTime = Date.now();
    try {
      const res = await secureFetch(source.canonicalUrl, { timeoutMs: 12_000 });
      return {
        sourceId: source.id,
        ok: res.ok,
        status: res.ok ? "ACTIVE" : "DEGRADED",
        statusCode: res.status,
        responseTimeMs: res.elapsedMs,
        message: res.ok ? "ATS endpoint active" : `HTTP ${res.status}: ${res.statusText}`,
        timestamp: new Date(),
      };
    } catch (err: any) {
      return {
        sourceId: source.id,
        ok: false,
        status: "ERROR",
        responseTimeMs: Date.now() - startTime,
        message: err.message || "Failed to probe ATS",
        timestamp: new Date(),
      };
    }
  }

  async discoverListings(source: JobSourceRecord, filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    try {
      const allAts = await fetchAllAtsJobs();
      const limit = filter?.limit ?? 40;

      // Filter by company name if source is a specific company, or return all
      const matching = allAts.filter((item) => {
        if (!source.name || source.name === "ATS Registry") return true;
        return item.company.toLowerCase().includes(source.name.toLowerCase());
      });

      return matching.slice(0, limit).map((job, idx) => ({
        id: `${source.id}-${job.externalId || idx}`,
        sourceId: source.id,
        sourceName: `ATS (${job.company})`,
        externalJobId: job.externalId || undefined,
        title: job.title,
        company: job.company,
        location: job.location,
        county: job.location.toLowerCase().includes("nairobi") ? "Nairobi" : null,
        country: "Kenya",
        remote: job.remote,
        salary: null,
        description: job.description || `Vacancy at ${job.company}: ${job.title}`,
        url: job.url,
        sourceUrl: job.url,
        applicationUrl: job.url,
        postedDate: job.postedDate,
        jobType: "Full-time",
        skills: [],
        rawPayload: job,
      }));
    } catch (err) {
      console.error(`[AtsRegistryAdapter] Discovery failed for ${source.name}:`, err);
      return [];
    }
  }
}
