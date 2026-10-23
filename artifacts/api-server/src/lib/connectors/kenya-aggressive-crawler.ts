/**
 * Kenya Aggressive Job Crawler
 *
 * Verified endpoints for 50+ Kenyan job sources across ALL career fields:
 * tech, healthcare, finance, ngo, government, education, legal,
 * engineering, agriculture, hospitality, media, logistics, insurance
 *
 * Features:
 * - Multi-page scraping with pagination (query-param and path-based)
 * - Concurrent HTTP requests (configurable concurrency)
 * - Source-specific extractors (BrighterMonday, MyJobMag, Corporate Staffing)
 * - RSS/Atom/XML feed parsing
 * - JSON API support (ReliefWeb)
 * - Career-field filtering for multi-tenant use
 * - CV-guided discovery via crawlJobsByKeywords()
 */

import { secureFetch } from "./http-client";
import { parsePdfVacancyNotice } from "./pdf-vacancy-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrawledJob {
  id: string;
  title: string;
  company: string;
  location: string;
  county: string | null;
  country: string;
  url: string;
  sourceUrl: string;
  applicationUrl: string;
  description: string;
  postedDate: Date;
  jobType: string;
  remote: boolean;
  salary: string | null;
  skills: string[];
  sourceId: string;
  sourceName: string;
  externalJobId?: string;
}

export interface CrawlConfig {
  maxJobs?: number;
  perRequestTimeout?: number;
  concurrency?: number;
  fields?: CareerField[];
  multiPage?: boolean;
  maxPages?: number;
  sourceIds?: string[];
}

export type CareerField =
  | "tech" | "healthcare" | "finance" | "ngo" | "government"
  | "education" | "legal" | "engineering" | "agriculture"
  | "hospitality" | "media" | "logistics" | "insurance" | "all";

export interface SourceSpec {
  id: string;
  name: string;
  country: string;
  fields: CareerField[];
  feeds?: string[];
  htmlPages?: string[];
  jsonEndpoints?: string[];
  jobUrlPattern?: RegExp;
  defaultLocation?: string;
  pagination?: {
    type: "query" | "path";
    param?: string;
    pathTemplate?: string;
    startPage?: number;
    maxPages?: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function b64id(url: string): string {
  return Buffer.from(url).toString("base64").replace(/[+/=]/g, "").slice(0, 22);
}

function isGarbage(text: string): boolean {
  if (!text || text.length < 4 || text.length > 180) return true;
  const t = text.trim();
  if (/^(?:apply|apply now|apply here|download|view|view details|click here|read more|details|vacancies|careers|career opportunities|open vacancies|jobs)$/i.test(t)) return true;
  return /privacy|terms|cookie|login|sign in|register|read more|view more|all rights reserved|click here|home|about us|contact us|apply now|post a job|create job|employer|job alert|subscribe|newsletter|no jobs found|calculate\s+tax|get\s+the\s+right\s+figure|tax\s+calculator|filing\s+returns|press\s+release|annual\s+report|strategic\s+plan|disclaimer|faqs?\b/i.test(t);
}

function isIndexUrl(u: string): boolean {
  if (!u) return true;
  return /\/(?:jobs|vacancies|careers|all-jobs|search|browse|category|categories|field|location|industry|login|signup|register|sitemap|feeds?|tag|tags)\/?$/i.test(u);
}

function splitAtAt(raw: string): { title: string; company: string } {
  if (raw.includes(" at ")) {
    const parts = raw.split(" at ");
    return { title: parts[0].trim(), company: parts.slice(1).join(" at ").trim() };
  }
  if (raw.includes(" @ ")) {
    const parts = raw.split(" @ ");
    return { title: parts[0].trim(), company: parts.slice(1).join(" @ ").trim() };
  }
  const sep = raw.includes(" \u2013 ") ? " \u2013 " : raw.includes(" - ") ? " - " : null;
  if (sep) {
    const parts = raw.split(sep);
    if (parts.length === 2 && parts[1].length < 60) return { title: parts[0].trim(), company: parts[1].trim() };
  }
  // Pattern: "Job Title Job Company Name" e.g. "Residential Medical Officer Job Jordan Hospital"
  const jobMatch = raw.match(/^(.*?)\s+Job\s+(.*)$/i);
  if (jobMatch && jobMatch[1].length >= 4 && jobMatch[2].length >= 3) {
    return { title: jobMatch[1].trim(), company: jobMatch[2].trim() };
  }
  return { title: raw, company: "" };
}

function parseXmlFeed(xml: string): Array<{ title: string; link: string; description: string; pubDate: string }> {
  const items: Array<{ title: string; link: string; description: string; pubDate: string }> = [];
  const rssMatches = xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi);
  for (const m of rssMatches) {
    const x = m[1];
    const getField = (tag: string) => {
      const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, "i");
      const match = x.match(re);
      return (match ? (match[1] ?? match[2]) : "").trim();
    };
    const title = cleanHtml(getField("title"));
    const link = getField("link");
    const desc = cleanHtml(getField("description") || getField("content:encoded"));
    const pubDate = getField("pubDate");
    if (title && link) items.push({ title, link, description: desc, pubDate });
  }
  if (items.length === 0) {
    const atomMatches = xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi);
    for (const m of atomMatches) {
      const x = m[1];
      const title = cleanHtml((x.match(/<title[\s>](?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/i)?.[1] ?? ""));
      const link = (x.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] ?? "").trim();
      const desc = cleanHtml((x.match(/<(?:summary|content)[\s>](?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/(?:summary|content)>/i)?.[1] ?? ""));
      const pubDate = (x.match(/<(?:updated|published)>([\s\S]*?)<\/(?:updated|published)>/i)?.[1] ?? "").trim();
      if (title) items.push({ title, link, description: desc, pubDate });
    }
  }
  return items;
}

function buildJob(spec: SourceSpec, rawTitle: string, url: string, description = "", pubDate = ""): CrawledJob {
  const { title, company } = splitAtAt(rawTitle);
  const loc = spec.defaultLocation || "Kenya";
  const county = /nairobi/i.test(loc) ? "Nairobi" : /mombasa/i.test(loc) ? "Mombasa" : /kisumu/i.test(loc) ? "Kisumu" : /eldoret/i.test(loc) ? "Uasin Gishu" : null;
  return {
    id: `${spec.id}-${b64id(url)}`,
    title, company: company || spec.name,
    location: loc, county, country: spec.country || "Kenya",
    url, sourceUrl: url, applicationUrl: url,
    description: description.slice(0, 3000),
    postedDate: pubDate && !isNaN(new Date(pubDate).getTime()) ? new Date(pubDate) : new Date(),
    jobType: "Full-time",
    remote: /remote|work from home|wfh/i.test(`${rawTitle} ${description}`),
    salary: null, skills: [],
    sourceId: spec.id, sourceName: spec.name, externalJobId: url,
  };
}

// ---------------------------------------------------------------------------
// Source catalog (verified endpoints, Oct 2026)
// ---------------------------------------------------------------------------

const KENYAN_BOARDS: SourceSpec[] = [
  {
    id: "brightermonday", name: "BrighterMonday Kenya", country: "Kenya", fields: ["all"],
    htmlPages: [
      "https://www.brightermonday.co.ke/jobs",
      "https://www.brightermonday.co.ke/jobs/software-data",
      "https://www.brightermonday.co.ke/jobs/medical-pharmaceutical",
      "https://www.brightermonday.co.ke/jobs/finance-accounting",
      "https://www.brightermonday.co.ke/jobs/sales-marketing",
      "https://www.brightermonday.co.ke/jobs/legal",
      "https://www.brightermonday.co.ke/jobs/engineering-technical",
      "https://www.brightermonday.co.ke/jobs/ngo-social-services",
      "https://www.brightermonday.co.ke/jobs/education",
      "https://www.brightermonday.co.ke/jobs/logistics-procurement",
      "https://www.brightermonday.co.ke/jobs/banking-financial-services",
      "https://www.brightermonday.co.ke/jobs/hospitality-hotel",
      "https://www.brightermonday.co.ke/jobs/agriculture-environment",
      "https://www.brightermonday.co.ke/jobs/insurance",
      "https://www.brightermonday.co.ke/jobs/media-creative",
      "https://www.brightermonday.co.ke/jobs/human-resource",
    ],
    jobUrlPattern: /brightermonday\.co\.ke\/listings\/[a-zA-Z0-9_-]+$/,
    defaultLocation: "Nairobi, Kenya",
    pagination: { type: "query", param: "page", startPage: 2, maxPages: 6 },
  },
  {
    id: "myjobmag", name: "MyJobMag Kenya", country: "Kenya", fields: ["all"],
    feeds: ["https://www.myjobmag.co.ke/jobsxml.xml"],
    htmlPages: [
      "https://www.myjobmag.co.ke/jobs",
      "https://www.myjobmag.co.ke/jobs-by-field/information-technology",
      "https://www.myjobmag.co.ke/jobs-by-field/medical-health",
      "https://www.myjobmag.co.ke/jobs-by-field/medical-health/page/2",
      "https://www.myjobmag.co.ke/jobs-by-field/medical-health/page/3",
      "https://www.myjobmag.co.ke/jobs-by-field/medical-health/page/4",
      "https://www.myjobmag.co.ke/jobs-by-field/accounting-finance",
      "https://www.myjobmag.co.ke/jobs-by-field/sales-marketing",
      "https://www.myjobmag.co.ke/jobs-by-field/engineering",
      "https://www.myjobmag.co.ke/jobs-by-field/legal",
      "https://www.myjobmag.co.ke/jobs-by-field/education-training",
      "https://www.myjobmag.co.ke/jobs-by-field/banking-finance",
      "https://www.myjobmag.co.ke/jobs-by-field/ngo-charity",
      "https://www.myjobmag.co.ke/jobs-by-field/human-resources",
      "https://www.myjobmag.co.ke/jobs-by-field/logistics-supply-chain",
    ],
    jobUrlPattern: /myjobmag\.co\.ke\/job\/[a-zA-Z0-9_-]+$/,
    defaultLocation: "Nairobi, Kenya",
    pagination: { type: "path", pathTemplate: "/jobs/page/{page}", startPage: 2, maxPages: 6 },
  },
  {
    id: "jobwebkenya", name: "JobWeb Kenya", country: "Kenya", fields: ["all"],
    feeds: [
      "https://jobwebkenya.com/feed/",
      "https://jobwebkenya.com/feed/?paged=2",
      "https://jobwebkenya.com/feed/?paged=3",
      "https://jobwebkenya.com/feed/?paged=4",
      "https://jobwebkenya.com/feed/?paged=5",
      "https://jobwebkenya.com/feed/?paged=6",
      "https://jobwebkenya.com/feed/?paged=7",
      "https://jobwebkenya.com/category/medical-jobs-in-kenya/feed/",
      "https://jobwebkenya.com/category/pharmaceutical-jobs-in-kenya/feed/",
      "https://jobwebkenya.com/category/nursing-jobs-in-kenya/feed/",
      "https://jobwebkenya.com/category/healthcare-jobs-in-kenya/feed/",
      "https://jobwebkenya.com/feed/?post_type=job_listing",
    ],
    jobUrlPattern: /jobwebkenya\.com\/jobs\/[a-zA-Z0-9_-]+/,
    defaultLocation: "Kenya",
  },
  {
    id: "careerpoint-kenya", name: "Career Point Kenya", country: "Kenya", fields: ["all"],
    feeds: [
      "https://www.careerpointkenya.co.ke/feed/",
      "https://www.careerpointkenya.co.ke/feed/?paged=2",
      "https://www.careerpointkenya.co.ke/feed/?paged=3",
      "https://www.careerpointkenya.co.ke/feed/?paged=4",
      "https://www.careerpointkenya.co.ke/category/it-jobs-in-kenya/feed/",
      "https://www.careerpointkenya.co.ke/category/medical-jobs-in-kenya/feed/",
      "https://www.careerpointkenya.co.ke/category/medical-jobs-in-kenya/feed/?paged=2",
      "https://www.careerpointkenya.co.ke/category/medical-jobs-in-kenya/feed/?paged=3",
      "https://www.careerpointkenya.co.ke/category/accounting-jobs-in-kenya/feed/",
      "https://www.careerpointkenya.co.ke/category/finance-jobs-in-kenya/feed/",
      "https://www.careerpointkenya.co.ke/category/procurement-jobs-in-kenya/feed/",
      "https://www.careerpointkenya.co.ke/category/banking-jobs-in-kenya/feed/",
      "https://www.careerpointkenya.co.ke/category/engineering-jobs-in-kenya/feed/",
      "https://www.careerpointkenya.co.ke/category/ngo-jobs-in-kenya/feed/",
    ],
    defaultLocation: "Kenya",
  },
  {
    id: "corporate-staffing", name: "Corporate Staffing Services Kenya", country: "Kenya", fields: ["all"],
    htmlPages: [
      "https://www.corporatestaffing.co.ke/jobs/",
      "https://www.corporatestaffing.co.ke/tag/it-jobs-in-kenya/",
      "https://www.corporatestaffing.co.ke/tag/medical-officer-jobs-in-kenya/",
      "https://www.corporatestaffing.co.ke/tag/healthcare-jobs-in-kenya/",
      "https://www.corporatestaffing.co.ke/tag/accounting-jobs-in-kenya/",
      "https://www.corporatestaffing.co.ke/tag/engineering-jobs-in-kenya/",
      "https://www.corporatestaffing.co.ke/tag/ngo-jobs-in-kenya/",
      "https://www.corporatestaffing.co.ke/tag/banking-jobs-in-kenya/",
      "https://www.corporatestaffing.co.ke/tag/finance-jobs-in-kenya/",
      "https://www.corporatestaffing.co.ke/tag/legal-jobs-in-kenya/",
      "https://www.corporatestaffing.co.ke/tag/human-resource-jobs-in-kenya/",
      "https://www.corporatestaffing.co.ke/tag/sales-jobs-in-kenya/",
    ],
    jobUrlPattern: /corporatestaffing\.co\.ke\/(?:job|vacancy)\/[a-zA-Z0-9_-]+/,
    defaultLocation: "Kenya",
    pagination: { type: "path", pathTemplate: "/jobs/page/{page}", startPage: 2, maxPages: 6 },
  },

  {
    id: "jobs-in-kenya", name: "Jobs in Kenya", country: "Kenya", fields: ["all"],
    htmlPages: [
      "https://www.jobsinkenya.co.ke/jobs/",
      "https://www.jobsinkenya.co.ke/jobs/?industry=technology",
      "https://www.jobsinkenya.co.ke/jobs/?industry=healthcare",
      "https://www.jobsinkenya.co.ke/jobs/?industry=finance",
    ],
    defaultLocation: "Kenya",
    pagination: { type: "query", param: "page", startPage: 2, maxPages: 3 },
  },
  {
    id: "kenyajob", name: "Kenya Job", country: "Kenya", fields: ["all"],
    htmlPages: [
      "https://www.kenyajob.com/job-vacancies-search-kenya",
      "https://www.kenyajob.com/job-vacancies-search-kenya?motcle=IT",
      "https://www.kenyajob.com/job-vacancies-search-kenya?motcle=medical",
      "https://www.kenyajob.com/job-vacancies-search-kenya?motcle=finance",
      "https://www.kenyajob.com/job-vacancies-search-kenya?motcle=engineering",
      "https://www.kenyajob.com/job-vacancies-search-kenya?motcle=NGO",
      "https://www.kenyajob.com/job-vacancies-search-kenya?motcle=banking",
    ],
    defaultLocation: "Kenya",
  },
  {
    id: "summit-recruitment", name: "Summit Recruitment & Search Kenya", country: "Kenya", fields: ["all"],
    feeds: ["https://www.summitrecruitment-search.com/feed/"],
    htmlPages: ["https://www.summitrecruitment-search.com/all-jobs/"],
    jobUrlPattern: /summitrecruitment-search\.com\/job\//,
    defaultLocation: "Nairobi, Kenya",
  },
  {
    id: "gap-recruitment", name: "Gap Recruitment Services Kenya", country: "Kenya", fields: ["all"],
    feeds: ["https://www.gap.co.ke/feed/"],
    htmlPages: ["https://www.gap.co.ke/jobs/"],
    jobUrlPattern: /gap\.co\.ke\/job\//,
    defaultLocation: "Nairobi, Kenya",
  },
];

const GOVERNMENT_SOURCES: SourceSpec[] = [
  { id: "psck-jobs", name: "Public Service Commission Jobs Portal", country: "Kenya", fields: ["government"], htmlPages: ["https://psckjobs.go.ke/ActiveJobsAdverts.aspx"], defaultLocation: "Nairobi, Kenya" },
  { id: "psc-vacancies", name: "Public Service Commission Vacancies", country: "Kenya", fields: ["government"], htmlPages: ["https://www.publicservice.go.ke/index.php/vacancies"], defaultLocation: "Nairobi, Kenya" },
  { id: "tsc-careers", name: "Teachers Service Commission", country: "Kenya", fields: ["education", "government"], htmlPages: ["https://www.tsc.go.ke/index.php/careers", "https://www.tsc.go.ke/index.php/vacancies"], defaultLocation: "Nairobi, Kenya" },
  { id: "nea-kenya", name: "National Employment Authority", country: "Kenya", fields: ["government", "all"], htmlPages: ["https://neamis.go.ke/jobs", "https://neamis.go.ke/vacancies"], defaultLocation: "Kenya" },
  { id: "kra-careers", name: "Kenya Revenue Authority Careers", country: "Kenya", fields: ["finance", "government"], htmlPages: ["https://www.kra.go.ke/careers", "https://www.kra.go.ke/index.php/help-centre/careers/employment-opportunities"], defaultLocation: "Nairobi, Kenya" },
  { id: "kplc-careers", name: "Kenya Power & Lighting Company", country: "Kenya", fields: ["engineering", "government"], htmlPages: ["https://www.kplc.co.ke/careers", "https://www.kplc.co.ke/content/item/1059/career-opportunities"], defaultLocation: "Nairobi, Kenya" },
  { id: "knec-vacancies", name: "Kenya National Examinations Council", country: "Kenya", fields: ["education", "government"], htmlPages: ["https://www.knec.ac.ke/vacancies/"], defaultLocation: "Nairobi, Kenya" },
  { id: "icta-careers", name: "ICT Authority Kenya Careers", country: "Kenya", fields: ["tech", "government"], htmlPages: ["https://icta.go.ke/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "nssf-careers", name: "NSSF Kenya Careers", country: "Kenya", fields: ["finance", "government"], htmlPages: ["https://www.nssf.or.ke/vacancies/", "https://www.nssf.or.ke/career-opportunities/"], defaultLocation: "Nairobi, Kenya" },
  { id: "nhif-careers", name: "NHIF Kenya Careers", country: "Kenya", fields: ["healthcare", "government"], htmlPages: ["https://www.nhif.or.ke/vacancies"], defaultLocation: "Nairobi, Kenya" },
  { id: "knh-vacancies", name: "Kenyatta National Hospital (KNH)", country: "Kenya", fields: ["healthcare", "government"], htmlPages: ["https://knh.or.ke/index.php/vacancies/"], defaultLocation: "Nairobi, Kenya" },
  { id: "mtrh-careers", name: "Moi Teaching & Referral Hospital", country: "Kenya", fields: ["healthcare", "government"], htmlPages: ["https://www.mtrh.go.ke/vacancies/"], defaultLocation: "Eldoret, Kenya" },
];

const NGO_SOURCES: SourceSpec[] = [
  { id: "devex-jobs-kenya", name: "Devex Kenya Jobs", country: "Kenya", fields: ["ngo", "finance"], feeds: ["https://www.devex.com/jobs/feed.rss?country_id=105"], defaultLocation: "Kenya" },
  { id: "red-cross-kenya", name: "Kenya Red Cross Society", country: "Kenya", fields: ["ngo", "healthcare"], htmlPages: ["https://www.redcross.or.ke/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "amref-careers", name: "Amref Health Africa Careers", country: "Kenya", fields: ["healthcare", "ngo"], htmlPages: ["https://amref.org/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "wvi-kenya", name: "World Vision International Kenya", country: "Kenya", fields: ["ngo"], htmlPages: ["https://www.wvi.org/jobs?country=Kenya"], defaultLocation: "Kenya" },
  { id: "psi-kenya", name: "PSI Kenya Careers", country: "Kenya", fields: ["healthcare", "ngo"], htmlPages: ["https://www.psi.org/careers/?location=Kenya"], defaultLocation: "Kenya" },
  { id: "ilri-careers", name: "ILRI Kenya Jobs", country: "Kenya", fields: ["agriculture", "ngo"], htmlPages: ["https://www.ilri.org/jobs"], defaultLocation: "Nairobi, Kenya" },
  { id: "world-agroforestry", name: "World Agroforestry (ICRAF) Kenya", country: "Kenya", fields: ["agriculture", "ngo"], htmlPages: ["https://www.worldagroforestry.org/jobs"], defaultLocation: "Nairobi, Kenya" },
];

const FINANCE_SOURCES: SourceSpec[] = [
  { id: "kcb-careers", name: "KCB Bank Group Careers", country: "Kenya", fields: ["finance"], htmlPages: ["https://kcbgroup.com/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "equity-bank-careers", name: "Equity Bank Kenya Careers", country: "Kenya", fields: ["finance"], htmlPages: ["https://equitybankgroup.com/careers/", "https://equitybankgroup.com/about-equity/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "co-op-bank-careers", name: "Co-operative Bank Kenya Careers", country: "Kenya", fields: ["finance"], htmlPages: ["https://www.co-opbank.co.ke/personal/general/about/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "cbk-careers", name: "Central Bank of Kenya Careers", country: "Kenya", fields: ["finance", "government"], htmlPages: ["https://www.centralbank.go.ke/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "ncba-careers", name: "NCBA Bank Kenya Careers", country: "Kenya", fields: ["finance"], htmlPages: ["https://ke.ncbagroup.com/about-us/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "safaricom-careers", name: "Safaricom / M-Pesa Careers", country: "Kenya", fields: ["tech", "finance"], htmlPages: ["https://www.safaricom.co.ke/about/careers", "https://safaricom.taleo.net/careersection/external/joblist.ftl"], defaultLocation: "Nairobi, Kenya" },
  { id: "jubilee-insurance", name: "Jubilee Insurance Kenya Careers", country: "Kenya", fields: ["insurance", "finance"], htmlPages: ["https://www.jubileeinsurance.com/ke/about-us/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "britam-careers", name: "Britam Kenya Careers", country: "Kenya", fields: ["insurance", "finance"], htmlPages: ["https://britam.com/ke/about-us/careers/"], defaultLocation: "Nairobi, Kenya" },
];

const HEALTHCARE_SOURCES: SourceSpec[] = [
  { id: "nairobi-hospital", name: "The Nairobi Hospital Careers", country: "Kenya", fields: ["healthcare"], htmlPages: ["https://thenairobihosp.org/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "aku-hospital", name: "Aga Khan University Hospital", country: "Kenya", fields: ["healthcare"], htmlPages: ["https://www.aku.edu/careers/pages/home.aspx"], defaultLocation: "Nairobi, Kenya" },
  { id: "knh-vacancies", name: "Kenyatta National Hospital (KNH)", country: "Kenya", fields: ["healthcare", "government"], htmlPages: ["https://knh.or.ke/index.php/vacancies/"], defaultLocation: "Nairobi, Kenya" },
  { id: "mtrh-careers", name: "Moi Teaching & Referral Hospital", country: "Kenya", fields: ["healthcare", "government"], htmlPages: ["https://www.mtrh.go.ke/vacancies/"], defaultLocation: "Eldoret, Kenya" },
  { id: "mpshah-hospital", name: "MP Shah Hospital Kenya", country: "Kenya", fields: ["healthcare"], htmlPages: ["https://mpshahhosp.org/careers/", "https://mpshahhosp.org/job-vacancies/"], defaultLocation: "Nairobi, Kenya" },
  { id: "avenue-healthcare", name: "Avenue Healthcare Kenya", country: "Kenya", fields: ["healthcare"], htmlPages: ["https://avenuehealthcare.com/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "karen-hospital", name: "The Karen Hospital", country: "Kenya", fields: ["healthcare"], htmlPages: ["https://karenhospital.org/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "kemri-careers", name: "Kenya Medical Research Institute (KEMRI)", country: "Kenya", fields: ["healthcare", "government"], htmlPages: ["https://www.kemri.go.ke/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "mater-hospital", name: "The Mater Hospital Kenya", country: "Kenya", fields: ["healthcare"], htmlPages: ["https://www.materkenya.com/careers"], defaultLocation: "Nairobi, Kenya" },
  { id: "gertrudes-hospital", name: "Gertrude's Children's Hospital", country: "Kenya", fields: ["healthcare"], htmlPages: ["https://gerties.org/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "coptic-hospital", name: "Coptic Hospital Kenya", country: "Kenya", fields: ["healthcare"], htmlPages: ["https://coptichospital.org/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "amref-careers", name: "Amref Health Africa", country: "Kenya", fields: ["healthcare", "ngo"], htmlPages: ["https://amref.org/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "red-cross-kenya", name: "Kenya Red Cross Society", country: "Kenya", fields: ["healthcare", "ngo"], htmlPages: ["https://www.redcross.or.ke/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "ciheb-kenya", name: "CIHEB Kenya Careers", country: "Kenya", fields: ["healthcare", "ngo"], htmlPages: ["https://cihebkenya.org/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "pathfinder-kenya", name: "Pathfinder International Kenya", country: "Kenya", fields: ["healthcare", "ngo"], htmlPages: ["https://www.pathfinder.org/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "msh-kenya", name: "MSH Kenya Careers", country: "Kenya", fields: ["healthcare", "ngo"], htmlPages: ["https://www.msh.org/careers?field_country_tid=KEN"], defaultLocation: "Kenya" },
  { id: "psi-kenya", name: "PSI Kenya Careers", country: "Kenya", fields: ["healthcare", "ngo"], htmlPages: ["https://www.psi.org/careers/?location=Kenya"], defaultLocation: "Kenya" },
  { id: "nhif-careers", name: "Social Health Authority (SHA / NHIF)", country: "Kenya", fields: ["healthcare", "government"], htmlPages: ["https://www.nhif.or.ke/vacancies"], defaultLocation: "Nairobi, Kenya" },
];

const GLOBAL_REMOTE_ACCEPTING_KENYA: SourceSpec[] = [
  {
    id: "remotive",
    name: "Remotive Remote",
    country: "Worldwide",
    fields: ["tech", "finance", "media"],
    jsonEndpoints: ["https://remotive.com/api/remote-jobs"],
    defaultLocation: "Worldwide Remote",
  },
  {
    id: "arbeitnow",
    name: "Arbeitnow Remote",
    country: "Worldwide",
    fields: ["tech", "finance"],
    jsonEndpoints: ["https://www.arbeitnow.com/api/job-board-api"],
    defaultLocation: "Worldwide Remote",
  },
  {
    id: "jobicy",
    name: "Jobicy Global Remote",
    country: "Worldwide",
    fields: ["tech", "finance", "media"],
    jsonEndpoints: ["https://jobicy.com/api/v2/remote-jobs?count=50"],
    defaultLocation: "Worldwide Remote",
  },
];

const TECH_SOURCES: SourceSpec[] = [
  ...GLOBAL_REMOTE_ACCEPTING_KENYA,
  { id: "andela-jobs", name: "Andela Remote Tech Jobs", country: "Global", fields: ["tech"], htmlPages: ["https://andela.com/talent/"], defaultLocation: "Remote" },
];

const EDUCATION_SOURCES: SourceSpec[] = [
  { id: "uon-jobs", name: "University of Nairobi Jobs", country: "Kenya", fields: ["education"], htmlPages: ["https://www.uonbi.ac.ke/recruitment", "https://www.uonbi.ac.ke/content/job-opportunities"], defaultLocation: "Nairobi, Kenya" },
  { id: "ku-jobs", name: "Kenyatta University Vacancies", country: "Kenya", fields: ["education"], htmlPages: ["https://www.ku.ac.ke/index.php/vacancies"], defaultLocation: "Nairobi, Kenya" },
  { id: "strathmore-jobs", name: "Strathmore University Vacancies", country: "Kenya", fields: ["education"], htmlPages: ["https://strathmore.edu/vacancies/"], defaultLocation: "Nairobi, Kenya" },
  { id: "jkuat-jobs", name: "JKUAT Vacancies", country: "Kenya", fields: ["education"], feeds: ["https://www.jkuat.ac.ke/category/vacancies/feed/"], htmlPages: ["https://www.jkuat.ac.ke/category/vacancies/"], defaultLocation: "Nairobi, Kenya" },
];

const MEDIA_LOGISTICS_SOURCES: SourceSpec[] = [
  { id: "nation-media-careers", name: "Nation Media Group Careers", country: "Kenya", fields: ["media"], htmlPages: ["https://www.nation.africa/careers/"], defaultLocation: "Nairobi, Kenya" },
  { id: "standard-group-careers", name: "Standard Group Kenya Careers", country: "Kenya", fields: ["media"], htmlPages: ["https://www.standardmedia.co.ke/careers"], defaultLocation: "Nairobi, Kenya" },
  { id: "kenya-airways-careers", name: "Kenya Airways Careers", country: "Kenya", fields: ["logistics"], htmlPages: ["https://www.kenya-airways.com/en/careers/", "https://careers.kenya-airways.com/"], defaultLocation: "Nairobi, Kenya" },
];

export const ALL_KENYA_SOURCES: SourceSpec[] = [
  ...KENYAN_BOARDS, ...GOVERNMENT_SOURCES, ...NGO_SOURCES, ...FINANCE_SOURCES,
  ...HEALTHCARE_SOURCES, ...TECH_SOURCES, ...EDUCATION_SOURCES, ...MEDIA_LOGISTICS_SOURCES,
];

// ---------------------------------------------------------------------------
// Crawl engine
// ---------------------------------------------------------------------------

async function crawlHtmlPage(spec: SourceSpec, pageUrl: string, seen: Set<string>, jobs: CrawledJob[], max: number, timeout: number): Promise<void> {
  try {
    const res = await secureFetch(pageUrl, { timeoutMs: timeout });
    if (!res.ok) return;
    const html = res.text;
    const origin = new URL(pageUrl).origin;

    const san = (raw: string): string | null => {
      if (!raw) return null;
      let u = raw.trim();
      if (u.startsWith("javascript:") || u.startsWith("#") || u.startsWith("mailto:")) return null;
      if (u.startsWith("//")) u = "https:" + u;
      else if (u.startsWith("/")) u = `${origin}${u}`;
      else if (!u.startsWith("http")) u = `${origin}/${u}`;
      return u;
    };

    // BrighterMonday: <a href="/listings/..." title="TITLE">
    if (spec.id === "brightermonday") {
      for (const m of html.matchAll(/<a[^>]+href=["']((?:https?:\/\/(?:www\.)?brightermonday\.co\.ke)?\/listings\/[a-zA-Z0-9_-]+)["'][^>]*title=["']([^"']+)["'][^>]*>/gi)) {
        if (jobs.length >= max) break;
        let u = m[1];
        if (!u.startsWith("http")) u = `https://www.brightermonday.co.ke${u}`;
        const t = cleanHtml(m[2]);
        if (seen.has(u) || isGarbage(t)) continue;
        seen.add(u); jobs.push(buildJob(spec, t, u));
      }
      return;
    }

    // MyJobMag: <h2><a href="/job/...">Title</a></h2>
    if (spec.id === "myjobmag") {
      for (const m of html.matchAll(/<h2>\s*<a[^>]+href=["'](\/job\/[a-zA-Z0-9_-]+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi)) {
        if (jobs.length >= max) break;
        const u = `https://www.myjobmag.co.ke${m[1]}`;
        const t = cleanHtml(m[2]);
        if (seen.has(u) || isGarbage(t)) continue;
        seen.add(u); jobs.push(buildJob(spec, t, u));
      }
      return;
    }

    // Corporate Staffing: <h2 class="entry-title"><a href=".../(job|vacancy)/...">
    if (spec.id === "corporate-staffing") {
      for (const m of html.matchAll(/<h2[^>]*class=["']entry-title["'][^>]*>\s*<a[^>]+href=["'](https?:\/\/(?:www\.)?corporatestaffing\.co\.ke\/(?:job|vacancy)\/[a-zA-Z0-9_-]+\/?)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi)) {
        if (jobs.length >= max) break;
        const u = m[1]; const t = cleanHtml(m[2]);
        if (seen.has(u) || isGarbage(t)) continue;
        seen.add(u); jobs.push(buildJob(spec, t, u));
      }
      return;
    }

    // Generic: heading links
    for (const m of html.matchAll(/<h[1-5][^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h[1-5]>/gi)) {
      if (jobs.length >= max) break;
      const u = san(m[1]); const t = cleanHtml(m[2]);
      if (!u || seen.has(u) || isGarbage(t) || isIndexUrl(u)) continue;
      if (spec.jobUrlPattern) {
        if (!spec.jobUrlPattern.test(u)) continue;
      } else {
        const hasJobUrlCue = /\/(?:job|jobs|vacancy|vacancies|career|careers|recruitment|adverts?|opening|openings)\b/i.test(u);
        const hasJobTitleCue = /\b(?:officer|engineer|manager|specialist|assistant|analyst|developer|director|consultant|accountant|nurse|doctor|lead|coordinator|supervisor|technician|intern|administrator|clerk|advisor|expert|surgeon|surveyor|driver)\b/i.test(t);
        if (!hasJobUrlCue && !hasJobTitleCue) continue;
      }
      seen.add(u); jobs.push(buildJob(spec, t, u));
    }

    // Generic: explicit job URL patterns
    for (const m of html.matchAll(/<a[^>]+href=["']([^"']*(?:\/listings\/|\/job\/|\/vacancy\/|\/jobs\/[a-zA-Z0-9_-]{5,})[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (jobs.length >= max) break;
      const u = san(m[1]);
      if (!u || seen.has(u) || isIndexUrl(u)) continue;
      const inner = m[2];
      const tm = inner.match(/<(?:h[1-6]|p|span|div)[^>]*class=["'][^"']*(?:title|heading|job-title|font-medium|font-semibold)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h[1-6]|p|span|div)>/i) || inner.match(/<(?:h[1-6]|strong|b)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b)>/i);
      const t = tm ? cleanHtml(tm[1]) : cleanHtml(inner);
      if (isGarbage(t)) continue;
      seen.add(u); jobs.push(buildJob(spec, t, u));
    }

    // Government: tabular rows (PSC, PSCK etc.)
    for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (jobs.length >= max) break;
      const cells = Array.from(tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => cleanHtml(c[1]));
      if (cells.length >= 3 && /^\d+$/.test(cells[0]) && cells[2] && cells[2].length > 4) {
        const title = cells[2]; const ministry = cells[4] || spec.name;
        const key = `${spec.id}-${title}`;
        if (seen.has(key) || isGarbage(title)) continue;
        seen.add(key); jobs.push(buildJob(spec, `${title} at ${ministry}`, pageUrl));
      }
    }

    // PDF vacancy notices
    for (const m of html.matchAll(/<a[^>]+href=["']([^"']*(?:advert|vacancy|job|career|recruitment)[^"']*\.(?:pdf|docx?))["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (jobs.length >= max) break;
      const u = san(m[1]); const t = cleanHtml(m[2]);
      if (!u || seen.has(u) || isGarbage(t)) continue;
      seen.add(u);

      if (u.toLowerCase().endsWith(".pdf")) {
        try {
          const parsed = await parsePdfVacancyNotice(u, spec.name, spec.id);
          if (parsed && parsed.length > 0) {
            for (const pj of parsed) {
              if (jobs.length >= max) break;
              jobs.push({
                ...pj,
                location: pj.location || spec.defaultLocation || "Kenya",
                url: pj.url || u,
                sourceUrl: pj.sourceUrl || u,
                applicationUrl: pj.applicationUrl || u,
                externalJobId: pj.externalJobId || undefined,
                salary: pj.salary || null,
                county: pj.county || null,
                postedDate: pj.postedDate || new Date(),
                jobType: pj.jobType || "Full-time",
                skills: pj.skills || [],
                sourceId: spec.id,
                sourceName: spec.name,
              });
            }
            continue;
          }
        } catch {
          // fallback to standard job item below
        }
      }

      jobs.push(buildJob(spec, t, u));
    }
  } catch { /* skip on network error */ }
}

async function crawlFeed(spec: SourceSpec, feedUrl: string, seen: Set<string>, jobs: CrawledJob[], max: number, timeout: number): Promise<void> {
  try {
    const res = await secureFetch(feedUrl, { timeoutMs: timeout });
    if (!res.ok) return;
    for (const item of parseXmlFeed(res.text)) {
      if (jobs.length >= max) break;
      if (!item.title || !item.link) continue;
      if (spec.id === "jobwebkenya" && !/\/jobs\//i.test(item.link)) continue;
      if (spec.id === "myjobmag" && /\/(?:careers-at-|vacancies-at-|blog)/i.test(item.link)) continue;
      if (spec.id === "careerpoint-kenya" && /\/(?:interview-tips|career-advice|sample-cover-letters)/i.test(item.link)) continue;
      if (spec.id === "summit-recruitment" && !/\/job\//i.test(item.link)) continue;
      if (spec.id === "gap-recruitment" && (!/\/job\//i.test(item.link) || /hello-world/i.test(item.link))) continue;
      if (seen.has(item.link) || isGarbage(item.title)) continue;
      seen.add(item.link); jobs.push(buildJob(spec, item.title, item.link, item.description, item.pubDate));
    }
  } catch { /* skip */ }
}

async function crawlJson(spec: SourceSpec, endpoint: string, seen: Set<string>, jobs: CrawledJob[], max: number, timeout: number): Promise<void> {
  try {
    const res = await secureFetch(endpoint, { timeoutMs: timeout });
    if (!res.ok) return;
    const data = res.json();

    // 1. Remotive format: { jobs: [...] }
    if (Array.isArray(data?.jobs)) {
      for (const j of data.jobs) {
        if (jobs.length >= max) break;
        const title = j.title || "";
        const url = j.url || "";
        const company = j.company_name || spec.name;
        const desc = cleanHtml(j.description || "");
        const pub = j.publication_date || "";
        if (!title || !url || seen.has(url) || isGarbage(title)) continue;
        seen.add(url);
        const job = buildJob(spec, `${title} at ${company}`, url, desc, pub);
        job.remote = true;
        job.salary = j.salary || null;
        jobs.push(job);
      }
      return;
    }

    // 2. Arbeitnow format: { data: [...] }
    if (Array.isArray(data?.data) && data.data[0]?.company_name) {
      for (const j of data.data) {
        if (jobs.length >= max) break;
        const title = j.title || "";
        const url = j.url || "";
        const company = j.company_name || spec.name;
        const desc = cleanHtml(j.description || "");
        const pub = j.created_at ? new Date(j.created_at * 1000).toISOString() : "";
        if (!title || !url || seen.has(url) || isGarbage(title)) continue;
        seen.add(url);
        const job = buildJob(spec, `${title} at ${company}`, url, desc, pub);
        job.remote = Boolean(j.remote);
        jobs.push(job);
      }
      return;
    }

    // 3. Generic array or data.data or data.items
    const rawList = Array.isArray(data) ? data : (data?.data || data?.items || []);
    for (const item of rawList) {
      if (jobs.length >= max) break;
      const f = item?.fields || item;
      const title = f?.title || f?.position || f?.jobTitle || "";
      const url = f?.url || item?.links?.self || f?.link || "";
      const company = f?.company || f?.companyName || f?.source?.[0]?.name || spec.name;
      const desc = cleanHtml(f?.body || f?.description || f?.jobDescription || "");
      const pub = f?.date?.created || f?.date || f?.pubDate || "";
      if (!title || !url || seen.has(url) || isGarbage(title)) continue;
      seen.add(url);
      jobs.push(buildJob(spec, `${title} at ${company}`, url, desc, pub));
    }
  } catch { /* skip */ }
}

function matchesCareerFieldUrl(url: string, fields: CareerField[]): boolean {
  if (fields.includes("all")) return true;
  const u = url.toLowerCase();
  for (const f of fields) {
    if (f === "healthcare" && /medical|health|pharma|doctor|nurse|clinic|hospital|surgeon/i.test(u)) return true;
    if (f === "tech" && /it-|tech|software|data|dev|computer|information-technology/i.test(u)) return true;
    if (f === "finance" && /finance|account|audit|bank|tax|treasury|credit/i.test(u)) return true;
    if (f === "agriculture" && /agri|farm|crop|livestock|horticultur/i.test(u)) return true;
    if (f === "ngo" && /ngo|charity|humanitarian|development|aid|relief/i.test(u)) return true;
    if (f === "engineering" && /engineer|technical/i.test(u)) return true;
    if (f === "legal" && /legal|law|compliance/i.test(u)) return true;
    if (f === "education" && /education|training|teach|vacancies/i.test(u)) return true;
    if (f === "logistics" && /logistics|procurement|supply/i.test(u)) return true;
    if (f === "hospitality" && /hospitality|hotel|tourism/i.test(u)) return true;
    if (f === "media" && /media|creative|journalism/i.test(u)) return true;
    if (f === "insurance" && /insurance/i.test(u)) return true;
    if (f === "government" && /government|public-service|psck|psc|tsc|knh|mtrh|kemri/i.test(u)) return true;
  }
  return false;
}

/**
 * Aggressively crawl all (or field-filtered) Kenyan job sources.
 */
export async function aggressiveCrawlKenya(config: CrawlConfig = {}): Promise<CrawledJob[]> {
  const { maxJobs = 1000, perRequestTimeout = 12_000, concurrency = 8, fields = ["all"], multiPage = true, maxPages = 4, sourceIds } = config;
  const includeAll = fields.includes("all");

  // Separate dedicated domain sources from generic aggregator boards
  const dedicatedSources: SourceSpec[] = [];
  const genericSources: SourceSpec[] = [];

  for (const s of ALL_KENYA_SOURCES) {
    if (sourceIds && sourceIds.length > 0) {
      if (sourceIds.includes(s.id)) dedicatedSources.push(s);
      continue;
    }
    if (includeAll) {
      genericSources.push(s);
      continue;
    }
    const hasExplicitField = s.fields.some((f) => fields.includes(f));
    if (hasExplicitField) {
      dedicatedSources.push(s);
    } else if (s.fields.includes("all")) {
      genericSources.push(s);
    }
  }

  // Dedicated field sources go FIRST to prevent starvation by generic boards
  const activeSources = [...dedicatedSources, ...genericSources];

  type Task = { type: "html" | "feed" | "json"; spec: SourceSpec; url: string };
  const sourceTaskQueues: Task[][] = [];

  for (const spec of activeSources) {
    const isDedicated = dedicatedSources.includes(spec);
    const queue: Task[] = [];

    // Filter feeds for multi-field aggregators to target active career fields
    let feedsToQueue = spec.feeds || [];
    if (!includeAll && !isDedicated) {
      const matchingFeeds = feedsToQueue.filter((u) => matchesCareerFieldUrl(u, fields));
      feedsToQueue = matchingFeeds.length > 0 ? matchingFeeds : [];
    }
    for (const url of feedsToQueue) queue.push({ type: "feed", spec, url });

    for (const url of spec.jsonEndpoints || []) queue.push({ type: "json", spec, url });

    // Filter HTML pages for multi-field aggregators to target active career fields
    let pagesToQueue = spec.htmlPages || [];
    if (!includeAll && !isDedicated) {
      const matchingPages = pagesToQueue.filter((u) => matchesCareerFieldUrl(u, fields));
      pagesToQueue = matchingPages.length > 0 ? matchingPages : [];
    }

    for (const pageUrl of pagesToQueue) {
      queue.push({ type: "html", spec, url: pageUrl });
      if (multiPage && spec.pagination) {
        const pg = spec.pagination;
        const start = pg.startPage ?? 2;
        const end = start + (pg.maxPages ?? maxPages) - 1;
        for (let page = start; page <= end; page++) {
          if (pg.type === "query" && pg.param) {
            queue.push({ type: "html", spec, url: `${pageUrl}${pageUrl.includes("?") ? "&" : "?"}${pg.param}=${page}` });
          } else if (pg.type === "path" && pg.pathTemplate) {
            queue.push({ type: "html", spec, url: `${new URL(pageUrl).origin}${pg.pathTemplate.replace("{page}", String(page))}` });
          }
        }
      }
    }
    if (queue.length > 0) sourceTaskQueues.push(queue);
  }

  // Fair round-robin interleaving so no single board starves the others
  const tasks: Task[] = [];
  let added = true;
  let round = 0;
  while (added) {
    added = false;
    for (const q of sourceTaskQueues) {
      if (round < q.length) {
        tasks.push(q[round]);
        added = true;
      }
    }
    round++;
  }

  const jobs: CrawledJob[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < tasks.length; i += concurrency) {
    if (jobs.length >= maxJobs) break;
    await Promise.allSettled(
      tasks.slice(i, i + concurrency).map((task) => {
        if (jobs.length >= maxJobs) return Promise.resolve();
        if (task.type === "feed") return crawlFeed(task.spec, task.url, seen, jobs, maxJobs, perRequestTimeout);
        if (task.type === "json") return crawlJson(task.spec, task.url, seen, jobs, maxJobs, perRequestTimeout);
        return crawlHtmlPage(task.spec, task.url, seen, jobs, maxJobs, perRequestTimeout);
      })
    );
  }

  return jobs;
}

/** Crawl jobs for a specific career field (e.g. per tenant configuration). */
export async function crawlJobsByField(field: CareerField, maxJobs = 300): Promise<CrawledJob[]> {
  return aggressiveCrawlKenya({ fields: [field], maxJobs, multiPage: true, maxPages: 6 });
}

/** Crawl jobs based on CV-extracted keywords (infers relevant career fields). */
export async function crawlJobsByKeywords(keywords: string[], maxJobs = 400): Promise<CrawledJob[]> {
  const kw = keywords.join(" ").toLowerCase();
  const fields: CareerField[] = [];
  if (/tech|it |ict|software|developer|engineer|network|cloud|cyber|data|devops/i.test(kw)) fields.push("tech");
  if (/medical|doctor|nurse|clinical|health|pharma|hospital|physician|surgeon/i.test(kw)) fields.push("healthcare");
  if (/finance|bank|account|audit|fintech/i.test(kw)) fields.push("finance");
  if (/insurance|actuar/i.test(kw)) fields.push("insurance");
  if (/ngo|charity|humanitarian|development|aid/i.test(kw)) fields.push("ngo");
  if (/government|public service|civil service|county|ministry/i.test(kw)) fields.push("government");
  if (/teach|lecture|professor|education|school|university/i.test(kw)) fields.push("education");
  if (/legal|law|lawyer|advocate|compliance/i.test(kw)) fields.push("legal");
  if (/civil|structural|mechanical|electrical engineer/i.test(kw)) fields.push("engineering");
  if (/agricultur|farm|agri|livestock|horticultur/i.test(kw)) fields.push("agriculture");
  if (/hotel|hospitality|tourism|restaurant|chef|catering/i.test(kw)) fields.push("hospitality");
  if (/media|journalism|broadcast|creative|design|marketing|pr/i.test(kw)) fields.push("media");
  if (/logistics|supply chain|procurement|warehouse|shipping/i.test(kw)) fields.push("logistics");
  if (fields.length === 0) fields.push("all");
  return aggressiveCrawlKenya({ fields, maxJobs, multiPage: true, maxPages: 6, concurrency: 10 });
}
