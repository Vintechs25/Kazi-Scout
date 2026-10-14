import { secureFetch } from "./http-client";
import type { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";

function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export class JsonApiAdapter implements IJobConnector {
  readonly connectorType = "JSON_API";

  validateConfiguration(source: JobSourceRecord): boolean {
    return Boolean(source.canonicalUrl && (source.canonicalUrl.startsWith("http://") || source.canonicalUrl.startsWith("https://")));
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
    const startTime = Date.now();
    try {
      const res = await secureFetch(source.canonicalUrl, { timeoutMs: 12_000 });
      return {
        sourceId: source.id,
        ok: res.ok,
        status: res.ok ? "ACTIVE" : "DEGRADED",
        statusCode: res.status,
        responseTimeMs: res.elapsedMs,
        message: res.ok ? "JSON API responding normally" : `HTTP ${res.status}: ${res.statusText}`,
        timestamp: new Date(),
      };
    } catch (err: any) {
      return {
        sourceId: source.id,
        ok: false,
        status: "ERROR",
        responseTimeMs: Date.now() - startTime,
        message: err.message || "Failed to reach JSON API",
        timestamp: new Date(),
      };
    }
  }

  async discoverListings(source: JobSourceRecord, filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    const res = await secureFetch(source.canonicalUrl, { timeoutMs: 15_000 });
    if (!res.ok) return [];

    let data: any;
    try {
      data = res.json();
    } catch {
      return [];
    }

    // Common JSON schema envelopes: data.jobs, data.data, data.results, or data as array
    const rawItems: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data.jobs)
      ? data.jobs
      : Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.results)
      ? data.results
      : [];

    const limit = filter?.limit ?? 40;

    return rawItems.slice(0, limit).map((item, idx) => {
      const title = String(item.jobTitle || item.title || item.role || item.position || "Developer").trim();
      const company = String(item.companyName || item.company_name || item.company || source.name).trim();
      const rawDesc = String(item.jobDescription || item.description || item.body || "");
      const desc = cleanHtml(rawDesc);
      const url = item.url || item.applyUrl || item.link || source.canonicalUrl;
      const location = item.jobGeo || item.candidate_required_location || item.location || "Worldwide Remote";
      const remote = source.category === "GLOBAL_REMOTE" || Boolean(item.remote) || /remote/i.test(location);

      let salary: string | null = null;
      if (item.annualSalaryMin) {
        salary = `$${item.annualSalaryMin.toLocaleString()} - $${(item.annualSalaryMax || item.annualSalaryMin).toLocaleString()}`;
      } else if (item.salary) {
        salary = String(item.salary);
      }

      const postedDate = item.pubDate || item.publication_date || item.createdAt || item.date;
      const parsedDate = postedDate ? new Date(postedDate) : new Date();

      return {
        id: `${source.id}-${item.id || idx}`,
        sourceId: source.id,
        sourceName: source.name,
        externalJobId: String(item.id || `ext-${idx}`),
        title,
        company,
        location,
        county: null,
        country: source.country || "Kenya",
        remote,
        salary,
        description: desc.slice(0, 4000),
        url,
        sourceUrl: url,
        applicationUrl: item.url || item.applyUrl || null,
        postedDate: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
        jobType: Array.isArray(item.jobType) ? item.jobType[0] : (item.jobType || "Full-time"),
        skills: Array.isArray(item.tags) ? item.tags : (item.skills || []),
        rawPayload: item,
      };
    });
  }
}
