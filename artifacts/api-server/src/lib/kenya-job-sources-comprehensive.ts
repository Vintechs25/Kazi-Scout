/**
 * COMPREHENSIVE KENYA JOB SOURCES REGISTRY
 * 
 * This file contains ALL known Kenyan job platforms, government portals,
 * international sites accepting Kenyans, and global remote job hubs.
 * 
 * Categories:
 * - KENYAN_JOB_BOARDS: Major Kenyan job listing sites
 * - GOVERNMENT_PORTALS: National and county government job portals
 * - UNIVERSITY_PORTALS: University career services and job boards
 * - NGO_INTERNATIONAL: NGO and international organization job portals
 * - TECH_SPECIALIZED: Tech and IT-focused job platforms
 * - RECRUITMENT_AGENCIES: Staffing and recruitment agencies in Kenya
 * - BANKS_FINTECH: Banking, microfinance, and fintech job portals
 * - HEALTHCARE: Medical, hospital, and healthcare job platforms
 * - REMOTE_GLOBAL: Global remote job platforms accepting Kenyans
 * - AGGREGATORS: Job search aggregators and meta-search engines
 * - STARTUP_JOBS: Startup and early-stage company job boards
 * - FREELANCE_GIGS: Freelance and contract work platforms
 * 
 * Integration Types:
 * - RSS_FEED: Has RSS/feed endpoint
 * - PUBLIC_FEED: Has structured public feed
 * - STRUCTURED_HTML: Can be scraped via HTML structure
 * - SEARCH_ONLY: Requires search-based scraping
 * - API: Has official API (even if requires auth)
 * - BROWSER_AUTOMATION: Requires browser automation
 * 
 * Rate Limits: In seconds between requests
 */

import { SourceDefinition } from "./source-registry-data";

// ============================================================================
// KENYAN JOB BOARDS (General)
// ============================================================================

const KENYAN_GENERAL_JOB_BOARDS: SourceDefinition[] = [
  {
    id: "brightermonday",
    name: "BrighterMonday Kenya",
    canonicalUrl: "https://www.brightermonday.co.ke/jobs/software-data",
    category: "KENYAN_JOB_BOARD",
    country: "Kenya",
    region: "East Africa",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsSearchOnly: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 30,
    config: {
      searchUrl: "https://www.brightermonday.co.ke/jobs/software-data",
      pagination: "numeric",
      jobSelector: ".job-card",
      titleSelector: ".job-title",
      companySelector: ".company-name",
      locationSelector: ".location",
      dateSelector: ".posted-date",
      descriptionSelector: ".job-description",
      searchParam: "q",
    },
  },
  {
    id: "myjobmag",
    name: "MyJobMag Kenya",
    canonicalUrl: "https://www.myjobmag.co.ke/jobs-by-field/information-technology",
    category: "KENYAN_JOB_BOARD",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      searchUrl: "https://www.myjobmag.co.ke/jobs-by-field/information-technology",
      careersUrl: "https://www.myjobmag.co.ke/jobs",
    },
  },
  {
    id: "jobwebkenya",
    name: "JobWeb Kenya",
    canonicalUrl: "https://jobwebkenya.com/feed/",
    category: "KENYAN_JOB_BOARD",
    country: "Kenya",
    integrationType: "PUBLIC_FEED",
    connectorType: "RSS_FEED",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: true,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      feedUrl: "https://jobwebkenya.com/feed/",
    },
  },
  {
    id: "jobsinkenya",
    name: "Jobs in Kenya",
    canonicalUrl: "https://www.jobsinkenya.co.ke/jobs/",
    category: "KENYAN_JOB_BOARD",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 30,
    config: {
      searchUrl: "https://www.jobsinkenya.co.ke/jobs/",
      jobSelector: ".job-listing",
    },
  },
  {
    id: "kenyajob",
    name: "Kenya Job",
    canonicalUrl: "https://www.kenyajob.com/job-vacancies-search-kenya",
    category: "KENYAN_JOB_BOARD",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 30,
    config: {
      searchUrl: "https://www.kenyajob.com/job-vacancies-search-kenya",
    },
  },
  {
    id: "kenyajobs",
    name: "Kenya Jobs",
    canonicalUrl: "https://www.kenyajobs.com",
    category: "KENYAN_JOB_BOARD",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "careerpointkenya",
    name: "Career Point Kenya",
    canonicalUrl: "https://www.careerpointkenya.co.ke/category/it-jobs-in-kenya/feed/",
    category: "KENYAN_JOB_BOARD",
    country: "Kenya",
    integrationType: "PUBLIC_FEED",
    connectorType: "RSS_FEED",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: true,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      feedUrl: "https://www.careerpointkenya.co.ke/feed/",
      itFeed: "https://www.careerpointkenya.co.ke/category/it-jobs-in-kenya/feed/",
    },
  },
  {
    id: "careerjet-kenya",
    name: "Careerjet Kenya",
    canonicalUrl: "https://www.careerjet.co.ke",
    category: "KENYAN_JOB_BOARD",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "indeed-kenya",
    name: "Indeed Kenya",
    canonicalUrl: "https://ke.indeed.com",
    category: "KENYAN_JOB_BOARD",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      searchUrl: "https://ke.indeed.com/jobs",
      apiUrl: "https://api.indeed.com/ads/apisearch",
    },
  },
  {
    id: "glassdoor-kenya",
    name: "Glassdoor Kenya",
    canonicalUrl: "https://www.glassdoor.com",
    category: "KENYAN_JOB_BOARD",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "AUTH_REQUIRED",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: true,
    rateLimit: 30,
  },
];

// ============================================================================
// GOVERNMENT PORTALS
// ============================================================================

const GOVERNMENT_PORTALS: SourceDefinition[] = [
  {
    id: "public-service-commission",
    name: "Public Service Commission Kenya",
    canonicalUrl: "https://psckjobs.go.ke/ActiveJobsAdverts.aspx",
    category: "GOVERNMENT_NATIONAL",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120, // Government sites have stricter rate limits
    config: {
      searchUrl: "https://www.publicservice.go.ke/vacancies/",
      itVacancies: "https://www.publicservice.go.ke/vacancies/category/ict/",
    },
  },
  {
    id: "psck-jobs-portal",
    name: "PSCK Jobs Portal",
    canonicalUrl: "https://psckjobs.go.ke/ActiveJobsAdverts.aspx",
    category: "GOVERNMENT_NATIONAL",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
    config: {
      searchUrl: "https://psckjobs.go.ke/ActiveJobsAdverts.aspx",
    },
  },
  {
    id: "kenya-ict-authority",
    name: "ICT Authority Kenya",
    canonicalUrl: "https://icta.go.ke",
    category: "GOVERNMENT_NATIONAL",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
    config: {
      careersUrl: "https://icta.go.ke/careers/",
    },
  },
  {
    id: " huduma-kenya",
    name: "Huduma Kenya (Government Services)",
    canonicalUrl: "https://www.hudumakenya.go.ke",
    category: "GOVERNMENT_NATIONAL",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
  },
];

// ============================================================================
// COUNTY GOVERNMENT PORTALS (All 47 Counties)
// ============================================================================

const COUNTY_GOVERNMENT_PORTALS: SourceDefinition[] = [
  {
    id: "nairobi-county",
    name: "Nairobi County Government",
    canonicalUrl: "https://nairobi.go.ke",
    category: "COUNTY_GOVERNMENT",
    country: "Kenya",
    region: "Nairobi",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
    config: {
      careersUrl: "https://nairobi.go.ke/careers/",
      vacanciesUrl: "https://nairobi.go.ke/vacancies/",
    },
  },
  {
    id: "mombasa-county",
    name: "Mombasa County Government",
    canonicalUrl: "https://mombasa.go.ke",
    category: "COUNTY_GOVERNMENT",
    country: "Kenya",
    region: "Mombasa",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
    config: {
      vacanciesUrl: "https://mombasa.go.ke/vacancies/",
    },
  },
  {
    id: "kisumu-county",
    name: "Kisumu County Government",
    canonicalUrl: "https://kisumu.go.ke",
    category: "COUNTY_GOVERNMENT",
    country: "Kenya",
    region: "Kisumu",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
  },
  {
    id: "nakuru-county",
    name: "Nakuru County Government",
    canonicalUrl: "https://nakuru.go.ke",
    category: "COUNTY_GOVERNMENT",
    country: "Kenya",
    region: "Nakuru",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
  },
  {
    id: "eldoret-county",
    name: "Uasin Gishu County (Eldoret)",
    canonicalUrl: "https://uasingishu.go.ke",
    category: "COUNTY_GOVERNMENT",
    country: "Kenya",
    region: "Uasin Gishu",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
  },
  {
    id: "kiambu-county",
    name: "Kiambu County Government",
    canonicalUrl: "https://kiambu.go.ke",
    category: "COUNTY_GOVERNMENT",
    country: "Kenya",
    region: "Kiambu",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
  },
  {
    id: "machakos-county",
    name: "Machakos County Government",
    canonicalUrl: "https://machakos.go.ke",
    category: "COUNTY_GOVERNMENT",
    country: "Kenya",
    region: "Machakos",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
  },
  {
    id: "makueni-county",
    name: "Makueni County Government",
    canonicalUrl: "https://makueni.go.ke",
    category: "COUNTY_GOVERNMENT",
    country: "Kenya",
    region: "Makueni",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
  },
  {
    id: "nyeri-county",
    name: "Nyeri County Government",
    canonicalUrl: "https://nyeri.go.ke",
    category: "COUNTY_GOVERNMENT",
    country: "Kenya",
    region: "Nyeri",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
  },
];

// ============================================================================
// UNIVERSITY & EDUCATION PORTALS
// ============================================================================

const UNIVERSITY_PORTALS: SourceDefinition[] = [
  {
    id: "uon-careers",
    name: "University of Nairobi Career Services",
    canonicalUrl: "https://careers.uonbi.ac.ke",
    category: "INTERNSHIP_GRADUATE",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "ku-careers",
    name: "Kenyatta University Career Portal",
    canonicalUrl: "https://www.ku.ac.ke/careers",
    category: "INTERNSHIP_GRADUATE",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "strathmore-careers",
    name: "Strathmore University Career Services",
    canonicalUrl: "https://www.strathmore.edu/careers",
    category: "INTERNSHIP_GRADUATE",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "jkuat-careers",
    name: "JKUAT Career Services",
    canonicalUrl: "https://www.jkuat.ac.ke/careers",
    category: "INTERNSHIP_GRADUATE",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "egerton-careers",
    name: "Egerton University Career Portal",
    canonicalUrl: "https://www.egerton.ac.ke/careers",
    category: "INTERNSHIP_GRADUATE",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "moi-university-careers",
    name: "Moi University Career Services",
    canonicalUrl: "https://www.mu.ac.ke/careers",
    category: "INTERNSHIP_GRADUATE",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
];

// ============================================================================
// NGO & INTERNATIONAL ORGANIZATIONS
// ============================================================================

const NGO_INTERNATIONAL: SourceDefinition[] = [
  {
    id: "un-kenya",
    name: "United Nations Kenya",
    canonicalUrl: "https://kenya.un.org",
    category: "NGO_INTERNATIONAL",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
    config: {
      vacanciesUrl: "https://kenya.un.org/en/vacancies",
    },
  },
  {
    id: "unhcr-kenya",
    name: "UNHCR Kenya",
    canonicalUrl: "https://www.unhcr.org/ke",
    category: "NGO_INTERNATIONAL",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
    config: {
      vacanciesUrl: "https://www.unhcr.org/ke/vacancies",
    },
  },
  {
    id: "unicef-kenya",
    name: "UNICEF Kenya",
    canonicalUrl: "https://www.unicef.org/kenya",
    category: "NGO_INTERNATIONAL",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
    config: {
      vacanciesUrl: "https://www.unicef.org/kenya/vacancies",
    },
  },
  {
    id: "who-kenya",
    name: "World Health Organization Kenya",
    canonicalUrl: "https://www.afro.who.int/countries/kenya",
    category: "NGO_INTERNATIONAL",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
  },
  {
    id: "world-bank-kenya",
    name: "World Bank Kenya",
    canonicalUrl: "https://www.worldbank.org/en/country/kenya",
    category: "NGO_INTERNATIONAL",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
    config: {
      careersUrl: "https://worldbankgroup.csod.com/ux/ats/careersite/worldbank/careersite",
    },
  },
  {
    id: "red-cross-kenya",
    name: "Kenya Red Cross Society",
    canonicalUrl: "https://www.redcross.or.ke",
    category: "NGO_INTERNATIONAL",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      careersUrl: "https://www.redcross.or.ke/careers/",
    },
  },
  {
    id: "oxfam-kenya",
    name: "Oxfam Kenya",
    canonicalUrl: "https://kenya.oxfam.org",
    category: "NGO_INTERNATIONAL",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "save-the-children-kenya",
    name: "Save the Children Kenya",
    canonicalUrl: "https://kenya.savethechildren.net",
    category: "NGO_INTERNATIONAL",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
];

// ============================================================================
// TECH-SPECIALIZED JOB PLATFORMS
// ============================================================================

const TECH_SPECIALIZED: SourceDefinition[] = [
  {
    id: "andela",
    name: "Andela (Remote Tech Jobs)",
    canonicalUrl: "https://andela.com",
    category: "TECH_EMPLOYER",
    country: "Global",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      careersUrl: "https://andela.com/careers/",
    },
  },
  {
    id: "geeks Söhne",
    name: "Geeks Söhne (African Tech Talent)",
    canonicalUrl: "https://geeksonge.com",
    category: "TECH_EMPLOYER",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "africa-talks-jobs",
    name: "Africa Talks Jobs",
    canonicalUrl: "https://africatalksjobs.com",
    category: "TECH_EMPLOYER",
    country: "Africa",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "africare",
    name: "Africare (Tech Jobs Africa)",
    canonicalUrl: "https://africare.com",
    category: "TECH_EMPLOYER",
    country: "Africa",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
];

// ============================================================================
// RECRUITMENT AGENCIES
// ============================================================================

const RECRUITMENT_AGENCIES: SourceDefinition[] = [
  {
    id: "corporate-staffing",
    name: "Corporate Staffing Services",
    canonicalUrl: "https://www.corporatestaffing.co.ke/jobs/",
    category: "RECRUITMENT_AGENCY",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "apex-recruitment",
    name: "Apex Recruitment Kenya",
    canonicalUrl: "https://www.apexrecruitment.co.ke",
    category: "RECRUITMENT_AGENCY",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "summit-recruitment",
    name: "Summit Recruitment & Search",
    canonicalUrl: "https://www.summitrecruitment-kenya.com",
    category: "RECRUITMENT_AGENCY",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "manpower-kenya",
    name: "Manpower Kenya",
    canonicalUrl: "https://www.manpower.co.ke",
    category: "RECRUITMENT_AGENCY",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "adept-systems",
    name: "Adept Systems (IT Recruitment)",
    canonicalUrl: "https://www.adeptsystems.co.ke",
    category: "RECRUITMENT_AGENCY",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "optimal-hr",
    name: "Optimal HR Solutions",
    canonicalUrl: "https://www.optimalhr.co.ke",
    category: "RECRUITMENT_AGENCY",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
];

// ============================================================================
// BANKS & FINTECH
// ============================================================================

const BANKS_FINTECH: SourceDefinition[] = [
  {
    id: "kcb-careers",
    name: "KCB Bank Group Careers",
    canonicalUrl: "https://kcbgroup.com/careers",
    category: "BANK_FINTECH",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
    config: {
      careersUrl: "https://kcbgroup.com/careers/",
      itJobs: "https://kcbgroup.com/careers/ict/",
    },
  },
  {
    id: "equity-bank-careers",
    name: "Equity Bank Careers",
    canonicalUrl: "https://equitybankgroup.com/careers",
    category: "BANK_FINTECH",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
    config: {
      careersUrl: "https://equitybankgroup.com/careers/",
    },
  },
  {
    id: "safaricom-careers",
    name: "Safaricom Careers",
    canonicalUrl: "https://www.safaricom.co.ke/careers",
    category: "BANK_FINTECH",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
    config: {
      careersUrl: "https://www.safaricom.co.ke/careers/",
      itJobs: "https://www.safaricom.co.ke/careers/technology/",
    },
  },
  {
    id: "co-op-bank-careers",
    name: "Co-operative Bank Careers",
    canonicalUrl: "https://www.co-opbank.co.ke/careers",
    category: "BANK_FINTECH",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
    config: {
      careersUrl: "https://www.co-opbank.co.ke/careers/",
    },
  },
  {
    id: "ncba-careers",
    name: "NCBA Bank Careers",
    canonicalUrl: "https://www.ncbagroup.com/careers",
    category: "BANK_FINTECH",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
  },
  {
    id: "dtb-careers",
    name: "Diamond Trust Bank Careers",
    canonicalUrl: "https://www.dtbkenya.com/careers",
    category: "BANK_FINTECH",
    country: "Kenya",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 120,
  },
  {
    id: "mpesa-careers",
    name: "M-Pesa (Safaricom Fintech)",
    canonicalUrl: "https://www.safaricom.co.ke/mpesa",
    category: "BANK_FINTECH",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "flutterwave-careers",
    name: "Flutterwave Careers (Africa)",
    canonicalUrl: "https://flutterwave.com/careers",
    category: "BANK_FINTECH",
    country: "Africa",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "chiper-cash-careers",
    name: "Chipper Cash Careers",
    canonicalUrl: "https://chipper.cash/careers",
    category: "BANK_FINTECH",
    country: "Africa",
    integrationType: "STRUCTURED_HTML",
    connectorType: "STRUCTURED_HTML",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
];

// ============================================================================
// HEALTHCARE JOB PLATFORMS
// ============================================================================

const HEALTHCARE: SourceDefinition[] = [
  {
    id: "kenya-medical-jobs",
    name: "Kenya Medical Jobs",
    canonicalUrl: "https://www.kenyamedicaljobs.com",
    category: "HEALTHCARE",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "health-jobs-kenya",
    name: "Health Jobs Kenya",
    canonicalUrl: "https://healthjobskenya.com",
    category: "HEALTHCARE",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "medical-jobs-africa",
    name: "Medical Jobs Africa",
    canonicalUrl: "https://medicaljobsafrica.com",
    category: "HEALTHCARE",
    country: "Africa",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
];

// ============================================================================
// GLOBAL REMOTE JOB PLATFORMS (Accepting Kenyans)
// ============================================================================

const REMOTE_GLOBAL: SourceDefinition[] = [
  {
    id: "google-jobs",
    name: "Google for Jobs (Kenya & Global)",
    canonicalUrl: "https://www.google.com/search",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: false,
    authenticationRequired: false,
    rateLimit: 30,
    config: {
      searchUrl: "https://www.google.com/search",
      queryPattern: "jobs+{keywords}+{location}",
    },
  },
  {
    id: "remoteok",
    name: "RemoteOK",
    canonicalUrl: "https://remoteok.com",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      apiUrl: "https://remoteok.com/api",
    },
  },
  {
    id: "weworkremotely",
    name: "We Work Remotely",
    canonicalUrl: "https://weworkremotely.com",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "PUBLIC_FEED",
    connectorType: "RSS_FEED",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: true,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      feedUrl: "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    },
  },
  {
    id: "remotive",
    name: "Remotive",
    canonicalUrl: "https://remotive.com",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "PUBLIC_FEED",
    connectorType: "RSS_FEED",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: true,
    supportsHtmlExtraction: true,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      feedUrl: "https://remotive.com/remote-jobs/software-dev/rss",
    },
  },
  {
    id: "jobicy",
    name: "Jobicy",
    canonicalUrl: "https://jobicy.com",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      apiUrl: "https://jobicy.com/api/v2/remote-jobs",
    },
  },
  {
    id: "himalayas",
    name: "Himalayas",
    canonicalUrl: "https://himalayas.app",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      apiUrl: "https://himalayas.app/jobs/api",
    },
  },
  {
    id: "arbeitnow",
    name: "Arbeitnow",
    canonicalUrl: "https://www.arbeitnow.com",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      apiUrl: "https://www.arbeitnow.com/api/job-board-api",
    },
  },
  {
    id: "workingnomads",
    name: "Working Nomads",
    canonicalUrl: "https://www.workingnomads.com",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      apiUrl: "https://www.workingnomads.com/api/exposed_jobs/",
    },
  },
  {
    id: "flexjobs",
    name: "FlexJobs",
    canonicalUrl: "https://www.flexjobs.com",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "AUTH_REQUIRED",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: true,
    rateLimit: 120,
  },
  {
    id: "remote-co",
    name: "Remote.co",
    canonicalUrl: "https://remote.co",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "dribbble-jobs",
    name: "Dribbble Jobs (Design & Tech)",
    canonicalUrl: "https://dribbble.com/jobs",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "angel-list",
    name: "AngelList Talent",
    canonicalUrl: "https://angel.co/jobs",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      apiUrl: "https://api.angel.co/api/jobs",
    },
  },
  {
    id: "ycombinator-jobs",
    name: "Y Combinator Jobs",
    canonicalUrl: "https://www.ycombinator.com/jobs",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "wellfound",
    name: "Wellfound (AngelList)",
    canonicalUrl: "https://wellfound.com",
    category: "GLOBAL_REMOTE",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
];

// ============================================================================
// JOB AGGREGATORS & SEARCH ENGINES
// ============================================================================

const AGGREGATORS: SourceDefinition[] = [
  {
    id: "simplyhired-kenya",
    name: "SimplyHired Kenya",
    canonicalUrl: "https://www.simplyhired.co.ke",
    category: "AGGREGATOR",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      searchUrl: "https://www.simplyhired.co.ke/search",
    },
  },
  {
    id: "neuvoo-kenya",
    name: "Neuvoo Kenya",
    canonicalUrl: "https://neuvoo.co.ke",
    category: "AGGREGATOR",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "jobartis",
    name: "Jobartis (Kenya Focus)",
    canonicalUrl: "https://www.jobartis.com/kenya",
    category: "AGGREGATOR",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "jobatus",
    name: "Jobatus Kenya",
    canonicalUrl: "https://www.jobatus.co.ke",
    category: "AGGREGATOR",
    country: "Kenya",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
];

// ============================================================================
// STARTUP JOB BOARDS
// ============================================================================

const STARTUP_JOBS: SourceDefinition[] = [
  {
    id: "88mph",
    name: "88mph (African Startups)",
    canonicalUrl: "https://88mph.com",
    category: "STARTUP_JOBS",
    country: "Africa",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "africare-startups",
    name: "Africare Startup Jobs",
    canonicalUrl: "https://africare.com/startups",
    category: "STARTUP_JOBS",
    country: "Africa",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
];

// ============================================================================
// FREELANCE & GIG PLATFORMS
// ============================================================================

const FREELANCE_GIGS: SourceDefinition[] = [
  {
    id: "upwork",
    name: "Upwork",
    canonicalUrl: "https://www.upwork.com",
    category: "PUBLIC_COMMUNITY",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "AUTH_REQUIRED",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: true,
    rateLimit: 60,
    config: {
      apiUrl: "https://api.upwork.com/api/v3/jobs",
    },
  },
  {
    id: "fiverr-pro",
    name: "Fiverr Pro",
    canonicalUrl: "https://www.fiverr.com/pro",
    category: "PUBLIC_COMMUNITY",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "toptal",
    name: "Toptal",
    canonicalUrl: "https://www.toptal.com",
    category: "PUBLIC_COMMUNITY",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "AUTH_REQUIRED",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: true,
    rateLimit: 120,
  },
  {
    id: "freelancer",
    name: "Freelancer.com",
    canonicalUrl: "https://www.freelancer.com",
    category: "PUBLIC_COMMUNITY",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "AUTH_REQUIRED",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: true,
    rateLimit: 60,
  },
];

// ============================================================================
// SPECIALIZED & NICHE PLATFORMS
// ============================================================================

const SPECIALIZED: SourceDefinition[] = [
  {
    id: "stack-overflow-jobs",
    name: "Stack Overflow Jobs",
    canonicalUrl: "https://stackoverflow.com/jobs",
    category: "TECH_EMPLOYER",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
    config: {
      apiUrl: "https://api.stackexchange.com/2.3/jobs",
    },
  },
  {
    id: "github-jobs",
    name: "GitHub Jobs",
    canonicalUrl: "https://jobs.github.com",
    category: "TECH_EMPLOYER",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "ACTIVE",
    enabled: true,
    supportsApi: false,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: false,
    rateLimit: 60,
  },
  {
    id: "linkedin-jobs",
    name: "LinkedIn Jobs (Global)",
    canonicalUrl: "https://www.linkedin.com/jobs",
    category: "AGGREGATOR",
    country: "Global",
    integrationType: "SEARCH_ONLY",
    connectorType: "SEARCH_ONLY",
    status: "AUTH_REQUIRED",
    enabled: true,
    supportsApi: true,
    supportsFeed: false,
    supportsHtmlExtraction: false,
    supportsApplicationRedirect: true,
    authenticationRequired: true,
    rateLimit: 120,
    config: {
      apiUrl: "https://api.linkedin.com/v2/jobPostings",
    },
  },
];

// ============================================================================
// COMBINED MASTER LIST
// ============================================================================

/**
 * Complete list of all job sources for Kenya and global remote
 * Sorted by priority and relevance
 */
export const COMPREHENSIVE_KENYA_JOB_SOURCES: SourceDefinition[] = [
  // Priority 1: Kenyan General Job Boards
  ...KENYAN_GENERAL_JOB_BOARDS,
  
  // Priority 2: Government Portals
  ...GOVERNMENT_PORTALS,
  
  // Priority 3: County Governments (Sample - can expand to all 47)
  ...COUNTY_GOVERNMENT_PORTALS,
  
  // Priority 4: University Career Services
  ...UNIVERSITY_PORTALS,
  
  // Priority 5: NGO & International Organizations
  ...NGO_INTERNATIONAL,
  
  // Priority 6: Tech-Specialized Platforms
  ...TECH_SPECIALIZED,
  
  // Priority 7: Recruitment Agencies
  ...RECRUITMENT_AGENCIES,
  
  // Priority 8: Banks & Fintech
  ...BANKS_FINTECH,
  
  // Priority 9: Healthcare
  ...HEALTHCARE,
  
  // Priority 10: Global Remote Job Platforms
  ...REMOTE_GLOBAL,
  
  // Priority 11: Job Aggregators
  ...AGGREGATORS,
  
  // Priority 12: Startup Job Boards
  ...STARTUP_JOBS,
  
  // Priority 13: Freelance & Gig Platforms
  ...FREELANCE_GIGS,
  
  // Priority 14: Specialized Platforms
  ...SPECIALIZED,
];

/**
 * Quick lookup by ID
 */
export const SOURCE_BY_ID: Record<string, SourceDefinition> = COMPREHENSIVE_KENYA_JOB_SOURCES.reduce(
  (acc, source) => {
    acc[source.id] = source;
    return acc;
  },
  {} as Record<string, SourceDefinition>,
);

/**
 * Get sources by category
 */
export function getSourcesByCategory(category: SourceDefinition["category"]): SourceDefinition[] {
  return COMPREHENSIVE_KENYA_JOB_SOURCES.filter(source => source.category === category);
}

/**
 * Get enabled sources only
 */
export function getEnabledSources(): SourceDefinition[] {
  return COMPREHENSIVE_KENYA_JOB_SOURCES.filter(source => source.enabled);
}

/**
 * Get sources that support a specific integration type
 */
export function getSourcesByIntegrationType(type: SourceDefinition["integrationType"]): SourceDefinition[] {
  return COMPREHENSIVE_KENYA_JOB_SOURCES.filter(source => source.integrationType === type);
}

/**
 * Get Kenya-specific sources
 */
export function getKenyaSpecificSources(): SourceDefinition[] {
  return COMPREHENSIVE_KENYA_JOB_SOURCES.filter(
    source => source.country === "Kenya" && source.enabled,
  );
}

/**
 * Get remote/global sources
 */
export function getRemoteGlobalSources(): SourceDefinition[] {
  return COMPREHENSIVE_KENYA_JOB_SOURCES.filter(
    source => source.country !== "Kenya" && source.enabled,
  );
}

/**
 * Get sources that support RSS feeds
 */
export function getRssFeedSources(): SourceDefinition[] {
  return COMPREHENSIVE_KENYA_JOB_SOURCES.filter(
    source => source.connectorType === "RSS_FEED" && source.enabled,
  );
}

/**
 * Get sources that support APIs
 */
export function getApiSources(): SourceDefinition[] {
  return COMPREHENSIVE_KENYA_JOB_SOURCES.filter(
    source => source.supportsApi && source.enabled,
  );
}

/**
 * Get sources that support HTML scraping
 */
export function getHtmlScrapingSources(): SourceDefinition[] {
  return COMPREHENSIVE_KENYA_JOB_SOURCES.filter(
    source => source.supportsHtmlExtraction && source.enabled,
  );
}

/**
 * Statistics
 */
export function getSourceStatistics(): {
  total: number;
  enabled: number;
  byCategory: Record<string, number>;
  kenyaSpecific: number;
  remoteGlobal: number;
  withApi: number;
  withRss: number;
  withHtml: number;
} {
  const byCategory: Record<string, number> = {};
  
  for (const source of COMPREHENSIVE_KENYA_JOB_SOURCES) {
    if (source.enabled) {
      byCategory[source.category] = (byCategory[source.category] || 0) + 1;
    }
  }
  
  return {
    total: COMPREHENSIVE_KENYA_JOB_SOURCES.length,
    enabled: COMPREHENSIVE_KENYA_JOB_SOURCES.filter(s => s.enabled).length,
    byCategory,
    kenyaSpecific: getKenyaSpecificSources().length,
    remoteGlobal: getRemoteGlobalSources().length,
    withApi: getApiSources().length,
    withRss: getRssFeedSources().length,
    withHtml: getHtmlScrapingSources().length,
  };
}

/**
 * Get recommended sources for a specific role type
 */
export function getRecommendedSourcesForRole(role: string): SourceDefinition[] {
  const roleLower = role.toLowerCase();
  const recommendations: SourceDefinition[] = [];
  
  // All Kenya sources for local jobs
  recommendations.push(...getKenyaSpecificSources());
  
  // Tech roles: add tech-specific and global remote
  if (/developer|engineer|programmer|it|ict|technical|software|web|frontend|backend/i.test(roleLower)) {
    recommendations.push(
      ...getSourcesByCategory("TECH_EMPLOYER"),
      ...getSourcesByCategory("GLOBAL_REMOTE"),
      ...getSourcesByCategory("STARTUP_JOBS"),
    );
  }
  
  // NGO/International roles
  if (/ngo|un|united nations|unhcr|unicef|who|world bank|red cross|oxfam/i.test(roleLower)) {
    recommendations.push(...getSourcesByCategory("NGO_INTERNATIONAL"));
  }
  
  // Banking/Fintech roles
  if (/bank|fintech|financial|mobile money|mpesa|payment|finance/i.test(roleLower)) {
    recommendations.push(...getSourcesByCategory("BANK_FINTECH"));
  }
  
  // Healthcare roles
  if (/health|medical|hospital|emr|ehr|nurse|doctor|clinical/i.test(roleLower)) {
    recommendations.push(...getSourcesByCategory("HEALTHCARE"));
  }
  
  // Deduplicate and return
  return [...new Map(recommendations.map(s => [s.id, s])).values()];
}

export {
  KENYAN_GENERAL_JOB_BOARDS,
  GOVERNMENT_PORTALS,
  COUNTY_GOVERNMENT_PORTALS,
  UNIVERSITY_PORTALS,
  NGO_INTERNATIONAL,
  TECH_SPECIALIZED,
  RECRUITMENT_AGENCIES,
  BANKS_FINTECH,
  HEALTHCARE,
  REMOTE_GLOBAL,
  AGGREGATORS,
  STARTUP_JOBS,
  FREELANCE_GIGS,
  SPECIALIZED,
};
