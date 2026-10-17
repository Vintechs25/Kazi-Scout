import { secureFetch } from "./http-client";
import type { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";

function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class StructuredHtmlAdapter implements IJobConnector {
  readonly connectorType = "STRUCTURED_HTML";

  validateConfiguration(source: JobSourceRecord): boolean {
    return Boolean(source.canonicalUrl && (source.canonicalUrl.startsWith("http://") || source.canonicalUrl.startsWith("https://")));
  }

  getCapabilities(_source: JobSourceRecord): ConnectorCapabilities {
    return {
      supportsApi: false,
      supportsFeed: false,
      supportsHtml: true,
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
      const config = (source.config as any) || {};
      const targetUrl = config.searchUrl || config.vacanciesUrl || config.careersUrl || config.itVacancies || source.canonicalUrl;
      const res = await secureFetch(targetUrl, { timeoutMs: 12_000 });
      return {
        sourceId: source.id,
        ok: res.ok,
        status: res.ok ? "ACTIVE" : "DEGRADED",
        statusCode: res.status,
        responseTimeMs: res.elapsedMs,
        message: res.ok ? "Structured HTML portal reachable" : `HTTP ${res.status}: ${res.statusText}`,
        timestamp: new Date(),
      };
    } catch (err: any) {
      return {
        sourceId: source.id,
        ok: false,
        status: "ERROR",
        responseTimeMs: Date.now() - startTime,
        message: err.message || "Failed to reach HTML source",
        timestamp: new Date(),
      };
    }
  }

  async discoverListings(source: JobSourceRecord, filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    const config = (source.config as any) || {};
    const isSearchingIt = (filter?.keywords || []).some(k =>
      /\b(it|ict|tech|software|developer|programmer|engineer|network|cloud|sysadmin|cyber)\b/i.test(k)
    );

    const keywords = filter?.keywords || [];
    const roleQueryUrls: string[] = [];
    if (keywords.length > 0) {
      for (const k of keywords.slice(0, 3)) {
        if (source.id === "brightermonday") {
          roleQueryUrls.push(`https://www.brightermonday.co.ke/jobs?q=${encodeURIComponent(k)}`);
        } else if (source.id === "myjobmag") {
          roleQueryUrls.push(`https://www.myjobmag.co.ke/search/jobs?q=${encodeURIComponent(k)}`);
        } else if (source.id === "jobwebkenya") {
          roleQueryUrls.push(`https://jobwebkenya.com/?s=${encodeURIComponent(k)}`);
        } else if (source.id === "kenyajob") {
          roleQueryUrls.push(`https://www.kenyajob.com/job-vacancies-search-kenya?motcle=${encodeURIComponent(k)}`);
        }
      }
    }

    const candidateUrls: string[] = Array.from(new Set([
      ...roleQueryUrls,
      config.vacanciesUrl,
      config.careersUrl,
      config.allJobs,
      config.searchUrl,
      source.canonicalUrl,
      ...(isSearchingIt ? [config.itVacancies, config.itFeed] : []),
    ].filter(Boolean) as string[]));

    const items: NormalizedListing[] = [];
    const limit = filter?.limit ?? 40;
    const seenUrls = new Set<string>();

    const isGarbage = (text: string) => {
      if (!text || text.length < 4 || text.length > 150) return true;
      return /privacy|terms|cookie|login|sign in|register|forgot password|read more|view more|all rights reserved|click here|home|about us|contact us|apply now|post a job|create job|employer/i.test(text);
    };

    for (const targetUrl of candidateUrls) {
      if (items.length >= limit) break;
      try {
        const res = await secureFetch(targetUrl, { timeoutMs: 7_000 });
        if (!res.ok) continue;

        const html = res.text;
        const origin = new URL(targetUrl).origin;

        const sanitizeUrl = (rawUrl: string): string | null => {
          if (!rawUrl) return null;
          let u = rawUrl.trim();
          if (u.startsWith("javascript:") || u.startsWith("#") || u.startsWith("mailto:")) return null;
          if (/\b(?:create|employer|account|login|signup|register|pricing)\b/i.test(u)) return null;
          if (u.startsWith("//")) return "https:" + u;
          if (u.startsWith("/")) return `${origin}${u}`;
          if (!u.startsWith("http")) return `${origin}/${u}`;
          return u;
        };

        // Pattern 1: Heading links: <h[1-5]><a href="...">Title</a></h[1-5]>
        const hMatches = html.matchAll(/<h[1-5][^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h[1-5]>/gi);
        for (const match of hMatches) {
          if (items.length >= limit) break;
          const fullUrl = sanitizeUrl(match[1]);
          const rawTitle = cleanHtml(match[2]);
          if (fullUrl && !seenUrls.has(fullUrl) && !isGarbage(rawTitle)) {
            seenUrls.add(fullUrl);
            let title = rawTitle;
            let company = source.name;
            if (rawTitle.includes(" at ")) {
              const parts = rawTitle.split(" at ");
              title = parts[0].trim();
              company = parts.slice(1).join(" at ").trim();
            } else if (rawTitle.includes(" - ")) {
              const parts = rawTitle.split(" - ");
              title = parts[0].trim();
              if (parts.length > 1 && parts[1].length < 40) company = parts[1].trim();
            }

            items.push({
              id: `${source.id}-${Buffer.from(fullUrl).toString("base64").slice(0, 20)}`,
              sourceId: source.id,
              sourceName: source.name,
              externalJobId: fullUrl,
              title,
              company,
              location: source.country === "Kenya" ? "Nairobi, Kenya" : "Remote",
              county: source.country === "Kenya" ? "Nairobi" : null,
              country: source.country || "Kenya",
              remote: source.category === "GLOBAL_REMOTE",
              salary: null,
              description: `Public recruitment notice from ${company}: ${title}. Apply directly via the official portal.`,
              url: fullUrl,
              sourceUrl: fullUrl,
              applicationUrl: fullUrl,
              postedDate: new Date(),
              jobType: "Full-time",
              skills: [],
            });
          }
        }

        // Pattern 2: Listing card links: <a href=".../listings/...|.../job/..."><p|h3|span class="...">Title</p|h3|span></a>
        const cardMatches = html.matchAll(/<a[^>]+href=["']([^"']*(?:\/listings\/|\/job\/|\/jobs\/|\/vacancy\/|\/vacancies\/|\/careers\/)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
        for (const match of cardMatches) {
          if (items.length >= limit) break;
          const fullUrl = sanitizeUrl(match[1]);
          if (!fullUrl || seenUrls.has(fullUrl)) continue;

          const inner = match[2];
          const titleMatch = inner.match(/<(?:h[1-6]|p|span|div)[^>]*class=["'][^"']*(?:text-lg|text-xl|title|heading|job-title|font-medium|font-semibold)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h[1-6]|p|span|div)>/i) ||
                             inner.match(/<(?:h[1-6]|strong|b)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b)>/i);
          const rawTitle = titleMatch ? cleanHtml(titleMatch[1]) : cleanHtml(inner);

          if (!isGarbage(rawTitle)) {
            seenUrls.add(fullUrl);
            let title = rawTitle;
            let company = source.name;
            if (rawTitle.includes(" at ")) {
              const parts = rawTitle.split(" at ");
              title = parts[0].trim();
              company = parts.slice(1).join(" at ").trim();
            }

            items.push({
              id: `${source.id}-${Buffer.from(fullUrl).toString("base64").slice(0, 20)}`,
              sourceId: source.id,
              sourceName: source.name,
              externalJobId: fullUrl,
              title,
              company,
              location: source.country === "Kenya" ? "Nairobi, Kenya" : "Remote",
              county: source.country === "Kenya" ? "Nairobi" : null,
              country: source.country || "Kenya",
              remote: source.category === "GLOBAL_REMOTE",
              salary: null,
              description: `Public recruitment notice from ${company}: ${title}. Apply directly via the official portal.`,
              url: fullUrl,
              sourceUrl: fullUrl,
              applicationUrl: fullUrl,
              postedDate: new Date(),
              jobType: "Full-time",
              skills: [],
            });
          }
        }

        // Pattern 3: Government / PSCK tabular vacancies
        const tableRowMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
        for (const trMatch of tableRowMatches) {
          if (items.length >= limit) break;
          const rowHtml = trMatch[1];
          const cells = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi))
            .map(c => cleanHtml(c[1]));

          // Typical PSCK / County table: cell 2 is Position, cell 4 is Ministry/Department, cell 9 is deadline
          if (cells.length >= 8 && cells[0].match(/^\d+$/)) {
            const title = cells[2];
            const ministry = cells[4] || source.name;
            const deadline = cells[9] || cells[cells.length - 2];
            const experience = cells[6] ? `${cells[6]} years required` : "";
            const rowUrl = `${origin}/loginPage.aspx`;

            if (title && title.length > 4 && !isGarbage(title) && !seenUrls.has(`${source.id}-${title}`)) {
              seenUrls.add(`${source.id}-${title}`);
              items.push({
                id: `${source.id}-${Buffer.from(title).toString("base64").slice(0, 20)}`,
                sourceId: source.id,
                sourceName: source.name,
                externalJobId: cells[1] || undefined,
                title,
                company: ministry,
                location: "Nairobi, Kenya",
                county: "Nairobi",
                country: "Kenya",
                remote: false,
                salary: cells[3] ? `Job Scale: ${cells[3]}` : null,
                description: `Official government vacancy announced by ${ministry}: ${title}. Advert No: ${cells[1] || "N/A"}. ${experience}. Apply online at PSC portal by ${deadline}.`,
                url: rowUrl,
                sourceUrl: rowUrl,
                applicationUrl: rowUrl,
                postedDate: new Date(),
                jobType: "Full-time",
                skills: [],
              });
            }
          }
        }

        // Pattern 4: PDF vacancy notices / government circulars
        const pdfMatches = html.matchAll(/<a[^>]+href=["']([^"']*(?:advert|vacancy|job|career|recruitment)[^"']*\.(?:pdf|docx?))["'][^>]*>([\s\S]*?)<\/a>/gi);
        for (const match of pdfMatches) {
          if (items.length >= limit) break;
          const fullUrl = sanitizeUrl(match[1]);
          const rawTitle = cleanHtml(match[2]);
          if (fullUrl && !seenUrls.has(fullUrl) && !isGarbage(rawTitle)) {
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
              description: `Official recruitment circular from ${source.name}: ${rawTitle}. Download document to view requirements and application guidelines.`,
              url: fullUrl,
              sourceUrl: fullUrl,
              applicationUrl: fullUrl,
              postedDate: new Date(),
              jobType: "Full-time",
              skills: [],
            });
          }
        }

      } catch {
        // Continue to next candidate URL
      }
    }

    return items;
  }
}
