/**
 * ATS Slug Prober (Free Discovery Engine)
 * Probes candidate employer names against public ATS endpoints:
 * - Greenhouse: boards-api.greenhouse.io
 * - Lever: api.lever.co
 * - Ashby: api.ashbyhq.com
 * - Workable: apply.workable.com
 * - SmartRecruiters: api.smartrecruiters.com
 * - Recruitee: {slug}.recruitee.com
 *
 * A 200 response with >=1 jobs automatically identifies the employer's official job board
 * with 0 API keys and zero paid scraping.
 */

import { secureFetch } from "./http-client";
import { db, jobSourcesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export interface AtsProbeResult {
  companyName: string;
  slug: string;
  ats: "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters" | "recruitee";
  endpoint: string;
  jobCount: number;
  sampleTitles: string[];
}

export function generateCandidateSlugs(name: string): string[] {
  const clean = name.toLowerCase().trim();
  const noSpecial = clean.replace(/[^a-z0-9\s-]/g, "");
  const hyphenated = noSpecial.replace(/\s+/g, "-");
  const joined = noSpecial.replace(/\s+/g, "");
  const under = noSpecial.replace(/\s+/g, "_");

  // Remove common corporate suffixes
  const stripped = clean
    .replace(/\b(limited|ltd|hospital|university|bank|group|plc|foundation|kenya|africa|east africa)\b/gi, "")
    .trim()
    .replace(/[^a-z0-9]/g, "");

  const slugs = new Set<string>([
    hyphenated,
    joined,
    under,
    stripped,
    clean,
  ]);

  return Array.from(slugs).filter(s => s.length >= 2);
}

/**
 * Probe a single slug against all supported public ATS platforms
 */
export async function probeAtsSlug(slug: string, companyName: string): Promise<AtsProbeResult | null> {
  const checks: Array<{
    ats: AtsProbeResult["ats"];
    url: string;
    parse: (json: any) => { count: number; titles: string[] } | null;
  }> = [
    {
      ats: "greenhouse",
      url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=false`,
      parse: (d) => {
        if (Array.isArray(d?.jobs) && d.jobs.length > 0) {
          return { count: d.jobs.length, titles: d.jobs.slice(0, 5).map((j: any) => j.title) };
        }
        return null;
      },
    },
    {
      ats: "lever",
      url: `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
      parse: (d) => {
        if (Array.isArray(d) && d.length > 0) {
          return { count: d.length, titles: d.slice(0, 5).map((j: any) => j.text || j.title) };
        }
        return null;
      },
    },
    {
      ats: "ashby",
      url: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
      parse: (d) => {
        if (Array.isArray(d?.jobs) && d.jobs.length > 0) {
          return { count: d.jobs.length, titles: d.jobs.slice(0, 5).map((j: any) => j.title) };
        }
        return null;
      },
    },
    {
      ats: "workable",
      url: `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`,
      parse: (d) => {
        if (Array.isArray(d?.jobs) && d.jobs.length > 0) {
          return { count: d.jobs.length, titles: d.jobs.slice(0, 5).map((j: any) => j.title) };
        }
        return null;
      },
    },
    {
      ats: "smartrecruiters",
      url: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings`,
      parse: (d) => {
        if (Array.isArray(d?.content) && d.content.length > 0) {
          return { count: d.content.length, titles: d.content.slice(0, 5).map((j: any) => j.name) };
        }
        return null;
      },
    },
    {
      ats: "recruitee",
      url: `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`,
      parse: (d) => {
        if (Array.isArray(d?.offers) && d.offers.length > 0) {
          return { count: d.offers.length, titles: d.offers.slice(0, 5).map((j: any) => j.title) };
        }
        return null;
      },
    },
  ];

  for (const check of checks) {
    try {
      const res = await secureFetch(check.url, { timeoutMs: 3500 });
      if (!res.ok) continue;
      const json = JSON.parse(res.text);
      const parsed = check.parse(json);
      if (parsed && parsed.count > 0) {
        return {
          companyName,
          slug,
          ats: check.ats,
          endpoint: check.url,
          jobCount: parsed.count,
          sampleTitles: parsed.titles,
        };
      }
    } catch {
      // Continue to next check
    }
  }

  return null;
}

/**
 * Probe an employer by name across candidate slugs
 */
export async function probeEmployer(employerName: string): Promise<AtsProbeResult | null> {
  const slugs = generateCandidateSlugs(employerName);
  for (const slug of slugs) {
    const result = await probeAtsSlug(slug, employerName);
    if (result) return result;
  }
  return null;
}

/**
 * Auto-probe and register verified employer ATS boards into job_sources table
 */
export async function probeAndRegisterAtsEmployers(
  employerNames: string[],
): Promise<{ probed: number; discovered: number; results: AtsProbeResult[] }> {
  const results: AtsProbeResult[] = [];

  for (const name of employerNames) {
    const res = await probeEmployer(name);
    if (res) {
      results.push(res);
      // Persist to job_sources table as READY
      const sourceId = `ats-${res.ats}-${res.slug}`;
      const existing = await db.select().from(jobSourcesTable).where(eq(jobSourcesTable.id, sourceId)).limit(1);

      if (existing.length === 0) {
        await db.insert(jobSourcesTable).values({
          id: sourceId,
          name: `${res.companyName} (${res.ats.toUpperCase()})`,
          canonicalUrl: res.endpoint,
          category: "TECH_EMPLOYER",
          country: "Kenya",
          region: "East Africa",
          sourceKind: "DIRECT_EMPLOYER",
          integrationType: "OFFICIAL_API",
          connectorType: "ATS_REGISTRY",
          status: "READY",
          enabled: true,
          supportsApi: true,
          supportsFeed: false,
          supportsHtmlExtraction: false,
          supportsSearchOnly: false,
          supportsApplicationRedirect: true,
          authenticationRequired: false,
          rateLimit: 60,
          config: {
            ats: res.ats,
            token: res.slug,
            discoveredVia: "ats-slug-prober",
            jobCount: res.jobCount,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        }).catch(() => {});
      }
    }
  }

  return {
    probed: employerNames.length,
    discovered: results.length,
    results,
  };
}
