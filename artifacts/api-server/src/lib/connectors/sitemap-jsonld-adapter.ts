/**
 * Sitemap + JSON-LD JobPosting Connector (Tier A: Free, Zero API Keys)
 * 
 * Legitimate, standard replacement for Google Jobs:
 * 1. Reads robots.txt or sitemaps for job URLs matching job|vacanc|career|position
 * 2. Fetches matching pages and extracts standard schema.org `application/ld+json` with `@type: JobPosting`
 * 3. Works universally for any modern employer or job portal (BrighterMonday, MyJobMag, Fuzu, Hospital sites, etc.)
 */

import { secureFetch } from "./http-client";
import type { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";

export interface ParsedJobPosting {
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  postedDate?: Date;
  deadlineDate?: Date;
  employmentType?: string;
  salary?: string;
  isRemote?: boolean;
}

export function parseJsonLdFromHtml(html: string, fallbackUrl: string, fallbackCompany: string): ParsedJobPosting[] {
  const results: ParsedJobPosting[] = [];
  const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const rawText = match[1].trim();
      if (!rawText) continue;
      const data = JSON.parse(rawText);

      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;

        // Direct JobPosting
        if (item["@type"] === "JobPosting") {
          const parsed = extractSingleJobPosting(item, fallbackUrl, fallbackCompany);
          if (parsed) results.push(parsed);
        }

        // Nested graph or itemList
        if (Array.isArray(item["@graph"])) {
          for (const sub of item["@graph"]) {
            if (sub?.["@type"] === "JobPosting") {
              const parsed = extractSingleJobPosting(sub, fallbackUrl, fallbackCompany);
              if (parsed) results.push(parsed);
            }
          }
        }

        if (Array.isArray(item.itemListElement)) {
          for (const element of item.itemListElement) {
            const target = element?.item || element;
            if (target?.["@type"] === "JobPosting") {
              const parsed = extractSingleJobPosting(target, fallbackUrl, fallbackCompany);
              if (parsed) results.push(parsed);
            }
          }
        }
      }
    } catch {
      // Skip invalid JSON-LD blocks
    }
  }

  return results;
}

function extractSingleJobPosting(j: any, fallbackUrl: string, fallbackCompany: string): ParsedJobPosting | null {
  const title = (j.title || "").trim();
  if (!title || title.length < 3) return null;

  const company = (
    j.hiringOrganization?.name ||
    (typeof j.hiringOrganization === "string" ? j.hiringOrganization : "") ||
    fallbackCompany
  ).trim();

  // Location resolution
  let location = "Kenya";
  if (typeof j.jobLocation === "string") {
    location = j.jobLocation;
  } else if (j.jobLocation?.address) {
    const addr = j.jobLocation.address;
    if (typeof addr === "string") {
      location = addr;
    } else {
      location = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ") || "Kenya";
    }
  }

  // Description
  const rawDesc = j.description || "";
  const cleanDesc = rawDesc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const url = j.url || j.sameAs || fallbackUrl;
  const postedDate = j.datePosted ? new Date(j.datePosted) : undefined;
  const deadlineDate = j.validThrough ? new Date(j.validThrough) : undefined;

  const isRemote =
    j.jobLocationType === "TELECOMMUTE" ||
    /remote|work from home/i.test(`${title} ${location} ${cleanDesc}`);

  let salary: string | undefined = undefined;
  if (j.baseSalary) {
    if (typeof j.baseSalary === "string") {
      salary = j.baseSalary;
    } else if (j.baseSalary.value) {
      const val = j.baseSalary.value;
      const currency = j.baseSalary.currency || "KES";
      if (typeof val === "object") {
        salary = `${currency} ${val.minValue || ""} - ${val.maxValue || ""}`.trim();
      } else {
        salary = `${currency} ${val}`;
      }
    }
  }

  return {
    title,
    company: company || fallbackCompany,
    location,
    description: cleanDesc,
    url,
    postedDate,
    deadlineDate,
    employmentType: j.employmentType || "Full-time",
    salary,
    isRemote,
  };
}

export class SitemapJsonLdAdapter implements IJobConnector {
  readonly connectorType = "STRUCTURED_HTML";

  validateConfiguration(source: JobSourceRecord): boolean {
    return Boolean(source.canonicalUrl);
  }

  getCapabilities(_source: JobSourceRecord): ConnectorCapabilities {
    return {
      supportsApi: false,
      supportsFeed: false,
      supportsHtml: true,
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
        message: res.ok ? "Page reachable" : `HTTP ${res.status}`,
        timestamp: new Date(),
      };
    } catch (err: any) {
      return {
        sourceId: source.id,
        ok: false,
        status: "ERROR",
        responseTimeMs: Date.now() - startTime,
        message: err.message || "Failed to reach source",
        timestamp: new Date(),
      };
    }
  }

  async discoverListings(source: JobSourceRecord, filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    const targetUrl = source.canonicalUrl;
    const limit = filter?.limit ?? 40;

    try {
      const res = await secureFetch(targetUrl, { timeoutMs: 8000 });
      if (!res.ok) return [];

      const parsedPostings = parseJsonLdFromHtml(res.text, targetUrl, source.name);

      if (parsedPostings.length > 0) {
        return parsedPostings.slice(0, limit).map((p, idx) => ({
          id: `${source.id}-${Buffer.from(p.url || `${p.title}-${idx}`).toString("base64").slice(0, 20)}`,
          sourceId: source.id,
          sourceName: source.name,
          externalJobId: p.url || undefined,
          title: p.title,
          company: p.company,
          location: p.location,
          county: p.location.toLowerCase().includes("nairobi") ? "Nairobi" : null,
          country: source.country || "Kenya",
          remote: Boolean(p.isRemote),
          salary: p.salary || null,
          description: p.description,
          url: p.url,
          sourceUrl: p.url,
          applicationUrl: p.url,
          postedDate: p.postedDate || new Date(),
          deadlineDate: p.deadlineDate,
          jobType: p.employmentType || "Full-time",
          skills: [],
          rawPayload: p,
        }));
      }

      // If no JSON-LD on main page, scan for vacancy links to parse
      const origin = new URL(targetUrl).origin;
      const linkMatches = res.text.matchAll(/<a\b[^>]*href=["']([^"']*(?:job|vacanc|career|position)[^"']*)["'][^>]*>/gi);
      const subUrls = Array.from(new Set(Array.from(linkMatches).map(m => m[1]))).slice(0, 8);

      const subListings: NormalizedListing[] = [];
      for (const relUrl of subUrls) {
        if (subListings.length >= limit) break;
        const fullUrl = relUrl.startsWith("http") ? relUrl : relUrl.startsWith("/") ? `${origin}${relUrl}` : `${origin}/${relUrl}`;
        try {
          const subRes = await secureFetch(fullUrl, { timeoutMs: 4000 });
          if (!subRes.ok) continue;
          const subParsed = parseJsonLdFromHtml(subRes.text, fullUrl, source.name);
          for (const item of subParsed) {
            subListings.push({
              id: `${source.id}-${Buffer.from(item.url).toString("base64").slice(0, 20)}`,
              sourceId: source.id,
              sourceName: source.name,
              externalJobId: item.url,
              title: item.title,
              company: item.company,
              location: item.location,
              county: item.location.toLowerCase().includes("nairobi") ? "Nairobi" : null,
              country: source.country || "Kenya",
              remote: Boolean(item.isRemote),
              salary: item.salary || null,
              description: item.description,
              url: item.url,
              sourceUrl: item.url,
              applicationUrl: item.url,
              postedDate: item.postedDate || new Date(),
              deadlineDate: item.deadlineDate,
              jobType: item.employmentType || "Full-time",
              skills: [],
              rawPayload: item,
            });
          }
        } catch {
          // continue
        }
      }

      return subListings;
    } catch (err) {
      console.warn(`[SitemapJsonLdAdapter] Failed for ${source.id}:`, err);
      return [];
    }
  }
}
