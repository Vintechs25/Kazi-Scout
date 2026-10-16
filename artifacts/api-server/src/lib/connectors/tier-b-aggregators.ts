/**
 * Tier B Free Key Aggregators
 * 
 * Free aggregators that require a free registration key:
 * 1. Jooble (`POST https://jooble.org/api/{key}`) - Best free aggregator for Kenya & Africa
 * 2. ReliefWeb (`https://api.reliefweb.int/v2/jobs`) - Humanitarian, NGO, health and medical roles
 * 
 * Safe Authentication Handling:
 * If no key is set in environment variables or configuration, the connector sets
 * status to `AUTH_REQUIRED` and quietly skips without failing discovery runs.
 */

import { secureFetch } from "./http-client";
import type { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";

export class JoobleAdapter implements IJobConnector {
  readonly connectorType = "JSON_API";

  private getKey(source: JobSourceRecord): string | null {
    const config = (source.config as any) || {};
    return config.apiKey || process.env.JOOBLE_API_KEY || null;
  }

  validateConfiguration(source: JobSourceRecord): boolean {
    return Boolean(this.getKey(source));
  }

  getCapabilities(_source: JobSourceRecord): ConnectorCapabilities {
    return {
      supportsApi: true,
      supportsFeed: false,
      supportsHtml: false,
      supportsSearchOnly: false,
      supportsApplicationRedirect: true,
      supportsFullDescriptionExtraction: true,
      paginationSupported: true,
      rateLimitPerMinute: 30,
    };
  }

  async healthCheck(source: JobSourceRecord): Promise<ConnectorHealthReport> {
    const key = this.getKey(source);
    if (!key) {
      return {
        sourceId: source.id,
        ok: false,
        status: "AUTH_REQUIRED",
        message: "Jooble API key not set (set JOOBLE_API_KEY in environment or settings)",
        timestamp: new Date(),
      };
    }

    try {
      const res = await secureFetch(`https://jooble.org/api/${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: "doctor", location: "Kenya", page: 1 }),
        timeoutMs: 8000,
      });
      return {
        sourceId: source.id,
        ok: res.ok,
        status: res.ok ? "ACTIVE" : "DEGRADED",
        statusCode: res.status,
        responseTimeMs: res.elapsedMs,
        message: res.ok ? "Jooble API active" : `HTTP ${res.status}`,
        timestamp: new Date(),
      };
    } catch (err: any) {
      return {
        sourceId: source.id,
        ok: false,
        status: "ERROR",
        message: err.message || "Failed to reach Jooble",
        timestamp: new Date(),
      };
    }
  }

  async discoverListings(source: JobSourceRecord, filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    const key = this.getKey(source);
    if (!key) {
      return []; // Skip quietly without throwing
    }

    const keywords = (filter?.keywords || ["jobs"]).join(" ");
    const location = source.country || "Kenya";
    const limit = filter?.limit ?? 40;

    try {
      const res = await secureFetch(`https://jooble.org/api/${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords,
          location,
          page: 1,
        }),
        timeoutMs: 8000,
      });

      if (!res.ok) return [];
      const data = JSON.parse(res.text);
      const jobs = data.jobs || [];

      return jobs.slice(0, limit).map((j: any, idx: number) => {
        const title = (j.title || "").replace(/<[^>]+>/g, "").trim();
        const company = (j.company || "Verified Employer").trim();
        const loc = j.location || location;
        const desc = (j.snippet || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const url = j.link || `https://jooble.org/desc/${j.id}`;

        return {
          id: `${source.id}-${j.id || idx}`,
          sourceId: source.id,
          sourceName: "Jooble",
          externalJobId: String(j.id),
          title,
          company,
          location: loc,
          county: loc.toLowerCase().includes("nairobi") ? "Nairobi" : null,
          country: location,
          remote: /remote|work from home/i.test(`${title} ${loc} ${desc}`),
          salary: j.salary || null,
          description: desc,
          url,
          sourceUrl: url,
          applicationUrl: url,
          postedDate: j.updated ? new Date(j.updated) : new Date(),
          jobType: j.type || "Full-time",
          skills: [],
          rawPayload: j,
        };
      });
    } catch {
      return [];
    }
  }
}

export class ReliefWebAdapter implements IJobConnector {
  readonly connectorType = "JSON_API";

  private getAppName(source: JobSourceRecord): string {
    const config = (source.config as any) || {};
    return config.appName || process.env.RELIEFWEB_APP_NAME || "kaziscout";
  }

  validateConfiguration(_source: JobSourceRecord): boolean {
    return true;
  }

  getCapabilities(_source: JobSourceRecord): ConnectorCapabilities {
    return {
      supportsApi: true,
      supportsFeed: false,
      supportsHtml: false,
      supportsSearchOnly: false,
      supportsApplicationRedirect: true,
      supportsFullDescriptionExtraction: true,
      paginationSupported: true,
      rateLimitPerMinute: 60,
    };
  }

  async healthCheck(source: JobSourceRecord): Promise<ConnectorHealthReport> {
    const appName = this.getAppName(source);
    try {
      const url = `https://api.reliefweb.int/v2/jobs?appname=${encodeURIComponent(appName)}&limit=1`;
      const res = await secureFetch(url, { timeoutMs: 8000 });
      return {
        sourceId: source.id,
        ok: res.ok,
        status: res.ok ? "ACTIVE" : "DEGRADED",
        statusCode: res.status,
        responseTimeMs: res.elapsedMs,
        message: res.ok ? "ReliefWeb API active" : `HTTP ${res.status}`,
        timestamp: new Date(),
      };
    } catch (err: any) {
      return {
        sourceId: source.id,
        ok: false,
        status: "ERROR",
        message: err.message || "Failed to reach ReliefWeb",
        timestamp: new Date(),
      };
    }
  }

  async discoverListings(source: JobSourceRecord, filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    const appName = this.getAppName(source);
    const limit = filter?.limit ?? 40;
    const keywords = (filter?.keywords || []).slice(0, 3).join(" ");

    try {
      // Kenya country ID in ReliefWeb is 131
      let url = `https://api.reliefweb.int/v2/jobs?appname=${encodeURIComponent(appName)}&profile=full&limit=${limit}&filter[field]=country.id&filter[value]=131`;
      if (keywords) {
        url += `&query[value]=${encodeURIComponent(keywords)}`;
      }

      const res = await secureFetch(url, { timeoutMs: 8000 });
      if (!res.ok) return [];

      const data = JSON.parse(res.text);
      const items = data.data || [];

      return items.map((item: any, idx: number) => {
        const fields = item.fields || {};
        const title = fields.title || "";
        const org = fields.source?.[0]?.name || "NGO / Humanitarian Employer";
        const desc = (fields.body || fields.bodyHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const itemUrl = fields.url || `https://reliefweb.int/job/${item.id}`;

        const closingDate = fields.date?.closing ? new Date(fields.date.closing) : undefined;
        const createdDate = fields.date?.created ? new Date(fields.date.created) : new Date();

        return {
          id: `reliefweb-${item.id || idx}`,
          sourceId: source.id,
          sourceName: "ReliefWeb Kenya",
          externalJobId: String(item.id),
          title,
          company: org,
          location: "Kenya",
          county: null,
          country: "Kenya",
          remote: false,
          salary: null,
          description: desc,
          url: itemUrl,
          sourceUrl: itemUrl,
          applicationUrl: itemUrl,
          postedDate: createdDate,
          deadlineDate: closingDate,
          jobType: fields.type?.[0]?.name || "Contract",
          skills: (fields.theme || []).map((t: any) => t.name),
          rawPayload: item,
        };
      });
    } catch {
      return [];
    }
  }
}
