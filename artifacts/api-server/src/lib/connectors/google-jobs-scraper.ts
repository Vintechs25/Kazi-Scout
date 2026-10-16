/**
 * Google Jobs Scraper
 * 
 * This connector scrapes Google for Jobs (https://www.google.com/search?q=jobs)
 * to discover job listings. It handles:
 * - Google's job search results page
 * - Job detail extraction
 * - Application instruction parsing
 * - Rate limiting and error handling
 * - Ethiopia/Kenya specific job discovery
 * 
 * Note: Google Jobs uses a special structured data format that can be scraped
 * from the HTML. This connector parses that structured data.
 */

import { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";

// ============================================================================
// TYPES
// ============================================================================

interface GoogleJobResult {
  title: string;
  company: string;
  location: string;
  via?: string;
  url?: string;
  date?: string;
  snippet?: string;
  salary?: string;
  ratings?: number;
  reviews?: number;
}

interface GoogleJobsData {
  job: {
    title: string;
    company: string;
    location: string;
    via?: string;
    url?: string;
    date?: string;
    snippet?: string;
    salary?: string;
    ratings?: number;
    reviews?: number;
  };
  related_links?: { url: string; text: string }[];
}

// ============================================================================
// GOOGLE JOBS SCRAPER
// ============================================================================

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BASE_URL = "https://www.google.com";
const SEARCH_PATH = "/search";

/**
 * Extract job listings from Google search results HTML
 */
function extractGoogleJobs(html: string): GoogleJobResult[] {
  const results: GoogleJobResult[] = [];
  
  // Pattern 1: Standard job result with structured data
  const jobResultRegex = /<div[^>]*class="[^"]*job[^"]*"[^>]*>.*?<div[^>]*class="[^"]*title[^"]*"[^>]*>(.*?)<\/div>.*?<div[^>]*class="[^"]*company[^"]*"[^>]*>(.*?)<\/div>.*?<div[^>]*class="[^"]*location[^"]*"[^>]*>(.*?)<\/div>/gsi;
  
  let match;
  while ((match = jobResultRegex.exec(html)) !== null) {
    const title = match[1]?.replace(/<[^>]+>/g, "").trim() || "";
    const company = match[2]?.replace(/<[^>]+>/g, "").trim() || "";
    const location = match[3]?.replace(/<[^>]+>/g, "").trim() || "";
    
    if (title && company) {
      results.push({ title, company, location });
    }
  }
  
  // Pattern 2: Job results with via (e.g., "via Indeed")
  const viaRegex = /<div[^>]*class="[^"]*via[^"]*"[^>]*>(.*?)<\/div>/g;
  const viaMatches = [...html.matchAll(viaRegex)];
  for (let i = 0; i < Math.min(results.length, viaMatches.length); i++) {
    results[i].via = viaMatches[i][1]?.replace(/<[^>]+>/g, "").trim();
  }
  
  // Pattern 3: Job URLs
  const urlRegex = /<a[^>]*href="([^"]*\/apply[^"]*)"[^>]*>/g;
  const urlMatches = [...html.matchAll(urlRegex)];
  for (let i = 0; i < Math.min(results.length, urlMatches.length); i++) {
    results[i].url = urlMatches[i][1];
  }
  
  // Pattern 4: Job dates
  const dateRegex = /<div[^>]*class="[^"]*date[^"]*"[^>]*>(.*?)<\/div>/g;
  const dateMatches = [...html.matchAll(dateRegex)];
  for (let i = 0; i < Math.min(results.length, dateMatches.length); i++) {
    results[i].date = dateMatches[i][1]?.replace(/<[^>]+>/g, "").trim();
  }
  
  // Pattern 5: Job snippets (description preview)
  const snippetRegex = /<div[^>]*class="[^"]*snippet[^"]*"[^>]*>(.*?)<\/div>/g;
  const snippetMatches = [...html.matchAll(snippetRegex)];
  for (let i = 0; i < Math.min(results.length, snippetMatches.length); i++) {
    results[i].snippet = snippetMatches[i][1]?.replace(/<[^>]+>/g, "").trim();
  }
  
  // Pattern 6: Salary information
  const salaryRegex = /<div[^>]*class="[^"]*salary[^"]*"[^>]*>(.*?)<\/div>/g;
  const salaryMatches = [...html.matchAll(salaryRegex)];
  for (let i = 0; i < Math.min(results.length, salaryMatches.length); i++) {
    results[i].salary = salaryMatches[i][1]?.replace(/<[^>]+>/g, "").trim();
  }
  
  return results;
}

/**
 * Parse Google Jobs structured data (JSON-LD)
 */
function parseGoogleJobsStructuredData(html: string): GoogleJobsData[] {
  const results: GoogleJobsData[] = [];
  
  // Extract JSON-LD data
  const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match;
  
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const jsonData = JSON.parse(match[1]) as any;
      
      // Check if this is a JobPosting
      if (jsonData["@type"] === "JobPosting") {
        results.push({
          job: {
            title: jsonData.title || "",
            company: jsonData.hiringOrganization?.name || "",
            location: jsonData.jobLocation?.address?.addressLocality || jsonData.jobLocation || "",
            via: jsonData.source?.name || undefined,
            url: jsonData.url || jsonData.applicationUrl || undefined,
            date: jsonData.datePosted || undefined,
            snippet: jsonData.description || undefined,
            salary: jsonData.estimatedSalary || jsonData.salaryCurrency || undefined,
            ratings: jsonData.hiringOrganization?.aggregateRating?.ratingValue || undefined,
            reviews: jsonData.hiringOrganization?.aggregateRating?.reviewCount || undefined,
          },
          related_links: jsonData.relatedLinks || [],
        });
      }
      
      // Check if this is a SearchResultsPage
      if (jsonData["@type"] === "SearchResultsPage") {
        const jobPostings = jsonData.mainEntity?.itemListElement || [];
        for (const item of jobPostings) {
          if (item["@type"] === "ListItem" && item.item["@type"] === "JobPosting") {
            const job = item.item;
            results.push({
              job: {
                title: job.title || "",
                company: job.hiringOrganization?.name || "",
                location: job.jobLocation?.address?.addressLocality || job.jobLocation || "",
                via: job.source?.name || undefined,
                url: job.url || job.applicationUrl || undefined,
                date: job.datePosted || undefined,
                snippet: job.description || undefined,
                salary: job.estimatedSalary || job.salaryCurrency || undefined,
                ratings: job.hiringOrganization?.aggregateRating?.ratingValue || undefined,
                reviews: job.hiringOrganization?.aggregateRating?.reviewCount || undefined,
              },
              related_links: job.relatedLinks || [],
            });
          }
        }
      }
    } catch (err) {
      // Skip invalid JSON
    }
  }
  
  return results;
}

/**
 * Build Google search URL with query parameters
 */
function buildGoogleSearchUrl(
  query: string,
  location?: string,
  start?: number,
): string {
  let url = `${BASE_URL}${SEARCH_PATH}?q=${encodeURIComponent(query)}`;
  
  if (location) {
    url += `&near=${encodeURIComponent(location)}`;
  }
  
  if (start) {
    url += `&start=${start}`;
  }
  
  // Add jobs-specific parameters
  url += `&ibp=htl;jobs`;
  
  return url;
}

/**
 * Parse date string (e.g., "2 days ago", "1 week ago", "Posted 3 days ago")
 */
function parseGoogleDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  
  const lower = dateStr.toLowerCase();
  
  // "Posted X days ago"
  const daysMatch = lower.match(/(\d+)\s+days?\s+ago/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1]);
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }
  
  // "Posted X weeks ago"
  const weeksMatch = lower.match(/(\d+)\s+weeks?\s+ago/i);
  if (weeksMatch) {
    const weeks = parseInt(weeksMatch[1]);
    const date = new Date();
    date.setDate(date.getDate() - (weeks * 7));
    return date;
  }
  
  // "Posted X months ago"
  const monthsMatch = lower.match(/(\d+)\s+months?\s+ago/i);
  if (monthsMatch) {
    const months = parseInt(monthsMatch[1]);
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    return date;
  }
  
  // "X days ago"
  const daysAgoMatch = lower.match(/(\d+)\s+days?\s+ago/i);
  if (daysAgoMatch) {
    const days = parseInt(daysAgoMatch[1]);
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }
  
  // Try to parse as date
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  return null;
}

/**
 * Extract application URL from Google job result
 */
function extractApplicationUrl(
  job: GoogleJobResult,
  html: string,
  baseUrl: string,
): string | null {
  // If we have a direct URL, use it
  if (job.url && !job.url.includes("google.com")) {
    return job.url;
  }
  
  // Try to find application URL in the HTML
  const appUrlRegex = /<a[^>]*href="([^"]*apply[^"]*)"[^>]*class="[^"]*apply[^"]*"[^>]*>/i;
  const match = html.match(appUrlRegex);
  if (match) {
    return match[1];
  }
  
  // Try to find "Apply" or "Application" link
  const applyRegex = /<a[^>]*href="([^"]*)"[^>]*(?:Apply|Application)[^>]*>/i;
  const applyMatch = html.match(applyRegex);
  if (applyMatch) {
    let url = applyMatch[1];
    // Resolve relative URLs
    if (url && !url.startsWith("http")) {
      try {
        const urlObj = new URL(url, baseUrl);
        return urlObj.toString();
      } catch {
        // Ignore
      }
    }
    return url || null;
  }
  
  return null;
}

/**
 * Normalize company name from Google results
 */
function normalizeGoogleCompany(company: string): string {
  // Remove via information (e.g., "Company via Indeed")
  return company.replace(/\s+via\s+.*$/i, "").trim();
}

// ============================================================================
// GOOGLE JOBS CONNECTOR
// ============================================================================

export class GoogleJobsConnector implements IJobConnector {
  readonly connectorType = "GOOGLE_JOBS";

  validateConfiguration(source: JobSourceRecord): boolean {
    return source.id === "google-jobs" || 
           source.canonicalUrl?.includes("google.com") ||
           source.name?.toLowerCase().includes("google");
  }

  async healthCheck(source: JobSourceRecord): Promise<ConnectorHealthReport> {
    try {
      const startTime = Date.now();
      
      const response = await fetch(`${BASE_URL}${SEARCH_PATH}?q=jobs+kenya`, {
        headers: {
          "User-Agent": USER_AGENT,
        },
        // Google may block requests without proper headers
        redirect: "manual",
      });
      
      const responseTime = Date.now() - startTime;
      
      if (response.ok) {
        return {
          sourceId: source.id,
          ok: true,
          status: "ACTIVE",
          responseTimeMs: responseTime,
          timestamp: new Date(),
        };
      } else if (response.status === 429) {
        return {
          sourceId: source.id,
          ok: false,
          status: "ERROR",
          statusCode: 429,
          responseTimeMs: responseTime,
          message: "Google rate limiting - slow down requests",
          timestamp: new Date(),
        };
      } else if (response.status === 403) {
        return {
          sourceId: source.id,
          ok: false,
          status: "BLOCKED",
          statusCode: 403,
          responseTimeMs: responseTime,
          message: "Google blocking requests - check User-Agent and rate limits",
          timestamp: new Date(),
        };
      } else {
        return {
          sourceId: source.id,
          ok: false,
          status: "ERROR",
          statusCode: response.status,
          responseTimeMs: responseTime,
          message: `HTTP ${response.status}`,
          timestamp: new Date(),
        };
      }
    } catch (err) {
      return {
        sourceId: source.id,
        ok: false,
        status: "ERROR",
        message: err instanceof Error ? err.message : String(err),
        timestamp: new Date(),
      };
    }
  }

  async discoverListings(
    source: JobSourceRecord,
    filter?: ConnectorFilter,
  ): Promise<NormalizedListing[]> {
    const listings: NormalizedListing[] = [];
    const seenUrls = new Set<string>();
    const seenIds = new Set<string>();
    
    // Build search queries based on filter
    const queries = this.buildSearchQueries(filter);
    
    // Search for each query
    for (const query of queries) {
      if (listings.length >= (filter?.limit || 50)) break;
      
      try {
        // Fetch search results
        const searchUrl = buildGoogleSearchUrl(
          query,
          filter?.locations?.[0],
          listings.length
        );
        
        const response = await fetch(searchUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
          signal: AbortSignal.timeout(4000),
          redirect: "manual",
        });
        
        if (!response.ok) {
          if (response.status === 429) {
            // Rate limited, stop
            break;
          }
          continue;
        }
        
        const html = await response.text();
        
        // Extract jobs from structured data (preferred)
        const structuredJobs = parseGoogleJobsStructuredData(html);
        for (const jobData of structuredJobs) {
          if (listings.length >= (filter?.limit || 50)) break;
          
          const listing = this.normalizeListing(jobData, source, filter);
          if (listing && !seenUrls.has(listing.url) && !seenIds.has(listing.id)) {
            seenUrls.add(listing.url);
            seenIds.add(listing.id);
            listings.push(listing);
          }
        }
        
        // If structured data not available, try HTML parsing
        if (structuredJobs.length === 0) {
          const htmlJobs = extractGoogleJobs(html);
          for (const job of htmlJobs) {
            if (listings.length >= (filter?.limit || 50)) break;
            
            const listing = this.normalizeFromHtml(job, source, html, searchUrl, filter);
            if (listing && !seenUrls.has(listing.url) && !seenIds.has(listing.id)) {
              seenUrls.add(listing.url);
              seenIds.add(listing.id);
              listings.push(listing);
            }
          }
        }
        
        // Delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        console.warn(`[GoogleJobs] Error fetching results for query "${query}":`, err);
        continue;
      }
    }
    
    return listings;
  }

  async fetchListingDetails(
    source: JobSourceRecord,
    url: string,
  ): Promise<Partial<NormalizedListing> | null> {
    try {
      // Check if URL is a Google redirect URL
      if (url.includes("google.com")) {
        // Try to follow the redirect
        const response = await fetch(url, {
          headers: {
            "User-Agent": USER_AGENT,
          },
          redirect: "follow",
        });
        
        if (response.ok) {
          const finalUrl = response.url;
          if (finalUrl !== url) {
            // We were redirected to the actual job page
            return {
              sourceUrl: finalUrl,
              applicationUrl: finalUrl,
            };
          }
        }
      }
      
      // For direct URLs, try to fetch and extract more details
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
        },
        redirect: "follow",
      });
      
      if (response.ok) {
        const html = await response.text();
        const structuredData = parseGoogleJobsStructuredData(html);
        
        if (structuredData.length > 0) {
          const jobData = structuredData[0];
          const listing = this.normalizeListing(jobData, source);
          return listing;
        }
      }
      
      return null;
    } catch (err) {
      console.warn(`[GoogleJobs] Error fetching details for ${url}:`, err);
      return null;
    }
  }

  getCapabilities(source: JobSourceRecord): ConnectorCapabilities {
    return {
      supportsApi: false,
      supportsFeed: false,
      supportsHtml: true,
      supportsSearchOnly: true,
      supportsApplicationRedirect: true,
      supportsFullDescriptionExtraction: true,
      paginationSupported: true,
      rateLimitPerMinute: 10, // Be conservative with Google
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private buildSearchQueries(filter?: ConnectorFilter): string[] {
    const queries: string[] = [];
    const keyword = filter?.keywords && filter.keywords.length > 0 ? filter.keywords[0] : "jobs";
    queries.push(`${keyword} jobs Kenya`);
    if (filter?.keywords && filter.keywords.length > 1) {
      queries.push(`${filter.keywords[1]} jobs Kenya`);
    } else {
      queries.push(`${keyword} vacancies Kenya`);
    }
    return queries;
  }

  private normalizeListing(
    jobData: GoogleJobsData,
    source: JobSourceRecord,
    filter?: ConnectorFilter,
  ): NormalizedListing | null {
    const job = jobData.job;
    
    if (!job.title || !job.company) {
      return null;
    }
    
    const title = job.title.trim();
    const company = normalizeGoogleCompany(job.company).trim();
    const location = job.location?.trim() || "Kenya";
    
    // Extract country from location
    let country = "Kenya";
    const locationLower = location.toLowerCase();
    if (locationLower.includes("united states") || locationLower.includes("us")) {
      country = "United States";
    } else if (locationLower.includes("uk") || locationLower.includes("united kingdom")) {
      country = "United Kingdom";
    } else if (locationLower.includes("canada")) {
      country = "Canada";
    } else if (locationLower.includes("australia")) {
      country = "Australia";
    } else if (locationLower.includes("germany")) {
      country = "Germany";
    }
    
    // Determine if remote
    const isRemote = /remote|work from home|wfh|anywhere/i.test(locationLower);
    
    // Generate unique ID
    const id = this.generateJobId(title, company, location);
    
    // Parse date
    const postedDate = parseGoogleDate(job.date);
    
    // Get application URL
    let applicationUrl: string | null = null;
    if (job.url && !job.url.includes("google.com")) {
      applicationUrl = job.url;
    } else if (jobData.related_links) {
      for (const link of jobData.related_links) {
        if (/apply|application/i.test(link.text.toLowerCase())) {
          applicationUrl = link.url;
          break;
        }
      }
    }
    
    return {
      id,
      sourceId: source.id,
      sourceName: source.name || "Google for Jobs",
      externalJobId: jobData.job.url || id,
      title,
      company,
      location,
      country,
      remote: isRemote,
      workplaceType: isRemote ? "Remote" : "Unknown",
      remoteEligibility: country === "Kenya" ? "Kenya" : (isRemote ? "Worldwide" : "Country-Restricted"),
      salary: job.salary || null,
      description: job.snippet || `${title} at ${company} - ${location}`,
      url: job.url || applicationUrl || source.canonicalUrl || BASE_URL,
      sourceUrl: source.canonicalUrl || BASE_URL,
      applicationUrl,
      applicationEmail: null,
      postedDate,
      deadlineDate: null,
      jobType: null,
      skills: [],
      rawPayload: jobData,
    };
  }

  private normalizeFromHtml(
    job: GoogleJobResult,
    source: JobSourceRecord,
    html: string,
    baseUrl: string,
    filter?: ConnectorFilter,
  ): NormalizedListing | null {
    if (!job.title || !job.company) {
      return null;
    }
    
    const title = job.title.trim();
    const company = normalizeGoogleCompany(job.company).trim();
    const location = job.location?.trim() || "Kenya";
    
    // Extract country from location
    let country = "Kenya";
    const locationLower = location.toLowerCase();
    if (locationLower.includes("united states") || locationLower.includes("us")) {
      country = "United States";
    } else if (locationLower.includes("uk") || locationLower.includes("united kingdom")) {
      country = "United Kingdom";
    }
    
    // Determine if remote
    const isRemote = /remote|work from home|wfh|anywhere/i.test(locationLower);
    
    // Generate unique ID
    const id = this.generateJobId(title, company, location);
    
    // Parse date
    const postedDate = parseGoogleDate(job.date);
    
    // Get application URL
    const applicationUrl = extractApplicationUrl(job, html, baseUrl);
    
    // Build description
    const description = [
      job.snippet,
      job.salary ? `Salary: ${job.salary}` : null,
      job.via ? `Via: ${job.via}` : null,
    ].filter(Boolean).join(" | ") || `${title} at ${company} - ${location}`;
    
    return {
      id,
      sourceId: source.id,
      sourceName: source.name || "Google for Jobs",
      externalJobId: job.url || id,
      title,
      company,
      location,
      country,
      remote: isRemote,
      workplaceType: isRemote ? "Remote" : "Unknown",
      remoteEligibility: country === "Kenya" ? "Kenya" : (isRemote ? "Worldwide" : "Country-Restricted"),
      salary: job.salary || null,
      description,
      url: job.url || applicationUrl || source.canonicalUrl || BASE_URL,
      sourceUrl: source.canonicalUrl || BASE_URL,
      applicationUrl,
      applicationEmail: null,
      postedDate,
      deadlineDate: null,
      jobType: null,
      skills: [],
      rawPayload: job,
    };
  }

  private generateJobId(title: string, company: string, location: string): string {
    const hashSource = `${title}|${company}|${location}`;
    // Simple hash using string length and character codes
    let hash = 0;
    for (let i = 0; i < hashSource.length; i++) {
      const char = hashSource.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `gjobs-${Math.abs(hash).toString(16).slice(0, 8)}-${Date.now().toString(36).slice(-4)}`;
  }

  async scrape(config: any): Promise<NormalizedListing[]> {
    const { source, roles, searchQueries, maxJobs } = config;
    const filter: ConnectorFilter = {
      keywords: roles || searchQueries,
      limit: maxJobs,
    };
    return this.discoverListings(source, filter);
  }
}

// ============================================================================
// EXPORT
// ============================================================================

export const googleJobsConnector = new GoogleJobsConnector();
