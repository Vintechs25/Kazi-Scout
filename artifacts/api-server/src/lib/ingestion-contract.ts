import {
  db,
  jobsTable,
  jobSourcesTable,
  jobProvenanceTable,
  rejectedCandidatesTable,
  adminRegionsTable,
  sourceRunLogTable,
  type JobRecord,
  type JobSourceRecord,
} from "@workspace/db";
import { eq, or, and, sql, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export interface RawListing {
  id?: string;
  sourceId?: string;
  sourceName?: string;
  title?: string;
  company?: string;
  location?: string;
  country?: string;
  description?: string;
  url: string;
  sourceUrl?: string;
  applicationUrl?: string;
  postedDate?: Date | string | null;
  deadlineDate?: Date | string | null;
  deadline?: Date | string | null;
  salary?: string | number | null;
  remote?: boolean;
  jobType?: string;
  skills?: string[];
  htmlSnippet?: string;
}

export interface ValidatedListing {
  id: string;
  title: string;
  company: string;
  location: string;
  country: string;
  regionCode?: string | null;
  description: string;
  url: string;
  sourceUrl: string;
  applicationUrl?: string | null;
  postedDate: Date;
  deadlineDate?: Date | null;
  salary?: number | null;
  remote: boolean;
  jobType: string;
  skills: string[];
  sourceId: string;
  sourceName: string;
  fingerprint: string;
}

export interface IngestionRunSummary {
  runId: string;
  sourceId: string;
  fetched: number;
  parsed: number;
  validated: number;
  saved: number;
  rejectReasons: Record<string, number>;
  totalDiscovered: number;
  totalIndexed: number;
  yieldRate: number;
  error?: string;
}

/**
 * Hard Validation Gate
 * Enforces strict job legitimacy and discards search query stubs or incomplete postings.
 */
export function validateListing(
  listing: RawListing,
): { valid: boolean; reason?: string } {
  const title = (listing.title || "").trim();
  const company = (listing.company || "").trim();
  const url = (listing.url || listing.sourceUrl || "").trim();
  const desc = (listing.description || "").trim();

  // 1. Missing title or title is search query stub
  if (!title || title.length < 3) {
    return { valid: false, reason: "TITLE_TOO_SHORT" };
  }
  if (/^search\s*query\s*:/i.test(title)) {
    return { valid: false, reason: "SEARCH_QUERY_STUB" };
  }

  // 2. Missing employer / company
  if (!company || company.length < 2) {
    return { valid: false, reason: "MISSING_EMPLOYER" };
  }

  // 3. Reject pure search query stubs
  if (/^search\s*(query|results?|jobs?)?\s*:/i.test(title) || /^(all\s+jobs|job\s+vacancies|career\s+opportunities)$/i.test(title)) {
    return { valid: false, reason: "SEARCH_QUERY_STUB" };
  }
  if (!url || url.length < 5) {
    return { valid: false, reason: "MISSING_URL" };
  }

  // 4. Description length gate (must have descriptive content, at least 25 characters)
  if (!desc || desc.length < 25) {
    return { valid: false, reason: "SHORT_DESCRIPTION" };
  }

  // 5. Expiration check
  if (listing.deadlineDate) {
    const deadline = new Date(listing.deadlineDate);
    if (!isNaN(deadline.getTime()) && deadline.getTime() + 86400000 < Date.now()) {
      return { valid: false, reason: "EXPIRED_DEADLINE" };
    }
  }

  return { valid: true };
}

/**
 * Normalization & Deduplication Fingerprint
 */
export function computeJobFingerprint(title: string, company: string, location: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${clean(company)}__${clean(title)}__${clean(location.slice(0, 15))}`;
}

/**
 * Location resolution against admin_regions
 */
export async function resolveRegionCode(locationText: string): Promise<string | null> {
  if (!locationText) return null;
  const locLower = locationText.toLowerCase();

  try {
    const regions = await db.select({ id: adminRegionsTable.id, name: adminRegionsTable.name }).from(adminRegionsTable);
    for (const reg of regions) {
      if (locLower.includes(reg.name.toLowerCase())) {
        return reg.id;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Single Unified Ingestion Pipeline:
 * RawListing[] -> resolve -> parse -> validate -> dedupe -> save
 */
export async function processListingPipeline(
  rawListings: RawListing[],
  source: JobSourceRecord,
  runId: string = randomUUID(),
  profileId?: string,
  accountId?: string,
): Promise<IngestionRunSummary> {
  const targetAccountId = accountId || null;
  const startedAt = new Date();
  const summary: IngestionRunSummary = {
    runId,
    sourceId: source.id,
    fetched: rawListings.length,
    parsed: 0,
    validated: 0,
    saved: 0,
    rejectReasons: {},
    totalDiscovered: 0,
    totalIndexed: 0,
    yieldRate: 1.0,
  };

  for (const raw of rawListings) {
    summary.parsed++;

    // 1. Resolve: Parse JSON-LD if htmlSnippet available
    if (raw.htmlSnippet && (!raw.description || raw.description.length < 200)) {
      try {
        const match = raw.htmlSnippet.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
        if (match && match[1]) {
          const parsedLd = JSON.parse(match[1]);
          const jobLd = Array.isArray(parsedLd) ? parsedLd.find((i: any) => i["@type"] === "JobPosting") : parsedLd;
          if (jobLd && jobLd["@type"] === "JobPosting") {
            raw.title = raw.title || jobLd.title;
            raw.company = raw.company || jobLd.hiringOrganization?.name;
            raw.description = raw.description || jobLd.description?.replace(/<[^>]+>/g, " ");
            if (jobLd.validThrough) raw.deadlineDate = new Date(jobLd.validThrough);
            if (jobLd.datePosted) raw.postedDate = new Date(jobLd.datePosted);
          }
        }
      } catch {
        // ignore
      }
    }

    // 2. Validate (Hard Gate)
    const validation = validateListing(raw);
    if (!validation.valid) {
      const reason = validation.reason || "REJECTED";
      summary.rejectReasons[reason] = (summary.rejectReasons[reason] || 0) + 1;

      // Log to rejected_candidates discard table
      await db
        .insert(rejectedCandidatesTable)
        .values({
          id: randomUUID(),
          runId,
          sourceId: source.id,
          url: raw.url || raw.sourceUrl || source.canonicalUrl,
          title: raw.title || null,
          reason,
          rawSnippet: (raw.description || "").slice(0, 300),
          createdAt: new Date(),
        })
        .catch(() => {});

      continue;
    }

    summary.validated++;

    // 3. Location & Work Arrangement resolution
    const loc = raw.location || (source.country === "Kenya" ? "Kenya" : "Remote");
    const isRemote = Boolean(raw.remote || loc.toLowerCase().includes("remote") || source.workArrangements?.includes("remote"));
    const regionCode = await resolveRegionCode(loc);
    const fp = computeJobFingerprint(raw.title!, raw.company!, loc);

    const postedDate = raw.postedDate ? new Date(raw.postedDate) : new Date();
    const deadlineDate = raw.deadlineDate ? new Date(raw.deadlineDate) : null;

    // 4. Dedupe & Save (Multi-tenant scoped by targetAccountId)
    try {
      const accountCondition = targetAccountId
        ? eq(jobsTable.accountId, targetAccountId)
        : isNull(jobsTable.accountId);

      const existing = await db
        .select({ id: jobsTable.id })
        .from(jobsTable)
        .where(and(
          accountCondition,
          or(
            eq(jobsTable.fingerprint, fp),
            eq(jobsTable.sourceUrl, raw.url),
            raw.id ? eq(jobsTable.id, raw.id) : undefined
          )
        ))
        .limit(1);

      let jobId: string;
      if (existing.length > 0) {
        jobId = existing[0].id;
        // Record provenance
        await db
          .insert(jobProvenanceTable)
          .values({
            id: randomUUID(),
            jobId,
            sourceId: source.id,
            sourceName: source.name,
            originalUrl: raw.url,
            discoveredAt: new Date(),
            isPrimary: false,
          })
          .catch(() => {});
      } else {
        jobId = randomUUID();
        const titleStr = raw.title!.trim();
        const compStr = raw.company!.trim();

        await db.insert(jobsTable).values({
          id: jobId,
          accountId: targetAccountId,
          title: titleStr,
          company: compStr,
          normalizedCompany: compStr.toLowerCase(),
          normalizedTitle: titleStr.toLowerCase(),
          location: loc,
          normalizedLocation: loc.toLowerCase(),
          remote: isRemote,
          salary: typeof raw.salary === "string" ? raw.salary : null,
          source: source.name,
          sourceUrl: raw.url || raw.sourceUrl || null,
          externalJobId: raw.id || null,
          description: raw.description!.trim(),
          fingerprint: fp,
          matchScore: 65,
          status: "DISCOVERED",
          matchedSkills: raw.skills || [],
          missingSkills: [],
          uncertainties: [],
          isAiVerified: false,
          hardEligibilityFailure: false,
          discoveredAt: new Date(),
        });

        // Record primary provenance
        await db
          .insert(jobProvenanceTable)
          .values({
            id: randomUUID(),
            jobId,
            sourceId: source.id,
            sourceName: source.name,
            originalUrl: raw.url,
            discoveredAt: new Date(),
            isPrimary: true,
          })
          .catch(() => {});

        summary.saved++;
      }
    } catch (err: any) {
      console.warn(`[IngestionPipeline] Error persisting job from ${source.name}:`, err?.message || err);
    }
  }

  // 5. Update source metrics (yieldRate, totals, rejectReasons)
  const durationMs = Date.now() - startedAt.getTime();
  const currentDiscovered = (source.totalDiscovered || 0) + summary.fetched;
  const currentIndexed = (source.totalIndexed || 0) + summary.saved;
  const currentRejected = (source.totalRejected || 0) + (summary.fetched - summary.validated);
  const yieldRate = currentDiscovered > 0 ? Math.min(1.0, currentIndexed / currentDiscovered) : 0.5;

  summary.totalDiscovered = currentDiscovered;
  summary.totalIndexed = currentIndexed;
  summary.yieldRate = yieldRate;

  // Merge reject reasons
  const mergedRejectReasons: Record<string, number> = { ...(source.rejectReasons || {}) };
  for (const [k, v] of Object.entries(summary.rejectReasons)) {
    mergedRejectReasons[k] = (mergedRejectReasons[k] || 0) + v;
  }

  await db
    .update(jobSourcesTable)
    .set({
      totalDiscovered: currentDiscovered,
      totalIndexed: currentIndexed,
      totalRejected: currentRejected,
      yieldRate,
      rejectReasons: mergedRejectReasons,
      lastCheckedAt: new Date(),
      lastSuccessfulRunAt: summary.saved > 0 ? new Date() : source.lastSuccessfulRunAt,
      lastJobDiscoveredAt: summary.saved > 0 ? new Date() : source.lastJobDiscoveredAt,
      consecutiveFailures: 0,
      updatedAt: new Date(),
    })
    .where(eq(jobSourcesTable.id, source.id))
    .catch(() => {});

  // 6. Write observability record to source_run_log
  await db
    .insert(sourceRunLogTable)
    .values({
      id: randomUUID(),
      runId,
      sourceId: source.id,
      profileId: profileId || null,
      startedAt,
      durationMs,
      fetched: summary.fetched,
      parsed: summary.parsed,
      validated: summary.validated,
      saved: summary.saved,
      rejectReasons: summary.rejectReasons,
      error: summary.error || null,
    })
    .catch(() => {});

  return summary;
}
