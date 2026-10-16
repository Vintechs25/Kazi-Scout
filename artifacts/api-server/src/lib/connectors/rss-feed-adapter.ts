import { secureFetch } from "./http-client";
import type { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";

function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRssXml(xml: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = [];
  const itemMatches = xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi);

  for (const match of itemMatches) {
    const itemXml = match[1];
    const item: Record<string, string> = {};

    const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/i);
    item.title = (titleMatch ? (titleMatch[1] || titleMatch[2]) : "").trim();

    const linkMatch = itemXml.match(/<link>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/link>/i);
    item.link = (linkMatch ? (linkMatch[1] || linkMatch[2]) : "").trim();

    const descMatch = itemXml.match(/<(?:description|content:encoded)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/(?:description|content:encoded)>/i);
    item.description = (descMatch ? (descMatch[1] || descMatch[2]) : "").trim();

    const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    item.pubDate = (pubDateMatch ? pubDateMatch[1] : "").trim();

    const categoryMatches = Array.from(itemXml.matchAll(/<category>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/category>/gi));
    item.categories = categoryMatches.map((m) => m[1] || m[2]).join(", ");

    if (item.title && (item.link || item.description)) {
      items.push(item);
    }
  }

  // Also check Atom <entry> format if no items found
  if (items.length === 0) {
    const entryMatches = xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi);
    for (const match of entryMatches) {
      const entryXml = match[1];
      const item: Record<string, string> = {};

      const titleMatch = entryXml.match(/<title[\s>](?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/i);
      item.title = (titleMatch ? (titleMatch[1] || titleMatch[2]) : "").trim();

      const linkMatch = entryXml.match(/<link[^>]+href=["']([^"']+)["']/i);
      item.link = (linkMatch ? linkMatch[1] : "").trim();

      const summaryMatch = entryXml.match(/<(?:summary|content)[\s>](?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/(?:summary|content)>/i);
      item.description = (summaryMatch ? (summaryMatch[1] || summaryMatch[2]) : "").trim();

      const updatedMatch = entryXml.match(/<(?:updated|published)>([\s\S]*?)<\/(?:updated|published)>/i);
      item.pubDate = (updatedMatch ? updatedMatch[1] : "").trim();

      if (item.title) items.push(item);
    }
  }

  return items;
}

export class RssFeedAdapter implements IJobConnector {
  readonly connectorType = "RSS_FEED";

  validateConfiguration(source: JobSourceRecord): boolean {
    return Boolean(source.canonicalUrl && (source.canonicalUrl.startsWith("http://") || source.canonicalUrl.startsWith("https://")));
  }

  getCapabilities(_source: JobSourceRecord): ConnectorCapabilities {
    return {
      supportsApi: false,
      supportsFeed: true,
      supportsHtml: false,
      supportsSearchOnly: false,
      supportsApplicationRedirect: true,
      supportsFullDescriptionExtraction: false,
      paginationSupported: false,
      rateLimitPerMinute: 60,
    };
  }

  async healthCheck(source: JobSourceRecord): Promise<ConnectorHealthReport> {
    const startTime = Date.now();
    try {
      const config = (source.config as any) || {};
      const targetUrl = config.itFeed || config.feedUrl || (source as any).feedUrl || source.canonicalUrl;
      const res = await secureFetch(targetUrl, { timeoutMs: 12_000 });
      return {
        sourceId: source.id,
        ok: res.ok,
        status: res.ok ? "ACTIVE" : "DEGRADED",
        statusCode: res.status,
        responseTimeMs: res.elapsedMs,
        message: res.ok ? "Feed reachable and responding" : `HTTP ${res.status}: ${res.statusText}`,
        timestamp: new Date(),
      };
    } catch (err: any) {
      return {
        sourceId: source.id,
        ok: false,
        status: "ERROR",
        responseTimeMs: Date.now() - startTime,
        message: err.message || "Failed to reach feed",
        timestamp: new Date(),
      };
    }
  }

  async discoverListings(source: JobSourceRecord, filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    const config = (source.config as any) || {};
    const isSearchingIt = (filter?.keywords || []).some(k =>
      /\b(it|ict|tech|software|developer|programmer|engineer|network|cloud|sysadmin|cyber)\b/i.test(k)
    );

    const feedUrls: string[] = Array.from(new Set([
      config.feedUrl,
      (source as any).feedUrl,
      source.canonicalUrl.endsWith("/feed") || source.canonicalUrl.endsWith("/feed/") ? source.canonicalUrl : null,
      source.canonicalUrl.replace(/\/+$/, "") + "/feed/",
      source.canonicalUrl,
      ...(isSearchingIt ? [config.itFeed] : []),
    ].filter(Boolean) as string[]));

    let rawItems: Array<Record<string, string>> = [];
    let fallbackHtml: string | null = null;
    let fallbackUrl: string = source.canonicalUrl;

    for (const url of feedUrls) {
      try {
        const res = await secureFetch(url, { timeoutMs: 7_000 });
        if (!res.ok) continue;

        const parsed = parseRssXml(res.text);
        if (parsed.length > 0) {
          rawItems = parsed;
          break;
        } else if (!fallbackHtml && res.text.includes("<html")) {
          fallbackHtml = res.text;
          fallbackUrl = url;
        }
      } catch {
        // try next candidate feed URL
      }
    }

    const limit = filter?.limit ?? 40;

    // If XML was parsed successfully
    if (rawItems.length > 0) {
      return rawItems.slice(0, limit).map((item, idx) => {
        let title = item.title;
        let company = source.name;

        if (title.includes(" at ")) {
          const parts = title.split(" at ");
          title = parts[0].trim();
          company = parts.slice(1).join(" at ").trim();
        } else if (title.includes(" - ")) {
          const parts = title.split(" - ");
          title = parts[0].trim();
          if (parts.length > 1 && parts[1].length < 40) {
            company = parts[1].trim();
          }
        }

        const desc = cleanHtml(item.description);
        const postedDate = item.pubDate ? new Date(item.pubDate) : new Date();

        return {
          id: `${source.id}-${Buffer.from(item.link || `${title}-${idx}`).toString("base64").slice(0, 20)}`,
          sourceId: source.id,
          sourceName: source.name,
          externalJobId: item.link || undefined,
          title,
          company,
          location: source.country === "Kenya" ? "Nairobi, Kenya" : "Remote",
          county: source.country === "Kenya" ? "Nairobi" : null,
          country: source.country || "Kenya",
          remote: source.category === "GLOBAL_REMOTE" || /remote|work from home/i.test(`${title} ${desc}`),
          salary: null,
          description: desc.slice(0, 4000),
          url: item.link || source.canonicalUrl,
          sourceUrl: item.link || source.canonicalUrl,
          applicationUrl: item.link || source.canonicalUrl,
          postedDate: isNaN(postedDate.getTime()) ? new Date() : postedDate,
          jobType: "Full-time",
          skills: item.categories ? item.categories.split(",").map((s) => s.trim()) : [],
          rawPayload: item,
        };
      });
    }

    // Fallback: If feed returned HTML instead of XML, extract HTML job links
    if (fallbackHtml) {
      const items: NormalizedListing[] = [];
      const origin = new URL(fallbackUrl).origin;
      const seenUrls = new Set<string>();

      const cardMatches = fallbackHtml.matchAll(/<a[^>]+href=["']([^"']*(?:\/listings\/|\/job\/|\/jobs\/|\/vacancy\/|\/careers\/)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
      for (const match of cardMatches) {
        if (items.length >= limit) break;
        const rawUrl = match[1];
        let fullUrl = rawUrl.startsWith("http") ? rawUrl : `${origin}${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
        if (seenUrls.has(fullUrl)) continue;

        const inner = match[2];
        const titleMatch = inner.match(/<(?:h[1-6]|p|span|div)[^>]*class=["'][^"']*(?:text-lg|text-xl|title|heading|job-title|font-medium)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h[1-6]|p|span|div)>/i) ||
                           inner.match(/<(?:h[1-6]|strong|b)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b)>/i);
        const rawTitle = titleMatch ? cleanHtml(titleMatch[1]) : cleanHtml(inner);

        if (rawTitle.length > 5 && rawTitle.length < 120 && !/privacy|terms|login|register|apply now|post a job/i.test(rawTitle)) {
          seenUrls.add(fullUrl);
          items.push({
            id: `${source.id}-${Buffer.from(fullUrl).toString("base64").slice(0, 20)}`,
            sourceId: source.id,
            sourceName: source.name,
            externalJobId: fullUrl,
            title: rawTitle,
            company: source.name,
            location: source.country === "Kenya" ? "Nairobi, Kenya" : "Remote",
            county: source.country === "Kenya" ? "Nairobi" : null,
            country: source.country || "Kenya",
            remote: source.category === "GLOBAL_REMOTE",
            salary: null,
            description: `Recruitment notice from ${source.name}: ${rawTitle}. Apply on official portal.`,
            url: fullUrl,
            sourceUrl: fullUrl,
            applicationUrl: fullUrl,
            postedDate: new Date(),
            jobType: "Full-time",
            skills: [],
          });
        }
      }
      return items;
    }

    return [];
  }
}
