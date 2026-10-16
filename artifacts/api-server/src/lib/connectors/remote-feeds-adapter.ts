/**
 * Free Remote Feeds Adapter (Tier A: Free, Zero API Keys)
 * 
 * Aggregates verified free remote job feeds:
 * 1. Remotive (`https://remotive.com/api/remote-jobs`)
 * 2. RemoteOK (`https://remoteok.com/api`)
 * 3. We Work Remotely RSS (`https://weworkremotely.com/remote-jobs.rss`)
 * 4. Arbeitnow (`https://www.arbeitnow.com/api/job-board-api`)
 * 5. Himalayas (`https://himalayas.app/jobs/api`)
 * 6. Jobicy (`https://jobicy.com/api/v2/remote-jobs`)
 */

import { secureFetch } from "./http-client";
import type { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";

export class RemoteFeedsAdapter implements IJobConnector {
  readonly connectorType = "JSON_API";

  validateConfiguration(source: JobSourceRecord): boolean {
    return Boolean(source.canonicalUrl);
  }

  getCapabilities(_source: JobSourceRecord): ConnectorCapabilities {
    return {
      supportsApi: true,
      supportsFeed: true,
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
      const res = await secureFetch(source.canonicalUrl, { timeoutMs: 8000 });
      return {
        sourceId: source.id,
        ok: res.ok,
        status: res.ok ? "ACTIVE" : "DEGRADED",
        statusCode: res.status,
        responseTimeMs: res.elapsedMs,
        message: res.ok ? "Remote feed reachable" : `HTTP ${res.status}`,
        timestamp: new Date(),
      };
    } catch (err: any) {
      return {
        sourceId: source.id,
        ok: false,
        status: "ERROR",
        responseTimeMs: Date.now() - startTime,
        message: err.message || "Failed to reach remote feed",
        timestamp: new Date(),
      };
    }
  }

  async discoverListings(source: JobSourceRecord, filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    const limit = filter?.limit ?? 40;
    const url = source.canonicalUrl;

    try {
      // 1. Remotive API
      if (url.includes("remotive.com")) {
        const res = await secureFetch("https://remotive.com/api/remote-jobs", { timeoutMs: 8000 });
        if (!res.ok) return [];
        const data = JSON.parse(res.text) as { jobs?: any[] };
        const jobs = data.jobs || [];
        return jobs.slice(0, limit).map((j: any) => ({
          id: `remotive-${j.id}`,
          sourceId: source.id,
          sourceName: "Remotive",
          externalJobId: String(j.id),
          title: j.title || "",
          company: j.company_name || "Remote Employer",
          location: j.candidate_required_location || "Worldwide Remote",
          county: null,
          country: "Worldwide",
          remote: true,
          salary: j.salary || null,
          description: (j.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          url: j.url || `https://remotive.com/jobs/${j.id}`,
          sourceUrl: j.url,
          applicationUrl: j.url,
          postedDate: j.publication_date ? new Date(j.publication_date) : new Date(),
          jobType: j.job_type || "Full-time",
          skills: Array.isArray(j.tags) ? j.tags : [],
          rawPayload: j,
        }));
      }

      // 2. RemoteOK API
      if (url.includes("remoteok.com")) {
        const res = await secureFetch("https://remoteok.com/api", {
          timeoutMs: 8000,
          headers: { "User-Agent": "KaziScout/2.0 (contact@vintechsystems.com)" }
        });
        if (!res.ok) return [];
        const items = JSON.parse(res.text);
        if (!Array.isArray(items)) return [];
        // First element is metadata / legal disclaimer
        const jobs = items.filter((i: any) => i.id && i.position);
        return jobs.slice(0, limit).map((j: any) => ({
          id: `remoteok-${j.id}`,
          sourceId: source.id,
          sourceName: "RemoteOK",
          externalJobId: String(j.id),
          title: j.position || "",
          company: j.company || "Remote Employer",
          location: j.location || "Worldwide Remote",
          county: null,
          country: "Worldwide",
          remote: true,
          salary: j.salary || null,
          description: (j.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          url: j.url || `https://remoteok.com/remote-jobs/${j.id}`,
          sourceUrl: j.url,
          applicationUrl: j.apply_url || j.url,
          postedDate: j.date ? new Date(j.date) : new Date(),
          jobType: "Full-time",
          skills: Array.isArray(j.tags) ? j.tags : [],
          rawPayload: j,
        }));
      }

      // 3. Arbeitnow API
      if (url.includes("arbeitnow.com")) {
        const res = await secureFetch("https://www.arbeitnow.com/api/job-board-api", { timeoutMs: 8000 });
        if (!res.ok) return [];
        const data = JSON.parse(res.text) as { data?: any[] };
        const jobs = data.data || [];
        return jobs.slice(0, limit).map((j: any) => ({
          id: `arbeitnow-${j.slug || j.id}`,
          sourceId: source.id,
          sourceName: "Arbeitnow",
          externalJobId: j.slug || String(j.id),
          title: j.title || "",
          company: j.company_name || "Employer",
          location: j.location || "Remote",
          county: null,
          country: "Worldwide",
          remote: Boolean(j.remote),
          salary: null,
          description: (j.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          url: j.url,
          sourceUrl: j.url,
          applicationUrl: j.url,
          postedDate: j.created_at ? new Date(j.created_at * 1000) : new Date(),
          jobType: j.job_types?.[0] || "Full-time",
          skills: Array.isArray(j.tags) ? j.tags : [],
          rawPayload: j,
        }));
      }

      // 4. Jobicy API
      if (url.includes("jobicy.com")) {
        const res = await secureFetch("https://jobicy.com/api/v2/remote-jobs?count=50", { timeoutMs: 8000 });
        if (!res.ok) return [];
        const data = JSON.parse(res.text) as { jobs?: any[] };
        const jobs = data.jobs || [];
        return jobs.slice(0, limit).map((j: any) => ({
          id: `jobicy-${j.id}`,
          sourceId: source.id,
          sourceName: "Jobicy",
          externalJobId: String(j.id),
          title: j.jobTitle || "",
          company: j.companyName || "Remote Employer",
          location: j.jobGeo || "Worldwide Remote",
          county: null,
          country: "Worldwide",
          remote: true,
          salary: j.annualSalaryMin ? `${j.salaryCurrency || "USD"} ${j.annualSalaryMin} - ${j.annualSalaryMax}` : null,
          description: (j.jobDescription || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          url: j.url,
          sourceUrl: j.url,
          applicationUrl: j.url,
          postedDate: j.pubDate ? new Date(j.pubDate) : new Date(),
          jobType: j.jobType || "Full-time",
          skills: [],
          rawPayload: j,
        }));
      }

      return [];
    } catch (err) {
      console.warn(`[RemoteFeedsAdapter] Error fetching ${source.id}:`, err);
      return [];
    }
  }
}
