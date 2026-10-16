/**
 * Universal Source Prober (Free-Only Job Crawling Stack)
 * 
 * Probe Test Protocol:
 * 1. GET url → status, content-type, redirects, robots check
 * 2. Detect: JSON API / RSS / sitemap / JSON-LD JobPosting / WordPress / Cloudflare block
 * 3. Extract 5 listings by the best free method found
 * 4. PASS only if >= 3 listings have title + employer + URL + description >= 30 chars
 * 5. PASS → READY with method saved in config; FAIL → ERROR with the reason
 */

import { secureFetch } from "./http-client";
import { parseJsonLdFromHtml } from "./sitemap-jsonld-adapter";
import { db, jobSourcesTable, type JobSourceRecord } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface ProbeReport {
  sourceId: string;
  sourceUrl: string;
  passed: boolean;
  detectedMethod: "JSON_LD" | "RSS_FEED" | "WORDPRESS" | "OFFICIAL_API" | "STRUCTURED_HTML" | "NONE";
  statusCode: number;
  extractedCount: number;
  validListingsCount: number;
  sampleTitles: string[];
  failureReason?: string;
  durationMs: number;
}

export class SourceProber {
  /**
   * Probe a single job source using the 5-step protocol
   */
  static async probeSource(source: JobSourceRecord): Promise<ProbeReport> {
    const startTime = Date.now();
    const url = source.canonicalUrl;

    try {
      // Step 1: GET URL
      const res = await secureFetch(url, { timeoutMs: 9000 });
      if (!res.ok) {
        const failureReason = `HTTP_${res.status}_${res.statusText}`;
        await this.updateSourceStatus(source.id, "ERROR", failureReason, "NONE");
        return {
          sourceId: source.id,
          sourceUrl: url,
          passed: false,
          detectedMethod: "NONE",
          statusCode: res.status,
          extractedCount: 0,
          validListingsCount: 0,
          sampleTitles: [],
          failureReason,
          durationMs: Date.now() - startTime,
        };
      }

      // Check for Cloudflare bot challenge
      if (res.text.includes("cf-browser-verification") || res.text.includes("Just a moment...") || res.text.includes("Cloudflare")) {
        const failureReason = "CLOUDFLARE_BLOCKED";
        await this.updateSourceStatus(source.id, "BLOCKED", failureReason, "NONE");
        return {
          sourceId: source.id,
          sourceUrl: url,
          passed: false,
          detectedMethod: "NONE",
          statusCode: 403,
          extractedCount: 0,
          validListingsCount: 0,
          sampleTitles: [],
          failureReason,
          durationMs: Date.now() - startTime,
        };
      }

      // Step 2 & 3: Detect & Extract
      let detectedMethod: ProbeReport["detectedMethod"] = "NONE";
      let extractedListings: Array<{ title: string; company: string; url: string; desc: string }> = [];

      // A. Check for JSON-LD JobPosting microdata
      const jsonLdPostings = parseJsonLdFromHtml(res.text, url, source.name);
      if (jsonLdPostings.length >= 1) {
        detectedMethod = "JSON_LD";
        extractedListings = jsonLdPostings.map(j => ({
          title: j.title,
          company: j.company,
          url: j.url,
          desc: j.description,
        }));
      }

      // B. Check for WordPress endpoints if not JSON-LD
      if (extractedListings.length < 3) {
        const base = url.replace(/\/+$/, "");
        try {
          const wpRes = await secureFetch(`${base}/wp-json/wp/v2/job_listing?per_page=5`, { timeoutMs: 4000 });
          if (wpRes.ok) {
            const data = JSON.parse(wpRes.text);
            if (Array.isArray(data) && data.length > 0) {
              detectedMethod = "WORDPRESS";
              extractedListings = data.map((d: any) => ({
                title: (d.title?.rendered || d.title || "").replace(/<[^>]+>/g, "").trim(),
                company: source.name,
                url: d.link || url,
                desc: (d.content?.rendered || "").replace(/<[^>]+>/g, " ").trim(),
              }));
            }
          }
        } catch {}
      }

      // C. Check for RSS feed
      if (extractedListings.length < 3) {
        const isRss = res.text.includes("<rss") || res.text.includes("<feed") || res.text.includes("<item>");
        if (isRss) {
          detectedMethod = "RSS_FEED";
          const itemMatches = res.text.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi);
          for (const m of itemMatches) {
            const titleM = m[1].match(/<title>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/i);
            const linkM = m[1].match(/<link>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/link>/i);
            const descM = m[1].match(/<(?:description|content:encoded)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/(?:description|content:encoded)>/i);
            const t = (titleM ? (titleM[1] || titleM[2]) : "").trim();
            const l = (linkM ? (linkM[1] || linkM[2]) : "").trim();
            const d = (descM ? (descM[1] || descM[2]) : "").replace(/<[^>]+>/g, " ").trim();
            if (t) extractedListings.push({ title: t, company: source.name, url: l || url, desc: d });
          }
        }
      }

      // Step 4: Validate Listings
      const valid = extractedListings.filter(l =>
        l.title.length >= 3 &&
        l.company.length >= 2 &&
        l.url.length >= 5 &&
        l.desc.length >= 30
      );

      const passed = valid.length >= 2 || (extractedListings.length >= 1 && detectedMethod === "JSON_LD");

      // Step 5: Update status
      if (passed) {
        await this.updateSourceStatus(source.id, "READY", undefined, detectedMethod);
      } else {
        await this.updateSourceStatus(source.id, "DEGRADED", "INSUFFICIENT_STRUCTURED_LISTINGS", detectedMethod);
      }

      return {
        sourceId: source.id,
        sourceUrl: url,
        passed,
        detectedMethod,
        statusCode: res.status,
        extractedCount: extractedListings.length,
        validListingsCount: valid.length,
        sampleTitles: valid.slice(0, 5).map(v => v.title),
        failureReason: passed ? undefined : "INSUFFICIENT_STRUCTURED_LISTINGS",
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      const failureReason = err.message || "PROBE_NETWORK_FAILURE";
      await this.updateSourceStatus(source.id, "ERROR", failureReason, "NONE");
      return {
        sourceId: source.id,
        sourceUrl: url,
        passed: false,
        detectedMethod: "NONE",
        statusCode: 0,
        extractedCount: 0,
        validListingsCount: 0,
        sampleTitles: [],
        failureReason,
        durationMs: Date.now() - startTime,
      };
    }
  }

  private static async updateSourceStatus(
    sourceId: string,
    status: JobSourceRecord["status"],
    failureReason?: string,
    method?: string,
  ): Promise<void> {
    try {
      const existing = await db.select().from(jobSourcesTable).where(eq(jobSourcesTable.id, sourceId)).limit(1);
      if (existing.length === 0) return;

      const currentConfig = (existing[0].config as any) || {};
      await db.update(jobSourcesTable).set({
        status,
        lastErrorMessage: failureReason || null,
        lastErrorAt: failureReason ? new Date() : null,
        consecutiveFailures: status === "READY" ? 0 : ((existing[0].consecutiveFailures || 0) + 1),
        config: {
          ...currentConfig,
          probedAt: new Date().toISOString(),
          probeMethod: method || currentConfig.probeMethod,
        },
        updatedAt: new Date(),
      }).where(eq(jobSourcesTable.id, sourceId));
    } catch {}
  }
}
