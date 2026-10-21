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
    const keywords = filter?.keywords || [];
    const isSearchingIt = keywords.some(k =>
      /\b(it|ict|tech|software|developer|programmer|engineer|network|cloud|sysadmin|cyber|frontend|backend|devops)\b/i.test(k)
    );
    const isSearchingHealth = keywords.some(k =>
      /\b(health|medical|doctor|surgeon|nurse|clinical|hospital|pharma|cpsb|county|physician|dentist|patholog|pediatric|anesthe|radiolog|midwife)\b/i.test(k)
    );
    const isSearchingFinance = keywords.some(k =>
      /\b(finance|financial|account|accountant|auditor|audit|tax|banking|banker|treasury|cpa|credit|actuarial)\b/i.test(k)
    );
    const isSearchingAgri = keywords.some(k =>
      /\b(agri|agriculture|agronomist|agribusiness|crop|horticulture|livestock|farm|farming|irrigation|veterinary)\b/i.test(k)
    );
    const isSearchingNgo = keywords.some(k =>
      /\b(ngo|humanitarian|development|relief|m&e|monitoring|un|unhcr|unicef|wash|grant|advocacy|community|social\s*work)\b/i.test(k)
    );
    const isSearchingProcurement = keywords.some(k =>
      /\b(procurement|supply\s*chain|purchasing|logistics|buyer|storekeeper|inventory|warehouse)\b/i.test(k)
    );
    const isSearchingHr = keywords.some(k =>
      /\b(hr|human\s*resources|talent|recruitment|people\s*operations|personnel|payroll)\b/i.test(k)
    );
    const isSearchingLegal = keywords.some(k =>
      /\b(legal|lawyer|advocate|paralegal|counsel|compliance|attorney|litigation|conveyancing)\b/i.test(k)
    );
    const isSearchingEngineering = keywords.some(k =>
      /\b(civil\s*engineer|mechanical\s*engineer|electrical\s*engineer|structural|surveyor|architect|engineering)\b/i.test(k)
    );
    const isSearchingEducation = keywords.some(k =>
      /\b(teacher|tutor|lecturer|professor|instructor|curriculum|dean|principal|headteacher|education|school)\b/i.test(k)
    );
    const limit = filter?.limit ?? 40;
    const items: NormalizedListing[] = [];
    const seenUrls = new Set<string>();

    const isGarbage = (text: string) => {
      if (!text || text.length < 4 || text.length > 150) return true;
      return /privacy|terms|cookie|login|sign in|register|forgot password|read more|view more|all rights reserved|click here|home|about us|contact us|apply now|post a job|create job|employer|job alert/i.test(text);
    };

    const isClosedOrExpired = (text: string) => {
      if (!text) return false;
      return /\b(job\s+closed|application\s+closed|applications\s+closed|position\s+closed|no\s+longer\s+accepting\s+applications|deadline\s+has\s+passed|vacancy\s+closed|this\s+job\s+has\s+expired|status:\s*closed)\b/i.test(text) ||
        /\b\[closed\]|\(closed\)|\b\[expired\]|\(expired\)/i.test(text);
    };

    const isIndexOrNavigationUrl = (u: string) => {
      if (!u) return true;
      return /\/(?:jobs|job-vacancies|vacancies|all-jobs|search|browse|category|categories|field|location|industry|login|signup|register|page\/\d+|sitemap|feeds?|tag|tags)\/?$/i.test(u) ||
        /\/(?:jobs-by-|jobs-location|vacancies-at-|careers-at-)/i.test(u);
    };

    // ==========================================
    // 1. BrighterMonday Specialized Extractor
    // Strictly extract /listings/{slug}-{id}
    // ==========================================
    if (source.id.includes("brightermonday")) {
      const bmPages: string[] = [];
      if (isSearchingHealth) {
        bmPages.push("https://www.brightermonday.co.ke/jobs/medical-pharmaceutical");
        bmPages.push("https://www.brightermonday.co.ke/jobs/medical-pharmaceutical/healthcare/nairobi");
      }
      if (isSearchingIt) {
        bmPages.push("https://www.brightermonday.co.ke/jobs/software-data");
      }
      if (isSearchingFinance) {
        bmPages.push("https://www.brightermonday.co.ke/jobs/accounting-auditing-finance");
      }
      if (isSearchingAgri) {
        bmPages.push("https://www.brightermonday.co.ke/jobs/farming-agriculture");
      }
      if (isSearchingNgo) {
        bmPages.push("https://www.brightermonday.co.ke/jobs/community-social-services");
      }
      if (isSearchingProcurement) {
        bmPages.push("https://www.brightermonday.co.ke/jobs/supply-chain-procurement");
      }
      if (isSearchingHr) {
        bmPages.push("https://www.brightermonday.co.ke/jobs/human-resources");
      }
      if (isSearchingLegal) {
        bmPages.push("https://www.brightermonday.co.ke/jobs/legal-services");
      }
      if (isSearchingEngineering) {
        bmPages.push("https://www.brightermonday.co.ke/jobs/engineering");
      }
      if (isSearchingEducation) {
        bmPages.push("https://www.brightermonday.co.ke/jobs/teaching-training");
      }
      for (const k of keywords.slice(0, 3)) {
        bmPages.push(`https://www.brightermonday.co.ke/jobs?q=${encodeURIComponent(k)}`);
      }
      if (config.itVacancies) bmPages.push(config.itVacancies);
      bmPages.push("https://www.brightermonday.co.ke/jobs");

      for (const pageUrl of Array.from(new Set(bmPages))) {
        if (items.length >= limit) break;
        try {
          const res = await secureFetch(pageUrl, { timeoutMs: 8000 });
          if (!res.ok) continue;
          const html = res.text;

          // Card pattern with title attribute:
          // <a href=".../listings/..." ... title="TITLE">
          const cardRegex = /<a[^>]+href=["']((?:https?:\/\/(?:www\.)?brightermonday\.co\.ke)?\/listings\/[a-zA-Z0-9_-]+)["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
          for (const m of html.matchAll(cardRegex)) {
            if (items.length >= limit) break;
            let jobUrl = m[1];
            if (!jobUrl.startsWith("http")) jobUrl = `https://www.brightermonday.co.ke${jobUrl.startsWith("/") ? "" : "/"}${jobUrl}`;
            const rawTitle = cleanHtml(m[2]);
            if (!jobUrl || seenUrls.has(jobUrl) || isGarbage(rawTitle)) continue;
            seenUrls.add(jobUrl);

            items.push({
              id: `${source.id}-${Buffer.from(jobUrl).toString("base64").slice(0, 20)}`,
              sourceId: source.id,
              sourceName: source.name,
              externalJobId: jobUrl,
              title: rawTitle,
              company: source.name,
              location: "Nairobi, Kenya",
              county: "Nairobi",
              country: "Kenya",
              remote: /remote/i.test(rawTitle),
              salary: null,
              description: `Verified listing on BrighterMonday Kenya: ${rawTitle}. Full requirements and direct application available on official portal.`,
              url: jobUrl,
              sourceUrl: jobUrl,
              applicationUrl: jobUrl,
              postedDate: new Date(),
              jobType: "Full-time",
              skills: [],
            });
          }
        } catch {}
      }

      if (items.length > 0) return items;
    }

    // ==========================================
    // 2. MyJobMag Specialized Extractor
    // Strictly extract /job/{slug}
    // ==========================================
    if (source.id.includes("myjobmag")) {
      const mjmPages: string[] = [];
      if (isSearchingHealth) {
        mjmPages.push("https://www.myjobmag.co.ke/jobs-by-field/medical");
        mjmPages.push("https://www.myjobmag.co.ke/jobs-by-field/pharmaceutical");
        mjmPages.push("https://www.myjobmag.co.ke/search/jobs?q=surgeon");
        mjmPages.push("https://www.myjobmag.co.ke/search/jobs?q=doctor");
        mjmPages.push("https://www.myjobmag.co.ke/search/jobs?q=medical+officer");
      }
      if (isSearchingIt) {
        mjmPages.push("https://www.myjobmag.co.ke/jobs-by-field/information-technology");
      }
      if (isSearchingFinance) {
        mjmPages.push("https://www.myjobmag.co.ke/jobs-by-field/finance-accounting");
        mjmPages.push("https://www.myjobmag.co.ke/jobs-by-field/banking-financial-services");
      }
      if (isSearchingAgri) {
        mjmPages.push("https://www.myjobmag.co.ke/jobs-by-field/agriculture-agro-allied");
      }
      if (isSearchingNgo) {
        mjmPages.push("https://www.myjobmag.co.ke/jobs-by-field/ngo-non-profit");
      }
      if (isSearchingProcurement) {
        mjmPages.push("https://www.myjobmag.co.ke/jobs-by-field/procurement-purchasing");
      }
      if (isSearchingHr) {
        mjmPages.push("https://www.myjobmag.co.ke/jobs-by-field/human-resources");
      }
      if (isSearchingLegal) {
        mjmPages.push("https://www.myjobmag.co.ke/jobs-by-field/law-legal");
      }
      if (isSearchingEngineering) {
        mjmPages.push("https://www.myjobmag.co.ke/jobs-by-field/engineering");
      }
      if (isSearchingEducation) {
        mjmPages.push("https://www.myjobmag.co.ke/jobs-by-field/education-teaching");
      }
      for (const k of keywords.slice(0, 3)) {
        mjmPages.push(`https://www.myjobmag.co.ke/search/jobs?q=${encodeURIComponent(k)}`);
      }
      mjmPages.push("https://www.myjobmag.co.ke/jobs");

      for (const pageUrl of Array.from(new Set(mjmPages))) {
        if (items.length >= limit) break;
        try {
          const res = await secureFetch(pageUrl, { timeoutMs: 8000 });
          if (!res.ok) continue;
          const html = res.text;

          // <h2><a href="(/job/[a-zA-Z0-9_-]+)">([\s\S]*?)</a></h2>
          const h2Regex = /<h2>\s*<a[^>]+href=["'](\/job\/[a-zA-Z0-9_-]+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi;
          for (const m of html.matchAll(h2Regex)) {
            if (items.length >= limit) break;
            const jobUrl = `https://www.myjobmag.co.ke${m[1]}`;
            const rawText = cleanHtml(m[2]);
            if (!jobUrl || seenUrls.has(jobUrl) || isGarbage(rawText)) continue;
            seenUrls.add(jobUrl);

            let title = rawText;
            let company = source.name;
            if (rawText.includes(" at ")) {
              const parts = rawText.split(" at ");
              title = parts[0].trim();
              company = parts.slice(1).join(" at ").trim();
            }

            items.push({
              id: `${source.id}-${Buffer.from(jobUrl).toString("base64").slice(0, 20)}`,
              sourceId: source.id,
              sourceName: source.name,
              externalJobId: jobUrl,
              title,
              company,
              location: "Nairobi, Kenya",
              county: "Nairobi",
              country: "Kenya",
              remote: /remote/i.test(title),
              salary: null,
              description: `Recruitment notice from ${company}: ${title}. Apply directly on MyJobMag official portal.`,
              url: jobUrl,
              sourceUrl: jobUrl,
              applicationUrl: jobUrl,
              postedDate: new Date(),
              jobType: "Full-time",
              skills: [],
            });
          }
        } catch {}
      }

      if (items.length > 0) return items;
    }

    // ==========================================
    // 3. Corporate Staffing Services Specialized Extractor
    // Strictly extract /job/{slug}/ and /vacancy/{slug}/
    // ==========================================
    if (source.id.includes("corporatestaffing") || source.id.includes("corporate-staffing")) {
      const cssPages: string[] = [];
      if (isSearchingHealth) {
        cssPages.push("https://www.corporatestaffing.co.ke/tag/medical-officer-jobs-in-kenya/");
        cssPages.push("https://www.corporatestaffing.co.ke/tag/healthcare-jobs-in-kenya/");
        cssPages.push("https://www.corporatestaffing.co.ke/tag/nursing-jobs-in-kenya/");
      }
      if (isSearchingIt) {
        cssPages.push("https://www.corporatestaffing.co.ke/tag/it-jobs-in-kenya/");
      }
      if (isSearchingFinance) {
        cssPages.push("https://www.corporatestaffing.co.ke/tag/accounting-jobs-in-kenya/");
        cssPages.push("https://www.corporatestaffing.co.ke/tag/finance-jobs-in-kenya/");
        cssPages.push("https://www.corporatestaffing.co.ke/tag/banking-jobs-in-kenya/");
      }
      if (isSearchingProcurement) {
        cssPages.push("https://www.corporatestaffing.co.ke/tag/procurement-jobs-in-kenya/");
        cssPages.push("https://www.corporatestaffing.co.ke/tag/supply-chain-jobs-in-kenya/");
      }
      if (isSearchingHr) {
        cssPages.push("https://www.corporatestaffing.co.ke/tag/hr-jobs-in-kenya/");
        cssPages.push("https://www.corporatestaffing.co.ke/tag/human-resources-jobs-in-kenya/");
      }
      if (isSearchingNgo) {
        cssPages.push("https://www.corporatestaffing.co.ke/tag/ngo-jobs-in-kenya/");
      }
      if (isSearchingEngineering) {
        cssPages.push("https://www.corporatestaffing.co.ke/tag/engineering-jobs-in-kenya/");
      }
      if (isSearchingAgri) {
        cssPages.push("https://www.corporatestaffing.co.ke/tag/agriculture-jobs-in-kenya/");
      }
      if (isSearchingLegal) {
        cssPages.push("https://www.corporatestaffing.co.ke/tag/legal-jobs-in-kenya/");
      }
      if (isSearchingEducation) {
        cssPages.push("https://www.corporatestaffing.co.ke/tag/teaching-jobs-in-kenya/");
      }
      cssPages.push("https://www.corporatestaffing.co.ke/jobs/");
      for (const k of keywords.slice(0, 3)) {
        cssPages.push(`https://www.corporatestaffing.co.ke/?s=${encodeURIComponent(k)}`);
      }

      for (const pageUrl of Array.from(new Set(cssPages))) {
        if (items.length >= limit) break;
        try {
          const res = await secureFetch(pageUrl, { timeoutMs: 8000 });
          if (!res.ok) continue;
          const html = res.text;

          // Pattern: <h2 class="entry-title"><a href="(https?://[^"]+/(?:job|vacancy)/[a-zA-Z0-9_-]+/?)"[^>]*>([\s\S]*?)</a></h2>
          const h2Regex = /<h2[^>]*class=["']entry-title["'][^>]*>\s*<a[^>]+href=["'](https?:\/\/(?:www\.)?corporatestaffing\.co\.ke\/(?:job|vacancy)\/[a-zA-Z0-9_-]+\/?)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi;
          for (const m of html.matchAll(h2Regex)) {
            if (items.length >= limit) break;
            const jobUrl = m[1];
            const rawTitle = cleanHtml(m[2]);
            if (!jobUrl || seenUrls.has(jobUrl) || isGarbage(rawTitle) || isClosedOrExpired(rawTitle)) continue;
            seenUrls.add(jobUrl);

            let title = rawTitle;
            let company = "Corporate Staffing Services";
            if (rawTitle.includes(" Job ")) {
              const parts = rawTitle.split(" Job ");
              title = parts[0].trim();
              company = parts.slice(1).join(" Job ").trim();
            } else if (rawTitle.includes(" at ")) {
              const parts = rawTitle.split(" at ");
              title = parts[0].trim();
              company = parts.slice(1).join(" at ").trim();
            }

            items.push({
              id: `${source.id}-${Buffer.from(jobUrl).toString("base64").slice(0, 20)}`,
              sourceId: source.id,
              sourceName: source.name,
              externalJobId: jobUrl,
              title,
              company,
              location: "Kenya",
              county: /nairobi/i.test(rawTitle) ? "Nairobi" : null,
              country: "Kenya",
              remote: /remote/i.test(rawTitle),
              salary: null,
              description: `Public recruitment notice from ${company}: ${title}. Apply directly via Corporate Staffing official portal.`,
              url: jobUrl,
              sourceUrl: jobUrl,
              applicationUrl: jobUrl,
              postedDate: new Date(),
              jobType: "Full-time",
              skills: [],
            });
          }
        } catch {}
      }

      if (items.length > 0) return items;
    }

    // ==========================================
    // 4. Generic Portal & Public Board Extractor
    // ==========================================
    const roleQueryUrls: string[] = [];
    if (keywords.length > 0) {
      for (const k of keywords.slice(0, 3)) {
        if (source.id.includes("kenyajob")) {
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
          if (fullUrl && !seenUrls.has(fullUrl) && !isGarbage(rawTitle) && !isIndexOrNavigationUrl(fullUrl)) {
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
        const cardMatches = html.matchAll(/<a[^>]+href=["']([^"']*(?:\/listings\/|\/job\/|\/vacancy\/|\/vacancies\/)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
        for (const match of cardMatches) {
          if (items.length >= limit) break;
          const fullUrl = sanitizeUrl(match[1]);
          if (!fullUrl || seenUrls.has(fullUrl) || isIndexOrNavigationUrl(fullUrl)) continue;

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
