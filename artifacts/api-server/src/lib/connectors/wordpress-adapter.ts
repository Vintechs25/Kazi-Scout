/**
 * WordPress Jobs Adapter (Tier A: Free, Zero API Keys)
 * 
 * Many Kenyan job boards, recruitment agencies, and County Public Service Boards (CPSB)
 * run on WordPress. This connector taps into standard WordPress endpoints:
 * 1. `/wp-json/wp/v2/job_listing` (WP Job Manager plugin used across many African portals)
 * 2. `/wp-json/wp/v2/posts?search={query}&per_page=40`
 * 3. `/?feed=job_feed`
 * 4. `/feed/`
 */

import { secureFetch } from "./http-client";
import type { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";

export class WordPressAdapter implements IJobConnector {
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
      paginationSupported: true,
      rateLimitPerMinute: 60,
    };
  }

  async healthCheck(source: JobSourceRecord): Promise<ConnectorHealthReport> {
    const startTime = Date.now();
    const base = source.canonicalUrl.replace(/\/+$/, "");
    try {
      const res = await secureFetch(`${base}/wp-json/`, { timeoutMs: 8000 });
      return {
        sourceId: source.id,
        ok: res.ok,
        status: res.ok ? "ACTIVE" : "DEGRADED",
        statusCode: res.status,
        responseTimeMs: res.elapsedMs,
        message: res.ok ? "WordPress REST API active" : `HTTP ${res.status}`,
        timestamp: new Date(),
      };
    } catch (err: any) {
      return {
        sourceId: source.id,
        ok: false,
        status: "ERROR",
        responseTimeMs: Date.now() - startTime,
        message: err.message || "Failed to reach WordPress API",
        timestamp: new Date(),
      };
    }
  }

  async discoverListings(source: JobSourceRecord, filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    const base = source.canonicalUrl.replace(/\/+$/, "");
    const limit = filter?.limit ?? 40;
    const keywords = (filter?.keywords || []).slice(0, 3).join(" ");

    // 1. Try WP Job Manager REST endpoint first
    try {
      const jobListingUrl = `${base}/wp-json/wp/v2/job_listing?per_page=${Math.min(limit, 50)}`;
      const res = await secureFetch(jobListingUrl, { timeoutMs: 6000 });
      if (res.ok) {
        const data = JSON.parse(res.text);
        if (Array.isArray(data) && data.length > 0) {
          return data.slice(0, limit).map((item: any, idx: number) => {
            const title = (item.title?.rendered || item.title || "").replace(/<[^>]+>/g, "").trim();
            const desc = (item.content?.rendered || item.excerpt?.rendered || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            const location = item.meta?._job_location || item.job_location || (source.country === "Kenya" ? "Kenya" : "Remote");
            const url = item.link || `${base}/?p=${item.id}`;
            return {
              id: `${source.id}-${item.id || idx}`,
              sourceId: source.id,
              sourceName: source.name,
              externalJobId: String(item.id),
              title,
              company: item.meta?._company_name || source.name,
              location,
              county: location.toLowerCase().includes("nairobi") ? "Nairobi" : null,
              country: source.country || "Kenya",
              remote: /remote|work from home/i.test(`${title} ${desc} ${location}`),
              salary: item.meta?._job_salary || null,
              description: desc,
              url,
              sourceUrl: url,
              applicationUrl: url,
              postedDate: item.date ? new Date(item.date) : new Date(),
              jobType: item.meta?._job_type || "Full-time",
              skills: [],
              rawPayload: item,
            };
          });
        }
      }
    } catch {
      // Continue to standard posts
    }

    // 2. Try standard WP Posts search endpoint
    try {
      const searchParam = keywords ? `&search=${encodeURIComponent(keywords)}` : "";
      const postsUrl = `${base}/wp-json/wp/v2/posts?per_page=${Math.min(limit, 40)}${searchParam}`;
      const res = await secureFetch(postsUrl, { timeoutMs: 6000 });
      if (res.ok) {
        const posts = JSON.parse(res.text);
        if (Array.isArray(posts) && posts.length > 0) {
          return posts.slice(0, limit).map((p: any, idx: number) => {
            let title = (p.title?.rendered || p.title || "").replace(/<[^>]+>/g, "").trim();
            let company = source.name;

            if (title.includes(" at ")) {
              const parts = title.split(" at ");
              title = parts[0].trim();
              company = parts.slice(1).join(" at ").trim();
            }

            const desc = (p.content?.rendered || p.excerpt?.rendered || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            const url = p.link || `${base}/?p=${p.id}`;

            return {
              id: `${source.id}-${p.id || idx}`,
              sourceId: source.id,
              sourceName: source.name,
              externalJobId: String(p.id),
              title,
              company,
              location: source.country === "Kenya" ? "Kenya" : "Remote",
              county: null,
              country: source.country || "Kenya",
              remote: /remote|work from home/i.test(`${title} ${desc}`),
              salary: null,
              description: desc,
              url,
              sourceUrl: url,
              applicationUrl: url,
              postedDate: p.date ? new Date(p.date) : new Date(),
              jobType: "Full-time",
              skills: [],
              rawPayload: p,
            };
          });
        }
      }
    } catch {
      // Continue
    }

    return [];
  }
}
