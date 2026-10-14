/**
 * Job Search Service
 * Precision job discovery tailored for Software Developers & IT Support Specialists
 * Enforces strict domain relevance, experience-level requirements, and application deadlines
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, gt, gte, inArray, like, ne, or } from "drizzle-orm";
import { db, jobsTable, searchProfilesTable, candidateProfilesTable, activityTable, applicationsTable, cvsTable, jobSourcesTable, jobProvenanceTable } from "@workspace/db";
import { fingerprintJob, normalizeCompany, normalizeText } from "./job-deduplication";
import { fetchAllAtsJobs } from "./ats-registry";
import { getConnectorForSource } from "./connectors/registry";
import { splitJobSections, extractContextualYears, extractSkillsFromText, COMPREHENSIVE_SKILL_SYNONYMS } from "./section-parser";
import { extractApplicationDetails, formatApplicationBanner } from "./application-extractor";
import { extractCvText } from "./cv-text-extraction";
import { getOrGenerateSearchDirective, type SearchDirective } from "./search-directive";
import { evaluatePreIngestionGate, EXECUTIVE_REGEX, OFF_FAMILY_PROFESSIONS_REGEX } from "./pre-ingestion-gate";
import { batchEvaluateQualifiedJobs } from "./ai-job-evaluator";
import { getVerifiedMasterCv } from "./cv-storage";
import { getOrGenerateCandidateEvidence } from "./candidate-evidence";
import type { JobRecord } from "@workspace/db";

export interface JobSource {
  id: string;
  name: string;
  baseUrl: string;
  searchEndpoint: string;
  apiKey?: string;
  enabled: boolean;
  rateLimit: number;
  countries: string[];
  remoteOnly: boolean;
}

export const ALL_JOB_SOURCES: JobSource[] = [
  {
    id: "myjobmag",
    name: "MyJobMag Kenya (IT & Telecom Vacancies)",
    baseUrl: "https://www.myjobmag.co.ke",
    searchEndpoint: "/jobs-by-field/information-technology",
    enabled: true,
    rateLimit: 60,
    countries: ["Kenya"],
    remoteOnly: false,
  },
  {
    id: "careerpointkenya",
    name: "Career Point Kenya (IT & Software Jobs)",
    baseUrl: "https://www.careerpointkenya.co.ke",
    searchEndpoint: "/category/it-jobs-in-kenya/feed/",
    enabled: true,
    rateLimit: 60,
    countries: ["Kenya"],
    remoteOnly: false,
  },
  {
    id: "jobwebkenya",
    name: "JobWeb Kenya (Local Tech & IT)",
    baseUrl: "https://jobwebkenya.com",
    searchEndpoint: "/feed/",
    enabled: true,
    rateLimit: 60,
    countries: ["Kenya"],
    remoteOnly: false,
  },
  {
    id: "googlejobs",
    name: "Google for Jobs (Kenya Tech & IT)",
    baseUrl: "https://www.google.com",
    searchEndpoint: "/search?q=jobs+kenya",
    enabled: true,
    rateLimit: 60,
    countries: ["Kenya"],
    remoteOnly: false,
  },
  {
    id: "workingnomads",
    name: "Working Nomads (Remote Tech)",
    baseUrl: "https://www.workingnomads.com",
    searchEndpoint: "/api/exposed_jobs/",
    enabled: true,
    rateLimit: 60,
    countries: [],
    remoteOnly: true,
  },
  {
    id: "weworkremotely",
    name: "We Work Remotely (Tech)",
    baseUrl: "https://weworkremotely.com",
    searchEndpoint: "/categories/remote-programming-jobs.rss",
    enabled: true,
    rateLimit: 60,
    countries: [],
    remoteOnly: true,
  },
  {
    id: "himalayas",
    name: "Himalayas Developer Feed",
    baseUrl: "https://himalayas.app",
    searchEndpoint: "/jobs/api",
    enabled: true,
    rateLimit: 60,
    countries: [],
    remoteOnly: true,
  },
  {
    id: "arbeitnow",
    name: "Arbeitnow Remote Tech",
    baseUrl: "https://www.arbeitnow.com",
    searchEndpoint: "/api/job-board-api",
    enabled: true,
    rateLimit: 60,
    countries: [],
    remoteOnly: true,
  },
  {
    id: "jobicy",
    name: "Jobicy Remote Dev",
    baseUrl: "https://jobicy.com",
    searchEndpoint: "/api/v2/remote-jobs",
    enabled: true,
    rateLimit: 60,
    countries: [],
    remoteOnly: true,
  },
  {
    id: "remotive",
    name: "Remotive Software",
    baseUrl: "https://remotive.com",
    searchEndpoint: "/api/remote-jobs",
    enabled: true,
    rateLimit: 60,
    countries: [],
    remoteOnly: true,
  },
  {
    id: "remoteok",
    name: "RemoteOK",
    baseUrl: "https://remoteok.com",
    searchEndpoint: "/api",
    enabled: true,
    rateLimit: 60,
    countries: [],
    remoteOnly: true,
  },
];

export interface JobSearchFilter {
  keywords: string[];
  locations: string[];
  remote: boolean;
  minSalary?: number;
  maxSalary?: number;
  jobTypes?: string[];
  experienceLevel?: string[];
  industries?: string[];
  companies?: string[];
  excludeKeywords?: string[];
  datePosted?: string;
  sortBy?: "relevance" | "date" | "salary";
}

export interface NormalizedJob {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  salary: string | null;
  source: string;
  sourceUrl: string | null;
  externalJobId: string | null;
  description: string;
  discoveredAt: Date;
  deadlineDate?: Date | null;
  postedDate?: Date | null;
  normalizedCompany: string;
  normalizedTitle: string;
  normalizedLocation: string;
  country?: string;
  jobType?: string;
  experienceLevel?: string;
  skills?: string[];
}

function cleanHtml(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>?/gm, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#038;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJobDate(val: unknown): Date {
  if (!val) return new Date();
  if (typeof val === "number") {
    return new Date(val < 1e11 ? val * 1000 : val);
  }
  if (typeof val === "string") {
    const num = Number(val);
    if (!isNaN(num) && num > 0) {
      return new Date(num < 1e11 ? num * 1000 : num);
    }
    const d = new Date(val);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d;
  }
  return new Date();
}

export function extractDeadlineDate(text: string): Date | null {
  if (!text) return null;
  const match = text.match(
    /(?:deadline|closing date|apply by|application deadline|expires|closing on|submit before|valid until)[:\s*]+([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s+[0-9]{4}|[A-Za-z]+\s+[0-9]{1,2}(?:st|nd|rd|th)?,?\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[\/\.-][0-9]{1,2}[\/\.-][0-9]{2,4})/i,
  );
  if (!match || !match[1]) return null;
  const parsed = new Date(match[1]);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function isJobExpired(deadline: Date | null | undefined, postedDate?: Date | null): boolean {
  const now = Date.now();
  if (deadline && deadline.getTime() + 86400000 < now) {
    return true;
  }
  if (postedDate && postedDate.getTime() + 30 * 86400000 < now) {
    return true;
  }
  return false;
}

/**
 * Filter out completely irrelevant professions (medical, legal, accounting, non-English reception, etc.)
 */
export function isRelevantTechOrItJob(job: NormalizedJob): boolean {
  const text = `${job.title} ${job.description} ${job.company}`.toLowerCase();
  const title = job.title.toLowerCase();

  // Reject executive / director roles immediately
  if (EXECUTIVE_REGEX.test(job.title)) return false;

  // Reject off-family professions
  if (OFF_FAMILY_PROFESSIONS_REGEX.test(job.title)) return false;

  // Explicit blacklist of non-tech professions & foreign language roles
  const blacklist = [
    "oncology", "pharmacist", "doctor", "nurse", "veterin", "tierarzt",
    "legal counsel", "attorney", "lawyer", "corporate counsel",
    "accountant", "accounts receivable", "auditor", "fp&a", "wealth management", "payroll assistant",
    "real estate sales", "verwalter", "property manager", "horeca", "automotriz",
    "kundenservice", "telefondienst", "head academic", "deputy head", "school teacher",
    "supply chain", "category buyer", "logistics coordinator", "medical review",
    "revenue marketing", "event coordinator", "inside sales", "finance consultant",
    "safety officer", "health and safety", "driver", "chef", "cook", "security guard",
    "submit cvs - new recruitment", "registration fee", "pay to apply",
  ];

  for (const bad of blacklist) {
    if (title.includes(bad)) return false;
  }

  // Must match software, web, IT support, automation, data, or cybersecurity domain
  const techKeywords = [
    "software", "developer", "engineer", "frontend", "front-end", "backend", "back-end",
    "full stack", "full-stack", "fullstack", "web", "react", "node", "python",
    "javascript", "typescript", "it support", "support specialist", "systems", "network",
    "technician", "cybersecurity", "security", "qa", "tester", "testing", "automation",
    "supabase", "postgresql", "sql", "devops", "cloud", "api", "database", "programmer", "coding",
    "helpdesk", "help desk", "service desk", "desktop support", "ict officer", "it officer",
    "technical support", "deployment", "lan", "wan", "cisco",
  ];

  const hasTechKeyword = techKeywords.some((kw) => title.includes(kw) || text.includes(kw));
  return hasTechKeyword;
}

export function isEligibleMarket(job: NormalizedJob): boolean {
  const loc = (job.location || "").toLowerCase();
  const desc = (job.description || "").toLowerCase();
  const title = (job.title || "").toLowerCase();
  const src = (job.source || "").toLowerCase();

  // 1. Remote / Worldwide / Africa positions
  if (
    job.remote ||
    loc.includes("remote") ||
    loc.includes("worldwide") ||
    loc.includes("anywhere") ||
    loc.includes("global") ||
    loc.includes("emea") ||
    loc.includes("africa")
  ) {
    return true;
  }

  // 2. Local Kenyan market
  const kenyaKeywords = ["kenya", "nairobi", "mombasa", "kisumu", "nakuru", "eldoret", "thika", "jobwebkenya"];
  return kenyaKeywords.some((k) => loc.includes(k) || desc.includes(k) || src.includes(k) || title.includes(k));
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// 1. MyJobMag Kenya Live Ingestion (Full Details, Method of Application & Emails)
async function fetchMyJobMagJobs(limit = 35): Promise<NormalizedJob[]> {
  try {
    const urls = [
      "https://www.myjobmag.co.ke/jobs-by-field/information-technology",
      "https://www.myjobmag.co.ke/jobs-by-field/ict-telecommunications",
    ];

    const allDiscoveredLinks: { title: string; url: string; company?: string }[] = [];

    for (const catUrl of urls) {
      const res = await fetchWithTimeout(catUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const linkRegex = /<a\s+[^>]*href=["'](\/job\/[^"']+)["'][^>]*>(.*?)<\/a>/gi;
      let match;
      while ((match = linkRegex.exec(html)) !== null && allDiscoveredLinks.length < 50) {
        const path = match[1];
        const rawText = match[2].replace(/<[^>]+>/g, "").trim();
        if (rawText && !rawText.includes("Jobs in Kenya")) {
          const fullUrl = `https://www.myjobmag.co.ke${path}`;
          if (!allDiscoveredLinks.some((l) => l.url === fullUrl)) {
            let title = rawText;
            let company = "Company in Kenya";
            if (rawText.includes(" at ")) {
              const parts = rawText.split(" at ");
              title = parts[0].trim();
              company = parts.slice(1).join(" at ").trim();
            }
            allDiscoveredLinks.push({ title, url: fullUrl, company });
          }
        }
      }
    }

    const items: NormalizedJob[] = [];
    const targetLinks = allDiscoveredLinks.slice(0, limit);

    // Concurrently fetch detail pages with full description and Method of Application
    await Promise.all(
      targetLinks.map(async ({ title, url, company }) => {
        try {
          const dRes = await fetchWithTimeout(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          }, 6000);
          if (!dRes.ok) return;
          const dHtml = await dRes.text();
          const cleanDesc = cleanHtml(dHtml);
          const appDetails = extractApplicationDetails(cleanDesc, url, title, company);
          const deadline = appDetails.deadlineDate || extractDeadlineDate(cleanDesc);
          if (isJobExpired(deadline)) return;

          const banner = formatApplicationBanner(appDetails, title, company || "Company in Kenya");
          const finalDescription = `${banner}\n${cleanDesc.slice(0, 3500)}`;

          const job: NormalizedJob = {
            id: `mjm-${Buffer.from(url).toString("base64").slice(0, 16)}`,
            title,
            company: company || "Company in Kenya",
            location: "Nairobi, Kenya",
            remote: cleanDesc.toLowerCase().includes("remote") || cleanDesc.toLowerCase().includes("work from home"),
            salary: null,
            source: "MyJobMag Kenya",
            sourceUrl: url,
            externalJobId: url,
            description: finalDescription,
            discoveredAt: new Date(),
            deadlineDate: deadline,
            postedDate: new Date(),
            normalizedCompany: normalizeCompany(company || "Company in Kenya"),
            normalizedTitle: normalizeText(title),
            normalizedLocation: normalizeText("Nairobi, Kenya"),
            skills: [],
            jobType: "Full-time",
          };

          if (isRelevantTechOrItJob(job)) {
            items.push(job);
          }
        } catch {
          // Ignore individual fetch errors
        }
      })
    );

    return items;
  } catch (err) {
    console.error("[JobSearch] MyJobMag fetch failed:", err);
    return [];
  }
}

// 2. Career Point Kenya Live RSS & Full Details Ingestion
async function fetchCareerPointKenyaJobs(limit = 40): Promise<NormalizedJob[]> {
  try {
    const feedUrls = [
      "https://www.careerpointkenya.co.ke/category/it-jobs-in-kenya/feed/",
      "https://www.careerpointkenya.co.ke/feed/",
    ];

    const items: NormalizedJob[] = [];
    const seenUrls = new Set<string>();

    for (const feedUrl of feedUrls) {
      if (items.length >= limit) break;
      const res = await fetchWithTimeout(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) KaziScout/2.0" },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;

      while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
        const itemXml = match[1];
        const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
        const linkMatch = itemXml.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/);
        const descMatch =
          itemXml.match(/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/) ||
          itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
        const dateMatch = itemXml.match(/<pubDate>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/pubDate>/);

        let rawTitle = titleMatch ? titleMatch[1].replace(/&#8211;/g, "-").replace(/&#038;/g, "&").trim() : "";
        if (!rawTitle || rawTitle.includes("Jobs in Kenya")) continue;

        const url = linkMatch ? linkMatch[1].trim() : "";
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);

        let company = "Company in Kenya";
        let title = rawTitle;
        if (rawTitle.includes(" at ")) {
          const parts = rawTitle.split(" at ");
          title = parts[0].trim();
          company = parts.slice(1).join(" at ").trim();
        } else if (rawTitle.includes(" Job ")) {
          const parts = rawTitle.split(" Job ");
          title = parts[0].trim();
          company = parts.slice(1).join(" Job ").trim();
        }

        const rawDesc = descMatch ? descMatch[1] : "";
        const cleanDesc = cleanHtml(rawDesc);
        const appDetails = extractApplicationDetails(cleanDesc, url, title, company);
        const deadline = appDetails.deadlineDate || extractDeadlineDate(cleanDesc);
        if (isJobExpired(deadline)) continue;

        const banner = formatApplicationBanner(appDetails, title, company);
        const finalDescription = `${banner}\n${cleanDesc.slice(0, 3500)}`;
        const postedDate = dateMatch ? parseJobDate(dateMatch[1]) : new Date();

        const candidateJob: NormalizedJob = {
          id: `cpk-${Buffer.from(url).toString("base64").slice(0, 16)}`,
          title,
          company,
          location: "Nairobi, Kenya",
          remote: cleanDesc.toLowerCase().includes("remote") || cleanDesc.toLowerCase().includes("work from home"),
          salary: null,
          source: "Career Point Kenya",
          sourceUrl: url,
          externalJobId: url,
          description: finalDescription,
          discoveredAt: postedDate,
          deadlineDate: deadline,
          postedDate,
          normalizedCompany: normalizeCompany(company),
          normalizedTitle: normalizeText(title),
          normalizedLocation: normalizeText("Nairobi, Kenya"),
          skills: [],
          jobType: "Full-time",
        };

        if (isRelevantTechOrItJob(candidateJob)) {
          items.push(candidateJob);
        }
      }
    }

    return items;
  } catch (err) {
    console.error("[JobSearch] CareerPoint Kenya fetch failed:", err);
    return [];
  }
}

// 3. JobWeb Kenya Live RSS parser (with full application details banner)
async function fetchJobWebKenyaJobs(limit = 40): Promise<NormalizedJob[]> {
  try {
    const feedUrls = [
      "https://jobwebkenya.com/category/ict-jobs-in-kenya/feed/",
      "https://jobwebkenya.com/feed/",
    ];

    const items: NormalizedJob[] = [];
    const seenUrls = new Set<string>();

    for (const feedUrl of feedUrls) {
      if (items.length >= limit) break;
      const res = await fetchWithTimeout(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) KaziScout/2.0" },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;

      while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
        const itemXml = match[1];
        const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
        const linkMatch = itemXml.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/);
        const descMatch =
          itemXml.match(/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/) ||
          itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
        const dateMatch = itemXml.match(/<pubDate>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/pubDate>/);

        let rawTitle = titleMatch ? titleMatch[1].replace(/&#8211;/g, "-").replace(/&#038;/g, "&").trim() : "";
        if (!rawTitle || rawTitle.includes("Jobs in Kenya")) continue;

        const url = linkMatch ? linkMatch[1].trim() : "";
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);

        let company = "Company in Kenya";
        let title = rawTitle;
        if (rawTitle.includes(" at ")) {
          const parts = rawTitle.split(" at ");
          title = parts[0].trim();
          company = parts.slice(1).join(" at ").trim();
        }

        const cleanDesc = cleanHtml(descMatch ? descMatch[1] : "");
        const appDetails = extractApplicationDetails(cleanDesc, url, title, company);
        const deadline = appDetails.deadlineDate || extractDeadlineDate(cleanDesc);
        if (isJobExpired(deadline)) continue;

        const banner = formatApplicationBanner(appDetails, title, company);
        const finalDescription = `${banner}\n${cleanDesc.slice(0, 3500)}`;
        const postedDate = dateMatch ? parseJobDate(dateMatch[1]) : new Date();

        const candidateJob: NormalizedJob = {
          id: `jwk-${Buffer.from(url).toString("base64").slice(0, 16)}`,
          title,
          company,
          location: "Nairobi, Kenya",
          remote: cleanDesc.toLowerCase().includes("remote") || cleanDesc.toLowerCase().includes("work from home"),
          salary: null,
          source: "JobWeb Kenya",
          sourceUrl: url,
          externalJobId: url,
          description: finalDescription,
          discoveredAt: postedDate,
          deadlineDate: deadline,
          postedDate,
          normalizedCompany: normalizeCompany(company),
          normalizedTitle: normalizeText(title),
          normalizedLocation: normalizeText("Nairobi, Kenya"),
          skills: [],
          jobType: "Full-time",
        };

        if (isRelevantTechOrItJob(candidateJob)) {
          items.push(candidateJob);
        }
      }
    }

    return items;
  } catch (err) {
    console.error("[JobSearch] JobWeb Kenya fetch failed:", err);
    return [];
  }
}

// 4. Google for Jobs / Web Query Live Search
async function fetchGoogleAndWebJobs(limit = 30): Promise<NormalizedJob[]> {
  try {
    const queries = [
      "https://jobwebkenya.com/?s=IT+support",
      "https://jobwebkenya.com/?s=software+developer",
      "https://jobwebkenya.com/?s=ICT+officer",
    ];

    const items: NormalizedJob[] = [];
    const seenUrls = new Set<string>();

    for (const qUrl of queries) {
      if (items.length >= limit) break;
      const res = await fetchWithTimeout(qUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const articleRegex = /<h2\s+class=["']entry-title["']><a\s+href=["']([^"']+)["'][^>]*>(.*?)<\/a><\/h2>/gi;
      let match;

      while ((match = articleRegex.exec(html)) !== null && items.length < limit) {
        const url = match[1];
        const rawTitle = match[2].replace(/<[^>]+>/g, "").trim();
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);

        let title = rawTitle;
        let company = "Company in Kenya";
        if (rawTitle.includes(" at ")) {
          const parts = rawTitle.split(" at ");
          title = parts[0].trim();
          company = parts.slice(1).join(" at ").trim();
        }

        const candidateJob: NormalizedJob = {
          id: `gweb-${Buffer.from(url).toString("base64").slice(0, 16)}`,
          title,
          company,
          location: "Nairobi, Kenya",
          remote: false,
          salary: null,
          source: "Google / Kenya Web Search",
          sourceUrl: url,
          externalJobId: url,
          description: `Live vacancy indexed for Kenya IT market: ${title} at ${company}. Open original link for full application portal and submission instructions.`,
          discoveredAt: new Date(),
          deadlineDate: null,
          postedDate: new Date(),
          normalizedCompany: normalizeCompany(company),
          normalizedTitle: normalizeText(title),
          normalizedLocation: normalizeText("Nairobi, Kenya"),
          skills: [],
          jobType: "Full-time",
        };

        if (isRelevantTechOrItJob(candidateJob)) {
          items.push(candidateJob);
        }
      }
    }

    return items;
  } catch (err) {
    console.error("[JobSearch] Google & Web Jobs fetch failed:", err);
    return [];
  }
}

// 2. Working Nomads Live API (Remote Tech & Dev)
async function fetchWorkingNomadsJobs(limit = 40): Promise<NormalizedJob[]> {
  try {
    const res = await fetchWithTimeout("https://www.workingnomads.com/api/exposed_jobs/", {
      headers: { "User-Agent": "Mozilla/5.0 KaziScout/2.0" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any[];
    const items = Array.isArray(data) ? data : [];

    return items
      .filter((item) => {
        const cat = (item.category_name || "").toLowerCase();
        return cat.includes("dev") || cat.includes("software") || cat.includes("system") || cat.includes("support") || cat.includes("tech");
      })
      .map((item: any, idx: number) => {
        const title = String(item.title || "Software Developer").trim();
        const company = String(item.company_name || "Tech Group").trim();
        const desc = cleanHtml(String(item.description || ""));
        const deadline = extractDeadlineDate(desc);
        const postedDate = parseJobDate(item.pub_date);
        const tags = item.tags ? String(item.tags).split(",").map((s) => s.trim()) : [];

        return {
          id: `wn-${item.id || idx}`,
          title,
          company,
          location: item.location || "Worldwide Remote",
          remote: true,
          salary: null,
          source: "Working Nomads",
          sourceUrl: item.url || "https://www.workingnomads.com",
          externalJobId: String(item.id || `wn-${idx}`),
          description: desc.slice(0, 3000),
          discoveredAt: postedDate,
          deadlineDate: deadline,
          postedDate,
          normalizedCompany: normalizeCompany(company),
          normalizedTitle: normalizeText(title),
          normalizedLocation: normalizeText(item.location || "remote"),
          skills: tags,
          jobType: "Full-time",
        };
      })
      .filter((j) => !isJobExpired(j.deadlineDate, j.postedDate) && isRelevantTechOrItJob(j))
      .slice(0, limit);
  } catch (err) {
    console.error("[JobSearch] WorkingNomads fetch failed:", err);
    return [];
  }
}

// 3. WeWorkRemotely Live RSS (Programming & Dev)
async function fetchWeWorkRemotelyJobs(limit = 40): Promise<NormalizedJob[]> {
  try {
    const res = await fetchWithTimeout("https://weworkremotely.com/categories/remote-programming-jobs.rss", {
      headers: { "User-Agent": "Mozilla/5.0 KaziScout/2.0" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: NormalizedJob[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
      const itemXml = match[1];
      const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
      const linkMatch = itemXml.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/);
      const descMatch = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
      const dateMatch = itemXml.match(/<pubDate>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/pubDate>/);

      const rawTitle = titleMatch ? titleMatch[1].trim() : "";
      if (!rawTitle) continue;

      let company = "Tech Company";
      let title = rawTitle;
      if (rawTitle.includes(": ")) {
        const parts = rawTitle.split(": ");
        company = parts[0].trim();
        title = parts.slice(1).join(": ").trim();
      }

      const desc = cleanHtml(descMatch ? descMatch[1] : "");
      const deadline = extractDeadlineDate(desc);
      if (isJobExpired(deadline)) continue;

      const url = linkMatch ? linkMatch[1].trim() : "https://weworkremotely.com";
      const postedDate = dateMatch ? parseJobDate(dateMatch[1]) : new Date();

      const candidateJob: NormalizedJob = {
        id: `wwr-${Buffer.from(url).toString("base64").slice(0, 16)}`,
        title,
        company,
        location: "Worldwide Remote",
        remote: true,
        salary: null,
        source: "WeWorkRemotely",
        sourceUrl: url,
        externalJobId: url,
        description: desc.slice(0, 3000),
        discoveredAt: postedDate,
        deadlineDate: deadline,
        postedDate,
        normalizedCompany: normalizeCompany(company),
        normalizedTitle: normalizeText(title),
        normalizedLocation: normalizeText("worldwide remote"),
        skills: [],
        jobType: "Full-time",
      };

      if (isRelevantTechOrItJob(candidateJob)) {
        items.push(candidateJob);
      }
    }

    return items;
  } catch (err) {
    console.error("[JobSearch] WeWorkRemotely fetch failed:", err);
    return [];
  }
}

// 3. Himalayas Tech Live API
async function fetchHimalayasJobs(limit = 40): Promise<NormalizedJob[]> {
  try {
    const res = await fetchWithTimeout("https://himalayas.app/jobs/api?limit=40");
    if (!res.ok) return [];
    const data = (await res.json()) as { jobs?: any[] };
    const items = data.jobs || [];

    return items
      .map((item: any, idx: number) => {
        const title = String(item.title || "Developer").trim();
        const company = String(item.companyName || "Tech Corp").trim();
        const desc = cleanHtml(String(item.description || ""));
        const deadline = item.expiresAt ? parseJobDate(item.expiresAt) : extractDeadlineDate(desc);
        const postedDate = parseJobDate(item.pubDate || item.createdAt);
        const salary = item.minSalary
          ? `$${item.minSalary.toLocaleString()} - $${(item.maxSalary || item.minSalary).toLocaleString()}`
          : null;

        return {
          id: `himalayas-${item.slug || idx}`,
          title,
          company,
          location: item.locationRestrictions?.join(", ") || "Worldwide Remote",
          remote: true,
          salary,
          source: "Himalayas",
          sourceUrl: item.applicationLink || `https://himalayas.app/companies/${item.companySlug}/jobs/${item.slug}`,
          externalJobId: item.slug || `hm-${idx}`,
          description: desc.slice(0, 3000),
          discoveredAt: postedDate,
          deadlineDate: deadline,
          postedDate,
          normalizedCompany: normalizeCompany(company),
          normalizedTitle: normalizeText(title),
          normalizedLocation: normalizeText(item.locationRestrictions?.join(" ") || "remote"),
          skills: Array.isArray(item.categories) ? item.categories : [],
          jobType: item.employmentType || "Full-time",
        };
      })
      .filter((j) => isRelevantTechOrItJob(j))
      .slice(0, limit);
  } catch (err) {
    console.error("[JobSearch] Himalayas fetch failed:", err);
    return [];
  }
}

// 4. ArbeitNow Live Feed
async function fetchArbeitnowJobs(limit = 40): Promise<NormalizedJob[]> {
  try {
    const res = await fetchWithTimeout("https://www.arbeitnow.com/api/job-board-api");
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: any[] };
    const items = data.data || [];
    return items
      .map((item: any, idx: number) => {
        const title = String(item.title || "Software Engineer").trim();
        const company = String(item.company_name || "Tech Company").trim();
        const desc = cleanHtml(String(item.description || ""));
        const deadline = extractDeadlineDate(desc);
        const postedDate = item.created_at ? parseJobDate(item.created_at * 1000) : new Date();

        return {
          id: `arbeitnow-${item.slug || idx}`,
          title,
          company,
          location: item.location || "Worldwide Remote",
          remote: Boolean(item.remote ?? true),
          salary: null,
          source: "Arbeitnow",
          sourceUrl: item.url || `https://www.arbeitnow.com/jobs/${item.slug}`,
          externalJobId: String(item.slug || `an-${idx}`),
          description: desc.slice(0, 3000),
          discoveredAt: postedDate,
          deadlineDate: deadline,
          postedDate,
          normalizedCompany: normalizeCompany(company),
          normalizedTitle: normalizeText(title),
          normalizedLocation: normalizeText(item.location || "remote"),
          skills: Array.isArray(item.tags) ? item.tags : [],
          jobType: Array.isArray(item.job_types) ? item.job_types[0] : "Full-time",
        };
      })
      .filter((j) => isRelevantTechOrItJob(j))
      .slice(0, limit);
  } catch (err) {
    console.error("[JobSearch] Arbeitnow fetch failed:", err);
    return [];
  }
}

// 5. Jobicy Live Feed
async function fetchJobicyJobs(limit = 40): Promise<NormalizedJob[]> {
  try {
    const res = await fetchWithTimeout("https://jobicy.com/api/v2/remote-jobs?count=50");
    if (!res.ok) return [];
    const data = (await res.json()) as { jobs?: any[] };
    const items = data.jobs || [];
    return items
      .map((item: any, idx: number) => {
        const title = String(item.jobTitle || "Developer").trim();
        const company = String(item.companyName || "Tech Corp").trim();
        const desc = cleanHtml(String(item.jobDescription || ""));
        const deadline = extractDeadlineDate(desc);
        const postedDate = parseJobDate(item.pubDate);
        const salary = item.annualSalaryMin
          ? `$${item.annualSalaryMin.toLocaleString()} - $${(item.annualSalaryMax || item.annualSalaryMin).toLocaleString()}`
          : null;
        return {
          id: `jobicy-${item.id || idx}`,
          title,
          company,
          location: item.jobGeo || "Worldwide Remote",
          remote: true,
          salary,
          source: "Jobicy",
          sourceUrl: item.url || null,
          externalJobId: String(item.id || `ji-${idx}`),
          description: desc.slice(0, 3000),
          discoveredAt: postedDate,
          deadlineDate: deadline,
          postedDate,
          normalizedCompany: normalizeCompany(company),
          normalizedTitle: normalizeText(title),
          normalizedLocation: normalizeText(item.jobGeo || "remote"),
          skills: [item.jobIndustry, ...(Array.isArray(item.jobType) ? item.jobType : [])].filter(Boolean),
          jobType: Array.isArray(item.jobType) ? item.jobType[0] : "Full-time",
        };
      })
      .filter((j) => isRelevantTechOrItJob(j))
      .slice(0, limit);
  } catch (err) {
    console.error("[JobSearch] Jobicy fetch failed:", err);
    return [];
  }
}

// 6. Remotive Live Feed
async function fetchRemotiveJobs(limit = 40): Promise<NormalizedJob[]> {
  try {
    const res = await fetchWithTimeout("https://remotive.com/api/remote-jobs?limit=50");
    if (!res.ok) return [];
    const data = (await res.json()) as { jobs?: any[] };
    const items = data.jobs || [];
    return items
      .map((item: any, idx: number) => {
        const title = String(item.title || "Engineer").trim();
        const company = String(item.company_name || "Remote Team").trim();
        const desc = cleanHtml(String(item.description || ""));
        const deadline = extractDeadlineDate(desc);
        const postedDate = parseJobDate(item.publication_date);
        return {
          id: `remotive-${item.id || idx}`,
          title,
          company,
          location: item.candidate_required_location || "Worldwide Remote",
          remote: true,
          salary: item.salary || null,
          source: "Remotive",
          sourceUrl: item.url || null,
          externalJobId: String(item.id || `rm-${idx}`),
          description: desc.slice(0, 3000),
          discoveredAt: postedDate,
          deadlineDate: deadline,
          postedDate,
          normalizedCompany: normalizeCompany(company),
          normalizedTitle: normalizeText(title),
          normalizedLocation: normalizeText(item.candidate_required_location || "remote"),
          skills: Array.isArray(item.tags) ? item.tags : [],
          jobType: item.job_type || "Full-time",
        };
      })
      .filter((j) => isRelevantTechOrItJob(j))
      .slice(0, limit);
  } catch (err) {
    console.error("[JobSearch] Remotive fetch failed:", err);
    return [];
  }
}

// 7. RemoteOK Live Feed
async function fetchRemoteOkJobs(limit = 40): Promise<NormalizedJob[]> {
  try {
    const res = await fetchWithTimeout("https://remoteok.com/api", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) KaziScout/2.0" },
    });
    if (!res.ok) return [];
    const raw = (await res.json()) as any[];
    const items = Array.isArray(raw) ? raw.filter((x: any) => x && x.id && x.position) : [];
    return items
      .map((item: any, idx: number) => {
        const title = String(item.position || "Developer").trim();
        const company = String(item.company || "Tech Group").trim();
        const desc = cleanHtml(String(item.description || ""));
        const deadline = extractDeadlineDate(desc);
        const postedDate = parseJobDate(item.date);
        const salary =
          item.salary_min && item.salary_min > 0
            ? `$${item.salary_min.toLocaleString()} - $${(item.salary_max || item.salary_min).toLocaleString()}`
            : null;
        return {
          id: `remoteok-${item.id || idx}`,
          title,
          company,
          location: item.location || "Remote",
          remote: true,
          salary,
          source: "RemoteOK",
          sourceUrl: item.apply_url || item.url || `https://remoteok.com/remote-jobs/${item.slug || item.id}`,
          externalJobId: String(item.id || `ro-${idx}`),
          description: desc.slice(0, 3000),
          discoveredAt: postedDate,
          deadlineDate: deadline,
          postedDate,
          normalizedCompany: normalizeCompany(company),
          normalizedTitle: normalizeText(title),
          normalizedLocation: normalizeText(item.location || "remote"),
          skills: Array.isArray(item.tags) ? item.tags : [],
          jobType: "Full-time",
        };
      })
      .filter((j) => isRelevantTechOrItJob(j))
      .slice(0, limit);
  } catch (err) {
    console.error("[JobSearch] RemoteOK fetch failed:", err);
    return [];
  }
}

export async function searchJobsFromSource(
  source: JobSource,
  filter: JobSearchFilter,
  limit: number = 40,
): Promise<NormalizedJob[]> {
  if (!source.enabled) return [];

  switch (source.id) {
    case "myjobmag":
      return fetchMyJobMagJobs(limit);
    case "careerpointkenya":
      return fetchCareerPointKenyaJobs(limit);
    case "jobwebkenya":
      return fetchJobWebKenyaJobs(limit);
    case "googlejobs":
      return fetchGoogleAndWebJobs(limit);
    case "workingnomads":
      return fetchWorkingNomadsJobs(limit);
    case "weworkremotely":
      return fetchWeWorkRemotelyJobs(limit);
    case "himalayas":
      return fetchHimalayasJobs(limit);
    case "arbeitnow":
      return fetchArbeitnowJobs(limit);
    case "jobicy":
      return fetchJobicyJobs(limit);
    case "remotive":
      return fetchRemotiveJobs(limit);
    case "remoteok":
      return fetchRemoteOkJobs(limit);
    default:
      return [];
  }
}

export async function searchAllJobs(
  filter: JobSearchFilter,
  limitPerSource: number = 35,
): Promise<{ jobs: NormalizedJob[]; sourceStats: Map<string, { total: number; matched: number }> }> {
  const sourceStats = new Map<string, { total: number; matched: number }>();
  const allJobs: NormalizedJob[] = [];

  // 1. Fetch public ATS endpoints for Kenyan & African tech employers
  try {
    const atsJobs = await fetchAllAtsJobs();
    const normalizedAtsJobs: NormalizedJob[] = atsJobs.map((aj, idx) => {
      const desc = aj.description || "";
      const deadline = extractDeadlineDate(desc);
      return {
        id: aj.externalId || `ats-${idx}`,
        title: aj.title,
        company: aj.company,
        location: aj.location,
        remote: aj.remote,
        salary: null,
        source: `ATS (${aj.company})`,
        sourceUrl: aj.url,
        externalJobId: aj.externalId,
        description: desc.slice(0, 4000),
        discoveredAt: aj.postedDate,
        deadlineDate: deadline,
        postedDate: aj.postedDate,
        normalizedCompany: normalizeCompany(aj.company),
        normalizedTitle: normalizeText(aj.title),
        normalizedLocation: normalizeText(aj.location),
        skills: [],
        jobType: "Full-time",
      };
    });

    const validAts = normalizedAtsJobs.filter(
      (j) => !isJobExpired(j.deadlineDate, j.postedDate) && isEligibleMarket(j) && isRelevantTechOrItJob(j),
    );
    sourceStats.set("ats_registry", { total: atsJobs.length, matched: validAts.length });
    allJobs.push(...validAts);
  } catch (err) {
    console.error("[JobSearch] ATS fetch error:", err);
    sourceStats.set("ats_registry", { total: 0, matched: 0 });
  }

  // 2. Fetch all live feeds and APIs
  const fetches = ALL_JOB_SOURCES.map(async (source) => {
    if (!source.enabled) return [];
    try {
      const jobs = await searchJobsFromSource(source, filter, limitPerSource);
      const activeJobs = jobs.filter(
        (j) => !isJobExpired(j.deadlineDate, j.postedDate) && isEligibleMarket(j) && isRelevantTechOrItJob(j),
      );
      sourceStats.set(source.id, { total: jobs.length, matched: activeJobs.length });
      return activeJobs;
    } catch (error) {
      console.error(`Error searching ${source.name}:`, error);
      sourceStats.set(source.id, { total: 0, matched: 0 });
      return [];
    }
  });

  const results = await Promise.all(fetches);
  for (const list of results) {
    allJobs.push(...list);
  }

  // 3. Query enabled sources from central Source Registry
  try {
    const registrySources = await db
      .select()
      .from(jobSourcesTable)
      .where(and(eq(jobSourcesTable.enabled, true), inArray(jobSourcesTable.status, ["ACTIVE", "READY"])))
      .limit(20);

    const registryFetches = registrySources.map(async (sourceRow) => {
      try {
        const connector = getConnectorForSource(sourceRow);
        const discovered = await connector.discoverListings(sourceRow, {
          keywords: filter.keywords,
          locations: filter.locations,
          remoteOnly: filter.remote,
          limit: limitPerSource,
        });

        const normalizedListings: NormalizedJob[] = discovered.map((d) => {
          const deadline = d.deadlineDate ? new Date(d.deadlineDate) : extractDeadlineDate(d.description);
          const posted = d.postedDate ? new Date(d.postedDate) : new Date();
          return {
            id: d.externalJobId || crypto.randomUUID(),
            title: d.title,
            company: d.company,
            location: d.location || "Kenya",
            remote: Boolean(d.remote),
            salary: d.salary || null,
            source: sourceRow.name,
            sourceUrl: d.url,
            externalJobId: d.externalJobId || null,
            description: d.description,
            discoveredAt: new Date(),
            deadlineDate: deadline,
            postedDate: posted,
            normalizedCompany: normalizeCompany(d.company),
            normalizedTitle: normalizeText(d.title),
            normalizedLocation: normalizeText(d.location || "kenya"),
            country: d.country || sourceRow.country || "Kenya",
            jobType: d.jobType || "Full-time",
            skills: d.skills || [],
          };
        });

        const activeListings = normalizedListings.filter(
          (j) => !isJobExpired(j.deadlineDate, j.postedDate) && isEligibleMarket(j) && isRelevantTechOrItJob(j),
        );

        sourceStats.set(sourceRow.id, { total: discovered.length, matched: activeListings.length });

        await db
          .update(jobSourcesTable)
          .set({
            totalDiscovered: (sourceRow.totalDiscovered || 0) + discovered.length,
            totalIndexed: (sourceRow.totalIndexed || 0) + activeListings.length,
            lastCheckedAt: new Date(),
            lastSuccessfulRunAt: new Date(),
            lastJobDiscoveredAt: discovered.length > 0 ? new Date() : sourceRow.lastJobDiscoveredAt,
            consecutiveFailures: 0,
            updatedAt: new Date(),
          })
          .where(eq(jobSourcesTable.id, sourceRow.id));

        return activeListings;
      } catch (err: any) {
        console.error(`[JobSearch] Error running connector for source ${sourceRow.name}:`, err?.message);
        await db
          .update(jobSourcesTable)
          .set({
            lastCheckedAt: new Date(),
            lastErrorAt: new Date(),
            lastErrorMessage: err?.message || "Discovery error",
            consecutiveFailures: (sourceRow.consecutiveFailures || 0) + 1,
            updatedAt: new Date(),
          })
          .where(eq(jobSourcesTable.id, sourceRow.id));
        return [];
      }
    });

    const regResults = await Promise.all(registryFetches);
    for (const list of regResults) {
      allJobs.push(...list);
    }
  } catch (err) {
    console.error("[JobSearch] Error fetching registry sources:", err);
  }

  return { jobs: allJobs, sourceStats };
}

export function filterJobs(jobs: NormalizedJob[], filter: JobSearchFilter): NormalizedJob[] {
  return jobs.filter((job) => {
    if (isJobExpired(job.deadlineDate, job.postedDate)) return false;
    if (!isEligibleMarket(job)) return false;
    if (!isRelevantTechOrItJob(job)) return false;

    if (filter.excludeKeywords && filter.excludeKeywords.length > 0) {
      const jobText = `${job.title} ${job.description} ${job.company}`.toLowerCase();
      const hasExcluded = filter.excludeKeywords.some(
        (keyword: string) => keyword && jobText.includes(keyword.toLowerCase()),
      );
      if (hasExcluded) return false;
    }

    return true;
  });
}

export const ROLE_ALLOW_PATTERNS: RegExp[] = [
  /\b(it|ict)\s+(support|officer|technician|assistant|administrator|admin|specialist)\b/i,
  /\b(help\s?desk|service\s?desk|desktop\s+support|technical\s+support|support\s+(?:engineer|technician|specialist))\b/i,
  /\b(junior\s+)?(system|systems|network)\s+(administrator|admin|technician|support|engineer)\b/i,
  /\b(front[- ]?end|full[- ]?stack|web|software|react|node|python|javascript|typescript|automation)\s+(developer|engineer|programmer)\b/i,
  /\b(qa|quality\s+assurance|test(?:er|ing)|test\s+engineer)\b/i,
  /\b(deployment|implementation|application\s+support|noc)\b/i,
  /\b(junior|entry[\s-]level|associate|intern)\s+(?:developer|engineer|analyst|specialist)\b/i,
];

export type Level = "entry" | "junior" | "mid" | "senior" | "unknown";

export const SENIOR_PATTERNS = /\b(senior|sr\.?|sr\b|staff|principal|lead|head\s+of|director|vp|vice\s+president|chief|architect|manager|expert|tier\s?(iii|3)|level\s?3|l3)\b/i;
export const ENTRY_PATTERNS  = /\b(intern(?:ship)?|trainee|apprentice|graduate|junior|jr\.?|entry[- ]level|associate|tier\s?(i|1)\b|level\s?1|l1|help\s?desk|service\s?desk|desktop\s+support|ict\s+officer)\b/i;

export const OFF_FAMILY_REGEX = /\b(sales|account\s+(?:exec|executive|manager)|sdr|bdr|marketing|recruiter|recruitment|customer\s+success|nurse|pharma|oncology|doctor|veterin|attorney|lawyer|legal|accountant|auditor|payroll|real\s+estate|property\s+manager|horeca|kundenservice|telefondienst|school\s+teacher|category\s+buyer|merchandiser|logistics\s+coordinator|receptionist|finance\s+consultant|safety\s+officer|health\s+and\s+safety|front\s+office|concierge)\b/i;
export const REGION_BLOCK_REGEX = /\b(us\s+only|usa\s+only|united\s+states\s+only|must\s+(?:be\s+)?(?:located|based)\s+in\s+(?:the\s+)?(?:us|uk|eu|europe|germany|canada|mexico|united\s+states)|eu\s+only|europe\s+only|(?:us|eu|uk)[ -]based)\b/i;
export const FOREIGN_STACK_REGEX = /\b(ruby\s+on\s+rails|rails|dotnet|\.net|c#|golang|rust|scala|kotlin|swift|salesforce|sap|laravel|elixir)\b/i;
export const SCAM_FLAG_REGEX = /\b(registration\s+fee|application\s+fee|pay\s+to\s+apply|send\s+money|training\s+fee|telegram\s+only|whatsapp\s+only|submit\s+cvs\s*-\s*new\s+recruitment)\b/i;

export function minYearsRequired(desc: string): number | null {
  return extractContextualYears(desc);
}

export function classifyLevel(title: string, desc: string): Level {
  if (ENTRY_PATTERNS.test(title)) return "entry";
  if (SENIOR_PATTERNS.test(title)) return "senior";
  const yrs = minYearsRequired(desc);
  if (yrs !== null) return yrs <= 2 ? "junior" : yrs <= 4 ? "mid" : "senior";
  if (/\b(10|8|7|6|5)\+?\s*years/i.test(desc)) return "senior";
  return "unknown";
}

export function normalizeSkill(s: string): string {
  const clean = s.toLowerCase().trim().replace(/[-_]/g, " ");
  return COMPREHENSIVE_SKILL_SYNONYMS[clean] || COMPREHENSIVE_SKILL_SYNONYMS[clean.replace(/\s+/g, "")] || clean;
}

export interface GateResult {
  pass: boolean;
  reason?: string;
}

/**
 * Deterministic Hard Filters (Gates) that run before scoring
 */
export function passesGates(job: NormalizedJob | JobRecord, profile: any): GateResult {
  const title = job.title.trim();
  const desc = job.description || "";
  const loc = (job.location || "").toLowerCase();

  // 0. Security / Scam Gate
  if (SCAM_FLAG_REGEX.test(`${title} ${desc}`)) {
    return { pass: false, reason: "Security: Flagged as suspicious / fee / telegram" };
  }

  // 1. Role Allowlist (Must match tech/developer/IT support role family)
  const matchesRoleAllowlist = ROLE_ALLOW_PATTERNS.some((pattern) => pattern.test(title));
  if (!matchesRoleAllowlist) {
    return { pass: false, reason: "Role: Title not in allowed tech/developer/IT support families" };
  }

  // 2. Off-Family Blacklist
  if (OFF_FAMILY_REGEX.test(title)) {
    return { pass: false, reason: "Role: Off-family non-tech domain" };
  }

  // 3. Foreign Stack Check (Rails, .NET, C#, Golang, Rust, Salesforce if not in candidate stack)
  if (FOREIGN_STACK_REGEX.test(title)) {
    const candidateTech = `${(profile?.technologies || []).join(" ")} ${(profile?.skills || []).join(" ")}`.toLowerCase();
    if (!FOREIGN_STACK_REGEX.test(candidateTech)) {
      return { pass: false, reason: "Stack: Primary role stack not in candidate skillset" };
    }
  }

  // 4. Level Classification & Hard Seniority Gate
  const level = classifyLevel(title, desc);
  if (level === "senior" || level === "mid") {
    return { pass: false, reason: `Level: Job is classified as ${level} (candidate is entry/junior)` };
  }

  // 5. Years Required Gate
  const yrs = minYearsRequired(desc);
  if (yrs !== null && yrs > 2) {
    return { pass: false, reason: `Experience: Asks for ${yrs}+ years (candidate max 2 yrs)` };
  }

  // 6. Region Gate
  const fullText = `${loc} ${desc}`.toLowerCase();
  const isBlockedRegion = REGION_BLOCK_REGEX.test(fullText);
  const isLocalKenya = loc.includes("kenya") || loc.includes("nairobi") || loc.includes("mombasa") || job.source.toLowerCase().includes("kenya");

  if (isBlockedRegion && !isLocalKenya && !loc.includes("worldwide") && !loc.includes("anywhere") && !loc.includes("africa")) {
    return { pass: false, reason: "Region: Restricted to US/EU/UK residents" };
  }

  return { pass: true };
}

export type Decision = "match" | "review" | "reject";

export interface JobDecision {
  decision: Decision;
  score: number;
  reason: string | null;
  level: Level;
  matchedSkills: string[];
  missingSkills: string[];
}

export function decideJobMatch(
  job: NormalizedJob | JobRecord,
  profile: any,
): JobDecision {
  const descText = job.description || "";
  const level = classifyLevel(job.title, descText);

  if (!profile) {
    return {
      decision: "review",
      score: 50,
      reason: null,
      level,
      matchedSkills: [],
      missingSkills: [],
    };
  }

  const gate = passesGates(job, profile);
  if (!gate.pass) {
    return {
      decision: "reject",
      score: 0,
      reason: gate.reason || "Failed hard gate",
      level,
      matchedSkills: [],
      missingSkills: [],
    };
  }

  const jobTitleLower = job.title.toLowerCase();
  const sections = splitJobSections(descText);
  const requirementsText = sections.requirements || descText;

  const candidateSkills = new Set<string>();
  for (const s of (profile.skills || [])) candidateSkills.add(normalizeSkill(s));
  for (const t of (profile.technologies || [])) candidateSkills.add(normalizeSkill(t));

  // Extract skills strictly from the requirements section to avoid perks/about-us pollution
  const requiredSkillsInJob = extractSkillsFromText(requirementsText);
  const tagSkills = ((job as any).skills || []).map((s: unknown) => normalizeSkill(String(s)));
  for (const tag of tagSkills) if (tag) requiredSkillsInJob.push(tag);

  const uniqueRequired = Array.from(new Set(requiredSkillsInJob));
  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];

  for (const req of uniqueRequired) {
    if (candidateSkills.has(req)) {
      matchedSkills.push(req);
    } else {
      missingSkills.push(req);
    }
  }

  // If fewer than 2 requirements could be isolated, skillFit is unknown (null)
  const skillFit: number | null = uniqueRequired.length >= 2 ? matchedSkills.length / uniqueRequired.length : null;

  // Role Family Fit
  let roleFit = 0.6;
  const targetRoles: string[] = profile.targetRoles || [];
  for (const target of targetRoles) {
    const t = target.toLowerCase().trim();
    if (!t) continue;
    if (jobTitleLower.includes(t)) {
      roleFit = 1.0;
      break;
    }
    const words = t.split(/[\s/,-]+/).filter((w) => w.length > 2);
    if (words.length > 0 && words.every((w) => jobTitleLower.includes(w))) {
      roleFit = 0.95;
      break;
    } else if (words.some((w) => jobTitleLower.includes(w))) {
      roleFit = Math.max(roleFit, 0.8);
    }
  }

  // Region Fit (Priority for Kenya, followed by Worldwide Remote)
  const loc = (job.location || "").toLowerCase();
  const isKenya = loc.includes("kenya") || loc.includes("nairobi") || loc.includes("mombasa") || job.source.toLowerCase().includes("kenya");
  let regionFit = 0.8;
  if (isKenya) {
    regionFit = 1.0;
  } else if (job.remote || loc.includes("worldwide") || loc.includes("anywhere") || loc.includes("africa") || loc.includes("emea")) {
    regionFit = 0.95;
  }

  // Base score formula: 45% skill fit + 30% role fit + 25% region fit
  let score = 100 * (0.45 * (skillFit ?? 0.35) + 0.30 * roleFit + 0.25 * regionFit);

  // Honest handling of unknowns
  if (skillFit === null) score = Math.min(score, 65); // can't verify skills -> never auto-matched!
  if (level === "unknown") score = Math.min(score, 70);
  if (regionFit < 0.9) score = Math.min(score, 68);

  const finalScore = Math.max(10, Math.min(Math.round(score), 100));
  const decision: Decision =
    finalScore >= 75 && skillFit !== null && skillFit >= 0.5
      ? "match"
      : finalScore >= 55
      ? "review"
      : "reject";

  return {
    decision,
    score: finalScore,
    reason: null,
    level,
    matchedSkills,
    missingSkills,
  };
}

export function calculateMatchScore(job: NormalizedJob | JobRecord, profile: any): number {
  const res = decideJobMatch(job, profile);
  return res.score;
}

export async function saveDiscoveredJobs(
  jobs: NormalizedJob[],
  directive?: SearchDirective,
): Promise<{
  saved: number;
  duplicates: number;
  updates: number;
  rejectedByGate: number;
}> {
  const activeDirective = directive || (await getOrGenerateSearchDirective());
  let saved = 0;
  let duplicates = 0;
  let updates = 0;
  let rejectedByGate = 0;

  for (const job of jobs) {
    const fingerprint = fingerprintJob({
      company: job.company,
      title: job.title,
      location: job.location || "",
      description: job.description,
    });

    const [existingByFingerprint] = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(eq(jobsTable.fingerprint, fingerprint))
      .limit(1);

    if (existingByFingerprint) {
      duplicates++;
      // Record provenance for cross-source deduplication tracking
      await db.insert(jobProvenanceTable).values({
        id: crypto.randomUUID(),
        jobId: existingByFingerprint.id,
        sourceId: job.source,
        sourceName: job.source,
        originalUrl: job.sourceUrl || "",
        discoveredAt: new Date(),
        isPrimary: false,
      }).catch(() => {});
      continue;
    }

    if (job.externalJobId) {
      const [existingByExternalId] = await db
        .select({ id: jobsTable.id })
        .from(jobsTable)
        .where(
          and(
            eq(jobsTable.source, job.source),
            eq(jobsTable.externalJobId, job.externalJobId),
          ),
        )
        .limit(1);

      if (existingByExternalId) {
        duplicates++;
        // Record provenance for cross-source deduplication tracking
        await db.insert(jobProvenanceTable).values({
          id: crypto.randomUUID(),
          jobId: existingByExternalId.id,
          sourceId: job.source,
          sourceName: job.source,
          originalUrl: job.sourceUrl || "",
          discoveredAt: new Date(),
          isPrimary: false,
        }).catch(() => {});
        continue;
      }
    }

    const gate = evaluatePreIngestionGate(job, activeDirective);
    const isQualified = gate.qualified;

    const now = new Date();
    try {
      let finalDescription = job.description;
      if (!finalDescription.includes("📋 APPLICATION DETAILS")) {
        const appDetails = extractApplicationDetails(job.description, job.sourceUrl, job.title, job.company);
        const banner = formatApplicationBanner(appDetails, job.title, job.company);
        finalDescription = `${banner}\n${job.description}`;
      }

      const newJobId = crypto.randomUUID();
      await db.insert(jobsTable).values({
        id: newJobId,
        title: job.title,
        company: job.company,
        location: job.location,
        remote: Boolean(job.remote),
        salary: job.salary,
        source: job.source,
        sourceUrl: job.sourceUrl,
        externalJobId: job.externalJobId,
        description: finalDescription,
        fingerprint,
        matchScore: isQualified ? null : 0,
        status: isQualified ? ("DISCOVERED" as const) : ("REJECTED" as const),
        rejectionReason: isQualified ? null : (gate.rejectionReason || "Disqualified by pre-ingestion gate"),
        matchReason: null,
        discoveredAt: job.discoveredAt || now,
        normalizedCompany: job.normalizedCompany,
        normalizedTitle: job.normalizedTitle,
        normalizedLocation: job.normalizedLocation,
      });

      // Record primary provenance record
      await db.insert(jobProvenanceTable).values({
        id: crypto.randomUUID(),
        jobId: newJobId,
        sourceId: job.source,
        sourceName: job.source,
        originalUrl: job.sourceUrl || "",
        discoveredAt: job.discoveredAt || now,
        isPrimary: true,
      }).catch(() => {});

      if (isQualified) {
        saved++;
      } else {
        rejectedByGate++;
      }
    } catch {
      duplicates++;
    }
  }

  return { saved, duplicates, updates, rejectedByGate };
}

export async function matchJobsWithProfile(jobs: JobRecord[]): Promise<JobRecord[]> {
  const [profile] = await db
    .select()
    .from(candidateProfilesTable)
    .where(eq(candidateProfilesTable.id, "primary"))
    .limit(1);

  // Identify all jobs that have submitted applications
  const submittedApps = await db
    .select({ jobId: applicationsTable.jobId })
    .from(applicationsTable)
    .where(inArray(applicationsTable.status, ["SUBMITTED", "EMAIL_SENT", "AWAITING_RESPONSE", "RECRUITER_RESPONSE", "INTERVIEW", "ASSESSMENT", "OFFER"]));
  const appliedJobIds = new Set(submittedApps.map((a) => a.jobId));

  return jobs.map((job) => {
    const decisionResult = decideJobMatch(job, profile);

    let status: "MATCHED" | "NEEDS_REVIEW" | "REJECTED" | "DISCOVERED" | "APPLIED" | "SHORTLISTED" = job.status as any;
    if (job.status === "APPLIED" || appliedJobIds.has(job.id)) {
      status = "APPLIED";
    } else if (job.status === "SHORTLISTED") {
      status = "SHORTLISTED";
    } else if (decisionResult.decision === "match") {
      status = "MATCHED";
    } else if (decisionResult.decision === "review") {
      status = "NEEDS_REVIEW";
    } else {
      status = "REJECTED";
    }

    return {
      ...job,
      matchScore: decisionResult.score,
      status: status as any,
    };
  });
}

/**
 * Main job search and discovery function
 * Cleans out old mock leftovers, discovers live jobs, and applies strict hard gates
 */
export async function discoverAndMatchJobs(minMatchScoreThreshold = 75): Promise<{
  discovered: number;
  duplicates: number;
  rejectedByGate: number;
  matched: number;
  highMatches: JobRecord[];
  sourceStats: Map<string, { total: number; matched: number }>;
  directive: SearchDirective;
}> {
  // Purge any legacy mock jobs
  await db.delete(jobsTable).where(like(jobsTable.id, "mock-%"));

  // 1. Get search directive
  let directive: SearchDirective;
  try {
    directive = await getOrGenerateSearchDirective();
  } catch {
    directive = {
      source: "deterministic_fallback",
      targetRoleFamilies: ["Software Development", "IT Support"],
      searchQueries: ["Software Developer", "IT Support Specialist"],
      alternativeJobTitles: ["Full Stack Developer", "Backend Developer", "Frontend Developer"],
      requiredSkills: [],
      preferredSkills: [],
      suitableExperienceLevels: ["Entry Level", "Junior", "0-2 years"],
      maxExperienceYears: 2,
      seniorityExclusions: ["senior", "lead", "principal", "manager"],
      locationRestrictions: {
        allowedCities: ["Nairobi"],
        allowedCountries: ["Kenya"],
        allowWorldwideRemote: true,
        blockedRegions: [],
      },
      workAuthorizationNotes: null,
      disqualificationRules: [],
      requiredQualifications: [],
      niceToHaveQualifications: [],
      cvFreshness: "current",
      generatedAt: new Date().toISOString(),
    } as unknown as SearchDirective;
  }

  // 2. Delegate to comprehensive CV-guided discovery pipeline
  const { discoverJobsWithCvGuidance } = await import("./enhanced-job-search-service");
  const discoveryResult = await discoverJobsWithCvGuidance({
    accountId: "default",
    verifyRequirements: true,
    maxJobs: 50,
  });

  // 3. Query high matches from database
  const highMatches = await db
    .select()
    .from(jobsTable)
    .where(
      and(
        ne(jobsTable.status, "REJECTED"),
        gte(jobsTable.matchScore, minMatchScoreThreshold),
      ),
    )
    .orderBy(desc(jobsTable.matchScore))
    .limit(50);

  // 4. Source stats mapping
  const sourceStats = new Map<string, { total: number; matched: number }>();
  for (const s of discoveryResult.sourcesScraped || []) {
    sourceStats.set(s, {
      total: Math.max(1, Math.round(discoveryResult.discovered / (discoveryResult.sourcesScraped.length || 1))),
      matched: Math.round(discoveryResult.matched / (discoveryResult.sourcesScraped.length || 1)),
    });
  }

  return {
    discovered: discoveryResult.discovered,
    duplicates: discoveryResult.duplicates,
    rejectedByGate: discoveryResult.rejected,
    matched: highMatches.length,
    highMatches,
    sourceStats,
    directive,
  };
}
