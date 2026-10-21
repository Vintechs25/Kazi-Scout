/**
 * Enhanced Job Search Service (Next Generation)
 * 
 * Features:
 * - CV-guided job discovery (uses roles extracted from CV)
 * - User-approved role selection
 * - Advanced filtering system
 * - Multi-source scraping with aggressive strategies
 * - Requirement verification (checks application instructions)
 * - Comprehensive job matching with skill analysis
 * 
 * This replaces the old job-search-service.ts with a more powerful, ethical, and effective approach.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, gte, inArray, like, ne, or } from "drizzle-orm";
import { db, jobsTable, jobSourcesTable, jobProvenanceTable, activityTable, cvsTable, cvParsingResultsTable, jobRequirementVerificationsTable } from "@workspace/db";
import { getUserEnabledRoles, getUserDiscoverySettings, updateDiscoverySettings } from "./discovery-role-approval";
import { COMPREHENSIVE_KENYA_JOB_SOURCES, SOURCE_BY_ID, getEnabledSources, getSourcesByCategory } from "./kenya-job-sources-comprehensive";
import { parseCvComprehensive, getParsedCv } from "./cv-parser-enhanced";
import { fingerprintJob, normalizeCompany, normalizeText } from "./job-deduplication";
import { splitJobSections, extractContextualYears, extractSkillsFromText, COMPREHENSIVE_SKILL_SYNONYMS } from "./section-parser";
import { evaluatePreIngestionGate } from "./pre-ingestion-gate";
import { getOrGenerateSearchDirective, type SearchDirective } from "./search-directive";
import { getOrGenerateCandidateEvidence } from "./candidate-evidence";
import { verifyJobAgainstUserProfile } from "./requirement-verification-system";
import type { NormalizedJob, JobSearchFilter } from "./job-search-service";
import { validateListing } from "./ingestion-contract";
import { SourceRouter } from "./source-router";
import { aggressiveCrawlKenya, crawlJobsByKeywords, type CrawledJob } from "./connectors/kenya-aggressive-crawler";
import { batchEvaluateQualifiedJobs } from "./ai-job-evaluator";
import { getVerifiedMasterCv } from "./cv-storage";

// ============================================================================
// TYPES
// ============================================================================

export interface DiscoveryResult {
  discovered: number;
  duplicates: number;
  matched: number;
  highMatches: EnrichedJob[];
  mediumMatches: EnrichedJob[];
  lowMatches: EnrichedJob[];
  rejected: number;
  gateRejected?: number;
  validationRejected?: number;
  errors: string[];
  sourcesScraped: string[];
  executionTime: number;
  rolesSearched: string[];
  aiStatus?: "ONLINE" | "DEGRADED" | "OFFLINE";
  aiError?: string | null;
  aiProviderUsed?: string;
  aiModelUsed?: string;
}

export interface JobDiscoveryConfig {
  accountId: string;
  roles?: string[]; // Override user's enabled roles
  sources?: string[]; // Specific sources to scrape
  filters?: EnhancedJobSearchFilter;
  aggressiveMode?: boolean; // Use aggressive scraping techniques
  bypassRestrictions?: boolean; // "Bend laws" mode
  verifyRequirements?: boolean; // Always check application instructions
  maxJobs?: number; // Max jobs to discover
  timeout?: number; // Timeout in milliseconds
}

export interface EnhancedJobSearchFilter extends JobSearchFilter {
  roleTitles?: string[];
  roleIds?: string[];
  sourceIds?: string[];
  excludeSourceIds?: string[];
  verifiedOnly?: boolean; // Only jobs that have been verified for requirements
  minMatchScore?: number;
  requireApplicationInstructions?: boolean; // Must have clear application instructions
  dateRangeDays?: number; // Only jobs posted within X days
}

export interface RequirementVerification {
  hasClearInstructions: boolean;
  applicationMethod: "online" | "email" | "portal" | "walk_in" | "unknown";
  applicationUrl: string | null;
  applicationEmail: string | null;
  deadline: Date | null;
  requiredDocuments: string[];
  specialInstructions: string[];
  eligibilityRequirements: string[];
  isVerified: boolean;
  verificationNotes: string[];
}

export interface EnrichedJob extends NormalizedJob {
  requirementVerification: RequirementVerification;
  cvMatchScore: number;
  cvMatchedSkills: string[];
  cvMissingSkills: string[];
  roleMatchScore: number;
  isRequirementVerified: boolean;
}

// ============================================================================
// SOURCE CONNECTOR REGISTRY
// ============================================================================

import { getConnectorForSource } from "./connectors/registry";

// Enhanced source list with our comprehensive Kenya sources
const ENHANCED_JOB_SOURCES = [
  ...COMPREHENSIVE_KENYA_JOB_SOURCES,
  // Add any legacy sources that might be in the database
];

// ============================================================================
// REQUIREMENT VERIFICATION SYSTEM
// ============================================================================

/**
 * Extract application instructions from job description
 */
function extractApplicationInstructions(description: string): RequirementVerification {
  const instructions: string[] = [];
  const requiredDocs: string[] = [];
  const eligibility: string[] = [];
  
  const lower = description.toLowerCase();
  
  // Extract application method
  let applicationMethod: RequirementVerification["applicationMethod"] = "unknown";
  let applicationUrl: string | null = null;
  let applicationEmail: string | null = null;
  let deadline: Date | null = null;
  
  // Check for online application
  if (/apply online|apply now|click here to apply|application form|apply below/i.test(lower)) {
    applicationMethod = "online";
    // Try to extract URL
    const urlMatch = description.match(/(https?:\/\/[^\s]+)/i);
    if (urlMatch) {
      applicationUrl = urlMatch[0];
    }
  }
  
  // Check for email application
  if (/apply via email|send cv to|email your application|email:\s*[\w.@-]+/i.test(lower)) {
    applicationMethod = "email";
    const emailMatch = description.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
    if (emailMatch) {
      applicationEmail = emailMatch[0];
    }
  }
  
  // Check for portal application
  if (/career portal|recruitment portal|jobs portal|apply through our portal/i.test(lower)) {
    applicationMethod = "portal";
  }
  
  // Check for walk-in
  if (/walk in|walk-in|walkin|apply in person|bring your cv/i.test(lower)) {
    applicationMethod = "walk_in";
  }
  
  // Extract deadline
  const deadlinePatterns = [
    /deadline:\s*([\w\s,]+\d{4})/i,
    /closing date:\s*([\w\s,]+\d{4})/i,
    /apply by\s*([\w\s,]+\d{4})/i,
    /application deadline:\s*([\w\s,]+\d{4})/i,
    /submission deadline:\s*([\w\s,]+\d{4})/i,
  ];
  
  for (const pattern of deadlinePatterns) {
    const match = description.match(pattern);
    if (match) {
      try {
        deadline = new Date(match[1]);
        if (!isNaN(deadline.getTime())) break;
      } catch {
        // Ignore
      }
    }
  }
  
  // Extract required documents
  const docPatterns = [
    { pattern: /cv|resume|curriculum vitae/i, doc: "CV/Resume" },
    { pattern: /cover letter|covering letter/i, doc: "Cover Letter" },
    { pattern: /certificate|certificates|academic certificates/i, doc: "Certificates" },
    { pattern: /testimonial|testimonials/i, doc: "Testimonials" },
    { pattern: /id|identity card|passport/i, doc: "ID/Passport" },
    { pattern: /application letter/i, doc: "Application Letter" },
    { pattern: /portfolio/i, doc: "Portfolio" },
    { pattern: /transcript|academic transcript/i, doc: "Academic Transcript" },
  ];
  
  for (const { pattern, doc } of docPatterns) {
    if (pattern.test(lower) && !requiredDocs.includes(doc)) {
      requiredDocs.push(doc);
    }
  }
  
  // Extract eligibility requirements
  const eligibilityPatterns = [
    { pattern: /minimum\s+(\d+)\s*years?\s*experience/i, req: "Minimum experience required" },
    { pattern: /bachelor|degree|diploma/i, req: "Specific degree/qualification required" },
    { pattern: /must have|required|must possess/i, req: "Specific skills/requirements" },
    { pattern: /kenyan citizen|must be kenyan/i, req: "Kenyan citizenship required" },
    { pattern: /age\s+\d+/i, req: "Age requirement" },
    { pattern: /gender|male|female/i, req: "Gender specification" },
  ];
  
  for (const { pattern, req } of eligibilityPatterns) {
    if (pattern.test(lower) && !eligibility.includes(req)) {
      eligibility.push(req);
    }
  }
  
  // Extract special instructions
  const specialInstructions: string[] = [];
  if (/do not apply|don't apply|not eligible/i.test(lower)) {
    specialInstructions.push("Has exclusion criteria");
  }
  if (/no phone calls|strictly no calls/i.test(lower)) {
    specialInstructions.push("No phone calls");
  }
  if (/email only|strictly email/i.test(lower)) {
    specialInstructions.push("Email only");
  }
  
  // Determine if verified
  const hasClearInstructions = applicationMethod !== "unknown" || applicationUrl !== null || applicationEmail !== null;
  const isVerified = hasClearInstructions && (requiredDocs.length > 0 || eligibility.length > 0);
  
  // Add verification notes
  const verificationNotes: string[] = [];
  if (!hasClearInstructions) {
    verificationNotes.push("No clear application instructions found");
  }
  if (requiredDocs.length === 0) {
    verificationNotes.push("No required documents specified");
  }
  if (eligibility.length === 0) {
    verificationNotes.push("No eligibility requirements specified");
  }
  if (!deadline) {
    verificationNotes.push("No deadline specified");
  }
  
  return {
    hasClearInstructions,
    applicationMethod,
    applicationUrl,
    applicationEmail,
    deadline,
    requiredDocuments: requiredDocs,
    specialInstructions,
    eligibilityRequirements: eligibility,
    isVerified,
    verificationNotes,
  };
}

/**
 * Verify job requirements against user's CV
 */
async function verifyJobRequirements(
  job: NormalizedJob,
  accountId: string,
): Promise<EnrichedJob> {
  // Get user's master CV parsing results
  const [parsedResult] = await db
    .select()
    .from(cvParsingResultsTable)
    .where(and(
      eq(cvParsingResultsTable.accountId, accountId),
    ))
    .orderBy(desc(cvParsingResultsTable.parsedAt))
    .limit(1);
  
  let parsedCv = null;
  if (parsedResult) {
    try {
      parsedCv = {
        workExperience: parsedResult.workExperience || [],
        education: parsedResult.education || [],
        skills: {
          technical: parsedResult.technicalSkills || [],
          soft: parsedResult.softSkills || [],
        },
        extractedRoles: parsedResult.extractedRoles || [],
      };
    } catch {
      // Invalid JSON, skip
    }
  }
  
  // Extract skills from job
  const jobSkills = extractSkillsFromText(
    `${job.title} ${job.description} ${job.company} ${job.location || ''}`
  );
  
  // Extract skills from CV
  const cvSkills = parsedCv?.skills.technical || [];
  
  // Calculate skill match
  const matchedSkills = jobSkills.filter(skill => cvSkills.includes(skill));
  const missingSkills = jobSkills.filter(skill => !cvSkills.includes(skill));
  const matchScore = Math.round((matchedSkills.length / Math.max(jobSkills.length, 1)) * 100);
  
  // Get role match score
  const { roles: enabledRoles } = await getUserEnabledRoles(accountId);
  const roleMatchScore = enabledRoles.some(role => 
    job.title.toLowerCase().includes(role.toLowerCase()) ||
    job.description.toLowerCase().includes(role.toLowerCase())
  ) ? 80 : 30;
  
  // Verify application instructions
  const requirementVerification = extractApplicationInstructions(job.description || '');
  
  return {
    ...job,
    requirementVerification,
    cvMatchScore: matchScore,
    cvMatchedSkills: matchedSkills,
    cvMissingSkills: missingSkills,
    roleMatchScore,
    isRequirementVerified: requirementVerification.isVerified,
  };
}

// ============================================================================
// ENHANCED JOB DISCOVERY
// ============================================================================

/**
 * Discover jobs using CV-guided role-based search
 */
export async function discoverJobsWithCvGuidance(
  config: JobDiscoveryConfig,
): Promise<DiscoveryResult> {
  const startTime = Date.now();
  const {
    accountId,
    roles: overrideRoles,
    sources: overrideSources,
    filters = {} as EnhancedJobSearchFilter,
    aggressiveMode = false,
    bypassRestrictions = false,
    verifyRequirements = true,
    maxJobs = 200,
    timeout = 300000, // 5 minutes
  } = config;
  
  const errors: string[] = [];
  const discoveredJobs: EnrichedJob[] = [];
  const sourcesScraped: string[] = [];
  const duplicateFingerprints = new Set<string>();
  
  try {
    // Get user's role preferences
    const { roles: userRoles, searchQueries } = await getUserEnabledRoles(accountId);
    const rolesToSearch = overrideRoles || userRoles;
    
    if (rolesToSearch.length === 0) {
      throw new Error("No roles enabled for discovery. Please enable roles in settings.");
    }
    
    // Get user's discovery settings
    const settings = await getUserDiscoverySettings(accountId);
    
    // Build search queries from roles
    const allSearchQueries = overrideRoles
      ? overrideRoles.flatMap(role => generateSearchQueriesForRole(role))
      : searchQueries;
    
    // 1. Route sources tailored to user's structured profile
    let sourcesToScrape: any[] = [];
    try {
      if (overrideSources && overrideSources.length > 0) {
        sourcesToScrape = overrideSources.map(id => SOURCE_BY_ID[id]).filter(Boolean);
      } else {
        const routed: any = await SourceRouter.routeSourcesForProfile(accountId || "primary", rolesToSearch);
        sourcesToScrape = Array.isArray(routed) ? routed.map((r: any) => r.source) : [];
      }
    } catch {
      sourcesToScrape = [];
    }

    if (!sourcesToScrape || sourcesToScrape.length === 0) {
      const allEnabledSources = overrideSources
        ? overrideSources.map(id => SOURCE_BY_ID[id]).filter(Boolean)
        : getEnabledSources();
      sourcesToScrape = allEnabledSources;
    }

    // Apply user discovery settings filters
    if (!settings.enableAllKenyaSources) {
      sourcesToScrape = sourcesToScrape.filter(s => s.country !== "Kenya");
    }
    if (!settings.enableGlobalRemoteSources) {
      sourcesToScrape = sourcesToScrape.filter(s => s.country === "Kenya");
    }
    if (!settings.enableRecruitmentAgencies) {
      sourcesToScrape = sourcesToScrape.filter(s => s.category !== "RECRUITMENT_AGENCY" && s.sourceKind !== "RECRUITER");
    }
    
    // Apply excluded sources
    if (settings.excludedSourceIds.length > 0) {
      const excludedIds = new Set(settings.excludedSourceIds);
      sourcesToScrape = sourcesToScrape.filter(s => !excludedIds.has(s.id));
    }

    // Limit active sources per run
    const maxSources = aggressiveMode ? 50 : 25;
    sourcesToScrape = sourcesToScrape.slice(0, maxSources);
    
    // Generous per-source limit so rich feeds yield full batches of listings
    const perSourceLimit = Math.max(50, Math.ceil(maxJobs / Math.max(1, Math.min(sourcesToScrape.length, 8))));

    // Track progress
    let jobsDiscovered = 0;
    let jobsMatched = 0;
    let highMatches: EnrichedJob[] = [];
    let mediumMatches: EnrichedJob[] = [];
    let lowMatches: EnrichedJob[] = [];
    let jobsRejected = 0;
    let duplicateCount = 0;
    let gateRejectedCount = 0;
    let validationRejectedCount = 0;

    // Fetch directive dynamically tailored to active searched roles
    const directive = await getOrGenerateSearchDirective(accountId, false, rolesToSearch);

    // Parallel Kenya crawler: hits verified Kenyan sources tailored to the candidate's field
    try {
      const crawlLimit = aggressiveMode ? Math.min(Math.max(maxJobs, 500), 1000) : Math.min(Math.max(maxJobs, 250), 500);
      const crawledJobs = await crawlJobsByKeywords(rolesToSearch, crawlLimit);
      console.log(`[KenyaCrawl] Crawler returned ${crawledJobs.length} jobs across career fields (aggressiveMode=${aggressiveMode})`);
      for (const cj of crawledJobs) {
        if (discoveredJobs.length >= (aggressiveMode ? maxJobs * 2 : maxJobs)) break;
        const fingerprint = fingerprintJob({ company: cj.company, title: cj.title, location: cj.location ?? null, description: cj.description });
        if (duplicateFingerprints.has(fingerprint)) { duplicateCount++; continue; }
        duplicateFingerprints.add(fingerprint);
        const validation = validateListing({ title: cj.title, company: cj.company, url: cj.url, description: cj.description, deadline: null });
        if (!validation.valid) { validationRejectedCount++; continue; }

        // Evaluate pre-ingestion qualification gate upfront
        const gateResult = evaluatePreIngestionGate({
          title: cj.title,
          company: cj.company,
          location: cj.location ?? null,
          remote: cj.remote,
          description: cj.description,
          source: cj.sourceId,
          sourceUrl: cj.sourceUrl,
          jobType: cj.jobType ?? undefined,
        }, directive);

        if (!gateResult.qualified) {
          gateRejectedCount++;
          jobsRejected++;
          continue;
        }

        const normalized: NormalizedJob = {
          id: cj.id,
          title: cj.title, company: cj.company,
          location: cj.location ?? null,
          remote: cj.remote,
          salary: cj.salary ?? null,
          source: cj.sourceId,
          sourceUrl: cj.sourceUrl,
          externalJobId: cj.externalJobId ?? null,
          description: cj.description || "",
          discoveredAt: new Date(),
          normalizedCompany: normalizeCompany(cj.company),
          normalizedTitle: normalizeText(cj.title),
          normalizedLocation: normalizeText(cj.location || ""),
          jobType: cj.jobType ?? undefined,
        };
        discoveredJobs.push({ ...normalized,
          requirementVerification: { hasClearInstructions: false, applicationMethod: "online", applicationUrl: cj.url, applicationEmail: null, deadline: null, requiredDocuments: [], specialInstructions: [], eligibilityRequirements: [], isVerified: false, verificationNotes: [] } as any,
          cvMatchScore: 0, cvMatchedSkills: [], cvMissingSkills: [], roleMatchScore: 0, isRequirementVerified: false,
        });
        if (!sourcesScraped.includes(cj.sourceId)) sourcesScraped.push(cj.sourceId);
        jobsDiscovered++;
      }
    } catch (crawlErr: any) {
      errors.push(`KenyaCrawl failed: ${crawlErr?.message || crawlErr}`);
    }
    
    // Scrape each source
    for (const source of sourcesToScrape) {
      if (Date.now() - startTime > timeout) {
        errors.push(`Timeout reached after ${sourcesScraped.length} sources`);
        break;
      }

      if (jobsDiscovered >= maxJobs) {
        break;
      }
      
      try {
        sourcesScraped.push(source.id);
        
        // Get connector for this source
        const connector = getConnectorForSource(source);
        
        if (!connector) {
          errors.push(`No connector found for source: ${source.id}`);
          continue;
        }
        
        // Scrape or discover listings from this source with an 8s timeout guard
        let sourceJobs: any[] = [];
        const t0 = Date.now();
        try {
          const fetchPromise = (typeof (connector as any).scrape === "function")
            ? (connector as any).scrape({
                source,
                roles: rolesToSearch,
                searchQueries: allSearchQueries,
                filters,
                aggressiveMode,
                bypassRestrictions,
                maxJobs: perSourceLimit,
              })
            : connector.discoverListings(source as any, {
                keywords: rolesToSearch,
                limit: perSourceLimit,
              });

          const timeoutPromise = new Promise<any[]>((_, reject) =>
            setTimeout(() => reject(new Error("Source crawl timed out after 12s")), 12000),
          );

          sourceJobs = await Promise.race([fetchPromise, timeoutPromise]);
          console.log(`[Discovery] Scraped ${source.id} (${source.name}): yielded ${sourceJobs.length} listings in ${Date.now() - t0}ms`);
        } catch (srcErr: any) {
          const errMsg = srcErr?.message || String(srcErr);
          console.warn(`[Discovery] Source ${source.id} skipped: ${errMsg}`);
          errors.push(`Source ${source.name || source.id}: ${errMsg}`);
          continue;
        }

        if (!sourceJobs || sourceJobs.length === 0) {
          continue;
        }
        
        // Process each job
        for (const job of sourceJobs) {
          if (jobsDiscovered >= maxJobs) break;
          
          // 1. Hard validation gate: discard stub queries, search URLs, missing employer, or short stubs
          const validation = validateListing({
            title: job.title,
            company: job.company,
            url: job.sourceUrl || job.url || source.canonicalUrl,
            description: job.description,
            deadline: job.deadline,
          });
          if (!validation.valid) {
            validationRejectedCount++;
            jobsRejected++;
            continue;
          }

          // Check for duplicates
          const fingerprint = fingerprintJob({
            company: job.company,
            title: job.title,
            location: job.location ?? null,
            description: job.description,
          });
          if (duplicateFingerprints.has(fingerprint)) {
            duplicateCount++;
            jobsRejected++;
            continue;
          }
          duplicateFingerprints.add(fingerprint);
          
          // Apply pre-ingestion gate
          const gateResult = evaluatePreIngestionGate({
            ...job,
            location: job.location ?? null,
            jobType: job.jobType ?? undefined,
          }, directive);
          
          if (!gateResult.qualified) {
            gateRejectedCount++;
            jobsRejected++;
            console.log(`[Discovery Gate] Disqualified "${job.title}" (${job.company}): ${gateResult.rejectionReason}`);
            continue;
          }

          const normalizedJob: NormalizedJob = {
            id: job.id || randomUUID(),
            title: job.title,
            company: job.company,
            location: job.location ?? null,
            remote: !!job.remote,
            salary: job.salary ?? null,
            source: source.id,
            sourceUrl: job.sourceUrl || source.canonicalUrl,
            externalJobId: job.externalJobId ?? null,
            description: job.description || "",
            discoveredAt: new Date(),
            normalizedCompany: normalizeCompany(job.company),
            normalizedTitle: normalizeText(job.title),
            normalizedLocation: normalizeText(job.location || ""),
            jobType: job.jobType ?? undefined,
          };
          
          // Verify requirements if enabled
          if (verifyRequirements) {
            const verificationResult = await verifyJobAgainstUserProfile(normalizedJob, accountId);
            
            if (filters?.requireApplicationInstructions && (!verificationResult.requirementVerification || !verificationResult.requirementVerification.hasClearInstructions) && (!normalizedJob.sourceUrl || !normalizedJob.sourceUrl.startsWith("http"))) {
              jobsRejected++;
              continue;
            }
            
            // Store enriched job for matching
            discoveredJobs.push({
              ...normalizedJob,
              requirementVerification: verificationResult.requirementVerification as any,
              cvMatchScore: 0,
              cvMatchedSkills: [],
              cvMissingSkills: [],
              roleMatchScore: 0,
              isRequirementVerified: verificationResult.canApply,
            });
          } else {
            discoveredJobs.push({
              ...normalizedJob,
              requirementVerification: { hasClearInstructions: false, applicationMethod: "unknown", applicationUrl: null, applicationEmail: null, deadline: null, requiredDocuments: [], specialInstructions: [], eligibilityRequirements: [], isVerified: false, verificationNotes: ["Requirement verification disabled"] } as any,
              cvMatchScore: 0,
              cvMatchedSkills: [],
              cvMissingSkills: [],
              roleMatchScore: 0,
              isRequirementVerified: false,
            });
          }
          
          jobsDiscovered++;
          if (jobsDiscovered >= maxJobs) break;
        }

        if (jobsDiscovered >= maxJobs) {
          break;
        }
      } catch (err) {
        errors.push(`Error scraping ${source.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    
    // Match discovered jobs against searched roles & candidate profile
    const candidateEvidence = await getOrGenerateCandidateEvidence(accountId);

    type ScoredDiscoveredJob = {
      job: any;
      roleMatchPct: number;
      isExplicitNonMedicalRole: boolean;
      prelimCvMatchScore: number;
      prelimStatus: "MATCHED" | "NEEDS_REVIEW" | "REJECTED";
      prelimAiDecision: "STRONG_MATCH" | "POTENTIAL_MATCH" | "NOT_A_MATCH" | "INELIGIBLE";
      prelimHardEligibilityFailure: boolean;
      prelimRejectionReason: string | null;
      jobSkills: string[];
      matchedSkills: string[];
    };

    const scoredJobs: ScoredDiscoveredJob[] = [];
    
    for (const job of discoveredJobs) {
      // 1. Calculate role match against active search roles
      const titleLower = (job.title || "").toLowerCase();
      const descLower = (job.description || "").toLowerCase();
      
      const GENERIC_ROLE_MODIFIERS = new Set([
        "consultant", "specialist", "officer", "manager", "associate", "coordinator",
        "lead", "senior", "junior", "general", "assistant", "director", "executive",
        "intern", "trainee", "advisor", "expert", "analyst", "practitioner", "head",
        "chief", "staff", "representative", "agent", "partner", "technician", "worker", "support"
      ]);

      const hasMedicalTarget = rolesToSearch.some(r => /surgeon|doctor|physician|clinical|medical|health|nurse/i.test(r));
      const hasDevTarget = !hasMedicalTarget && rolesToSearch.some(r => /developer|programmer|software|frontend|backend|fullstack|devops/i.test(r));
      const hasFinanceTarget = !hasMedicalTarget && rolesToSearch.some(r => /account|audit|finance|cpa|acca|tax|treasury/i.test(r));
      const hasAgriTarget = !hasMedicalTarget && rolesToSearch.some(r => /agric|agronom|farm|crop|livestock|horticultur|agribusiness/i.test(r));
      const hasNgoTarget = !hasMedicalTarget && rolesToSearch.some(r => /ngo|humanitarian|project|m&e|monitoring|grants|community|wash/i.test(r));
      const hasProcurementTarget = !hasMedicalTarget && rolesToSearch.some(r => /procurement|supply\s+chain|logistics|warehouse|purchasing|inventory/i.test(r));
      const hasHrTarget = !hasMedicalTarget && rolesToSearch.some(r => /human\s+resources|hr\b|talent|people\s+and\s+culture|recruiter/i.test(r));
      const hasLegalTarget = !hasMedicalTarget && rolesToSearch.some(r => /legal|lawyer|attorney|counsel|compliance|advocate/i.test(r));

      // Hard cross-domain check for Medical candidates:
      // Disqualify travel, customer support, SAP, sales, real estate, accounting, driver, chef, IT dev, etc.
      const isExplicitNonMedicalRole = /\b(travel|tourism|flight|hotel|hospitality|customer\s+support|customer\s+service|call\s+center|helpdesk|sap\b|salesforce|erp\b|real\s+estate|receptionist|cashier|waiter|chef|bartender|driver|sales\s+representative|telemarketing|sales\s+executive|software\s+developer|fullstack|frontend|backend|devops|react|python|java\b|php\b|accounting|internal\s+auditor|tax\s+officer|legal\s+counsel|lawyer|attorney|android|ios|engineer|sales\s+&\s+cx|cx\s+enablement|knowledge\s+management|implementation\s+consultant|management\s+consultant|strategy\s+consultant|business\s+consultant|post-doctoral|postdoc|health\s+coach|wellness\s+coach|health\s+economi|clinical\s+applications|applications\s+associate|applications\s+specialist|epic\s+analyst|cadence|mychart|ehr\s+analyst)\b/i.test(titleLower);

      let roleMatchPct = 0;

      if (hasMedicalTarget && isExplicitNonMedicalRole) {
        roleMatchPct = 0;
      } else {
        for (const r of rolesToSearch) {
          const rLower = r.toLowerCase().trim();
          // Full phrase match in title: e.g. "consultant surgeon"
          if (new RegExp(`\\b${rLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(titleLower)) {
            roleMatchPct = Math.max(roleMatchPct, 95);
            continue;
          }

          // Substantive words: words that are NOT generic modifiers
          const words = rLower.split(/\s+/).filter(w => w.length >= 4 && !GENERIC_ROLE_MODIFIERS.has(w));
          if (words.length > 0) {
            if (words.every(w => new RegExp(`\\b${w}\\b`, "i").test(titleLower))) {
              roleMatchPct = Math.max(roleMatchPct, 90);
            } else if (words.some(w => new RegExp(`\\b${w}\\b`, "i").test(titleLower))) {
              roleMatchPct = Math.max(roleMatchPct, 80);
            } else if (!isExplicitNonMedicalRole && words.filter(w => new RegExp(`\\b${w}\\b`, "i").test(descLower)).length >= 2) {
              roleMatchPct = Math.max(roleMatchPct, 50);
            }
          }
        }
      }

      // Developer <-> Engineer synonym matching in technical fields
      if (hasDevTarget && roleMatchPct < 70) {
        if (/engineer|architect/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 80);
        }
      }

      // Medical & Clinical role matching synonyms
      if (hasMedicalTarget) {
        if (/\b(surgeon|surgery|consultant\s+surgeon|general\s+surgeon|orthopedic\s+surgeon|neurosurgeon|trauma\s+surgeon)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 95);
        } else if (/\b(medical\s+officer|medical\s+doctor|physician|general\s+practitioner|senior\s+medical\s+officer|resident\s+doctor)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 92);
        } else if (/\b(clinical\s+officer|clinical\s+specialist|medical\s+specialist|consultant\s+doctor|specialist\s+physician)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 90);
        } else if (/\b(doctor|physician|health\s+officer|locum\s+doctor|hospital\s+doctor)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 85);
        } else if (/\b(medical|clinical|healthcare|hospital)\b/i.test(titleLower) && /\b(doctor|officer|specialist|surgeon)\b/i.test(descLower)) {
          roleMatchPct = Math.max(roleMatchPct, 80);
        }
      }

      // Finance & Accounting role matching synonyms
      if (hasFinanceTarget) {
        if (/\b(accountant|senior\s+accountant|chief\s+accountant|chartered\s+accountant)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 95);
        } else if (/\b(auditor|internal\s+auditor|finance\s+officer|financial\s+analyst)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 92);
        } else if (/\b(accounts\s+assistant|tax\s+officer|treasury\s+officer|credit\s+analyst|payroll)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 88);
        } else if (/\b(finance|accounting|audit)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 85);
        }
      }

      // Agriculture & Agribusiness role matching synonyms
      if (hasAgriTarget) {
        if (/\b(agronomist|agricultural\s+officer|farm\s+manager|farm\s+operations)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 95);
        } else if (/\b(agribusiness|livestock\s+officer|crop\s+specialist|extension\s+officer)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 90);
        } else if (/\b(agriculture|farming|horticulture|food\s+production)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 85);
        }
      }

      // NGO & Development role matching synonyms
      if (hasNgoTarget) {
        if (/\b(project\s+coordinator|project\s+officer|program\s+manager|program\s+officer)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 95);
        } else if (/\b(m&e\s+officer|monitoring\s+and\s+evaluation|grants\s+officer|compliance\s+officer)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 92);
        } else if (/\b(humanitarian|community\s+development|wash\s+officer|field\s+officer)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 88);
        }
      }

      // Procurement & Logistics role matching synonyms
      if (hasProcurementTarget) {
        if (/\b(procurement\s+officer|supply\s+chain\s+specialist|logistics\s+manager)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 95);
        } else if (/\b(logistics\s+officer|warehouse\s+manager|purchasing\s+officer|inventory\s+controller)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 90);
        } else if (/\b(stores\s+officer|supply\s+chain|procurement|logistics)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 85);
        }
      }

      // Human Resources role matching synonyms
      if (hasHrTarget) {
        if (/\b(hr\s+officer|human\s+resources\s+officer|talent\s+acquisition|people\s+and\s+culture)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 95);
        } else if (/\b(hr\s+generalist|recruiter|hr\s+assistant|personnel\s+officer)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 90);
        }
      }

      // Legal & Compliance role matching synonyms
      if (hasLegalTarget) {
        if (/\b(legal\s+counsel|advocate|lawyer|attorney|legal\s+officer)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 95);
        } else if (/\b(compliance\s+officer|legal\s+assistant|paralegal)\b/i.test(titleLower)) {
          roleMatchPct = Math.max(roleMatchPct, 88);
        }
      }

      // 2. Extract and match skills
      const jobSkills = extractSkillsFromText(
        `${job.title} ${job.description} ${job.company} ${job.location || ''}`
      );
      
      const candidateSkills = [
        ...candidateEvidence.demonstratedTechnicalSkills,
        ...candidateEvidence.selfReportedSkills,
        ...(directive.requiredSkills || []),
        ...(hasMedicalTarget ? [
          "patient care", "clinical", "surgery", "diagnosis", "medicine",
          "treatment", "emergency", "inpatient", "outpatient", "healthcare",
          "hospital", "consultation", "medical officer"
        ] : []),
        ...(hasFinanceTarget ? ["financial reporting", "accounting", "auditing", "tax", "budgeting", "cpa", "reconciliation"] : []),
        ...(hasAgriTarget ? ["agronomy", "crop management", "farm management", "soil analysis", "agribusiness"] : []),
        ...(hasNgoTarget ? ["project management", "monitoring & evaluation", "grant writing", "community mobilization", "reporting"] : []),
        ...(hasProcurementTarget ? ["procurement", "supply chain", "logistics", "vendor management", "inventory control"] : []),
        ...(hasHrTarget ? ["recruitment", "employee relations", "labor laws", "payroll", "performance management"] : []),
        ...(hasLegalTarget ? ["legal drafting", "compliance", "litigation", "contract review", "regulatory"] : []),
      ];

      const matchedSkills = jobSkills.filter(skill => 
        candidateSkills.some(cs => cs.toLowerCase() === skill.toLowerCase() || skill.toLowerCase().includes(cs.toLowerCase()) || cs.toLowerCase().includes(skill.toLowerCase()))
      );
      
      const skillMatchPct = jobSkills.length > 0
        ? Math.round((matchedSkills.length / Math.min(jobSkills.length, 5)) * 100)
        : (roleMatchPct > 0 ? 80 : 20);

      // 3. Combined Score: 60% role match + 20% skills + 10% location + 10% verified instructions
      const hasInstructions = Boolean(
        job.requirementVerification?.hasClearInstructions ||
        job.sourceUrl?.startsWith("http") ||
        /apply|cv|email|portal|deadline/i.test(job.description || "")
      );

      const prelimCvMatchScore = Math.min(
        100,
        Math.max(
          roleMatchPct > 0 ? 30 : 0,
          Math.round(
            (roleMatchPct > 0 ? roleMatchPct : 0) * 0.6 +
            Math.max(skillMatchPct, roleMatchPct >= 85 ? 75 : 0) * 0.2 +
            (job.location?.toLowerCase().includes("kenya") ? 10 : 5) +
            (hasInstructions ? 10 : 5)
          )
        )
      );

      let prelimStatus: "MATCHED" | "NEEDS_REVIEW" | "REJECTED" = "REJECTED";
      let prelimAiDecision: "STRONG_MATCH" | "POTENTIAL_MATCH" | "NOT_A_MATCH" | "INELIGIBLE" = "NOT_A_MATCH";
      let prelimHardEligibilityFailure = false;
      let prelimRejectionReason: string | null = null;

      if (roleMatchPct >= 70 && prelimCvMatchScore >= 70 && !isExplicitNonMedicalRole) {
        prelimStatus = "MATCHED";
        prelimAiDecision = "STRONG_MATCH";
      } else if (roleMatchPct >= 50 && prelimCvMatchScore >= 50 && !isExplicitNonMedicalRole) {
        prelimStatus = "NEEDS_REVIEW";
        prelimAiDecision = "POTENTIAL_MATCH";
      } else {
        prelimStatus = "REJECTED";
        prelimAiDecision = "NOT_A_MATCH";
        prelimHardEligibilityFailure = true;
        prelimRejectionReason = isExplicitNonMedicalRole
          ? "Disqualified: Non-medical listing"
          : "Listing does not match candidate's approved target roles";
      }

      scoredJobs.push({
        job,
        roleMatchPct,
        isExplicitNonMedicalRole,
        prelimCvMatchScore,
        prelimStatus,
        prelimAiDecision,
        prelimHardEligibilityFailure,
        prelimRejectionReason,
        jobSkills,
        matchedSkills,
      });
    }

    // ━━━ AI CORE BRAIN EVALUATION ━━━
    // Send qualified candidate opportunities to real AI (Gemini / OpenAI / OpenRouter)
    const candidatesForAi = scoredJobs
      .filter((s) => s.roleMatchPct >= 50 && !s.isExplicitNonMedicalRole)
      .slice(0, 40)
      .map((s) => s.job);

    let aiEvaluations: any = new Map();
    let aiStatus: "ONLINE" | "DEGRADED" | "OFFLINE" = "OFFLINE";
    let aiErrors: string[] = [];
    let aiProviderUsed = "none";
    let aiModelUsed = "none";

    if (candidatesForAi.length > 0) {
      try {
        const cvDoc = await getVerifiedMasterCv().catch(() => ({ text: "" }));
        aiEvaluations = await batchEvaluateQualifiedJobs(
          candidatesForAi,
          candidateEvidence,
          cvDoc.text.slice(0, 3000),
          4,
        );
        aiStatus = aiEvaluations.aiStatus || "OFFLINE";
        aiErrors = aiEvaluations.errors || [];
        aiProviderUsed = aiEvaluations.providerUsed || "none";
        aiModelUsed = aiEvaluations.modelUsed || "none";

        if (aiErrors.length > 0) {
          errors.push(`[AI Brain Error]: ${aiErrors.join(" | ")}`);
        }
      } catch (aiErr: any) {
        aiStatus = "OFFLINE";
        const msg = aiErr?.message || String(aiErr);
        aiErrors.push(msg);
        errors.push(`[AI Brain Error]: AI evaluation halted: ${msg}`);
      }
    }

    // Persist all jobs with AI judgments
    for (const scored of scoredJobs) {
      const { job, roleMatchPct, isExplicitNonMedicalRole, prelimCvMatchScore, prelimStatus, prelimAiDecision, prelimHardEligibilityFailure, prelimRejectionReason, jobSkills, matchedSkills: prelimMatchedSkills } = scored;
      const aiEval = aiEvaluations.get(job.id);

      let cvMatchScore = prelimCvMatchScore;
      let status: "MATCHED" | "NEEDS_REVIEW" | "REJECTED" = prelimStatus;
      let aiDecision: "STRONG_MATCH" | "POTENTIAL_MATCH" | "NOT_A_MATCH" | "INSUFFICIENT_INFORMATION" | "INELIGIBLE" = prelimAiDecision;
      let hardEligibilityFailure = prelimHardEligibilityFailure;
      let rejectionReason: string | null = prelimRejectionReason;
      let matchReason = "Preliminary role and qualification match.";
      let isAiVerified = false;
      let providerUsed = "heuristic";
      let modelUsed = "pre-ingestion";
      let finalMatchedSkills = prelimMatchedSkills;
      let finalMissingSkills = jobSkills.filter((s) => !prelimMatchedSkills.includes(s));

      if (aiEval && aiEval.isAiVerified) {
        cvMatchScore = aiEval.matchScore;
        aiDecision = aiEval.decision;
        hardEligibilityFailure = aiEval.hardEligibilityFailure;
        rejectionReason = aiEval.hardFailureReason || (aiEval.decision === "NOT_A_MATCH" || aiEval.decision === "INELIGIBLE" ? aiEval.explanation : null);
        matchReason = aiEval.explanation;
        isAiVerified = true;
        providerUsed = aiEval.providerUsed || aiProviderUsed;
        modelUsed = aiEval.modelUsed || aiModelUsed;
        finalMatchedSkills = aiEval.matchedSkills || prelimMatchedSkills;
        finalMissingSkills = aiEval.missingSkills || [];

        if (aiEval.decision === "STRONG_MATCH") {
          status = "MATCHED";
        } else if (aiEval.decision === "POTENTIAL_MATCH" || aiEval.decision === "INSUFFICIENT_INFORMATION") {
          status = "NEEDS_REVIEW";
        } else {
          status = "REJECTED";
        }
      } else {
        if (roleMatchPct >= 70 && cvMatchScore >= 70 && !isExplicitNonMedicalRole) {
          status = "MATCHED";
          aiDecision = "STRONG_MATCH";
        } else if (roleMatchPct >= 50 && cvMatchScore >= 50 && !isExplicitNonMedicalRole) {
          status = "NEEDS_REVIEW";
          aiDecision = "POTENTIAL_MATCH";
        } else {
          status = "REJECTED";
          aiDecision = "NOT_A_MATCH";
          hardEligibilityFailure = true;
          rejectionReason = isExplicitNonMedicalRole
            ? "Disqualified: Non-medical listing"
            : "Listing does not match candidate's approved target roles";
        }
      }

      const enrichedJob: Partial<EnrichedJob> & { matchScore?: number } = {
        ...job,
        cvMatchScore,
        cvMatchedSkills: finalMatchedSkills,
        cvMissingSkills: finalMissingSkills,
        matchScore: cvMatchScore,
      };
      
      // Persist discovered job and its verification to database
      try {
        const fp = fingerprintJob({
          company: job.company,
          title: job.title,
          location: job.location ?? null,
          description: job.description,
        });

        await db
          .insert(jobsTable)
          .values({
            id: job.id,
            accountId,
            title: job.title,
            company: job.company,
            normalizedCompany: job.normalizedCompany,
            normalizedTitle: job.normalizedTitle,
            location: job.location,
            normalizedLocation: job.normalizedLocation,
            remote: Boolean(job.remote),
            salary: job.salary,
            source: job.source,
            sourceUrl: job.sourceUrl,
            externalJobId: job.externalJobId,
            description: job.description,
            fingerprint: fp,
            matchScore: cvMatchScore,
            status: status as any,
            aiDecision,
            hardEligibilityFailure,
            rejectionReason,
            matchReason,
            aiProvider: providerUsed,
            aiModel: modelUsed,
            aiEvaluatedAt: isAiVerified ? new Date() : null,
            isAiVerified,
            evidenceFingerprint: candidateEvidence.evidenceFingerprint,
            matchedSkills: finalMatchedSkills,
            missingSkills: finalMissingSkills,
            discoveredAt: job.discoveredAt || new Date(),
          })
          .onConflictDoUpdate({
            target: [jobsTable.accountId, jobsTable.fingerprint],
            set: {
              matchScore: cvMatchScore,
              status: status as any,
              aiDecision,
              hardEligibilityFailure,
              rejectionReason,
              matchReason,
              aiProvider: providerUsed,
              aiModel: modelUsed,
              aiEvaluatedAt: isAiVerified ? new Date() : null,
              isAiVerified,
              evidenceFingerprint: candidateEvidence.evidenceFingerprint,
              matchedSkills: finalMatchedSkills,
              missingSkills: finalMissingSkills,
            },
          });

        await db
          .insert(jobProvenanceTable)
          .values({
            id: randomUUID(),
            jobId: job.id,
            sourceId: job.source,
            sourceName: job.source,
            originalUrl: job.sourceUrl || "",
            discoveredAt: job.discoveredAt || new Date(),
            isPrimary: true,
          })
          .catch(() => {});

        if (job.requirementVerification) {
          const rv = job.requirementVerification;
          await db
            .insert(jobRequirementVerificationsTable)
            .values({
              id: randomUUID(),
              jobId: job.id,
              accountId,
              hasClearInstructions: Boolean(rv.hasClearInstructions),
              applicationMethod: (rv.applicationMethod as any) || "unknown",
              applicationUrl: rv.applicationUrl ?? null,
              applicationEmail: rv.applicationEmail ?? null,
              deadline: rv.deadline ? String(rv.deadline) : null,
              deadlineDate: rv.deadline instanceof Date ? rv.deadline : null,
              requiredDocuments: rv.requiredDocuments || [],
              eligibilityRequirements: rv.eligibilityRequirements || [],
              isVerified: Boolean(rv.isVerified),
              verificationNotes: rv.verificationNotes || [],
              cvMatchScore,
              cvMatchedSkills: finalMatchedSkills,
              cvMissingSkills: finalMissingSkills,
              roleMatchScore: cvMatchScore,
              canApply: Boolean(job.isRequirementVerified),
              verifiedAt: new Date(),
              verificationMethod: "automatic",
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: jobRequirementVerificationsTable.jobId,
              set: {
                canApply: Boolean(job.isRequirementVerified),
                cvMatchScore,
                updatedAt: new Date(),
              },
            })
            .catch(() => {});
        }
      } catch (saveErr) {
        // Continue on individual save error
      }

      if (cvMatchScore >= 80 && status === "MATCHED") {
        highMatches.push(enrichedJob as any);
        jobsMatched++;
      } else if (cvMatchScore >= 50 && (status === "MATCHED" || status === "NEEDS_REVIEW")) {
        mediumMatches.push(enrichedJob as any);
        jobsMatched++;
      } else {
        lowMatches.push(enrichedJob as any);
        jobsRejected++;
      }
    }
    
    // Sort matches by score
    highMatches.sort((a: any, b: any) => (b.cvMatchScore || 0) - (a.cvMatchScore || 0));
    mediumMatches.sort((a: any, b: any) => (b.cvMatchScore || 0) - (a.cvMatchScore || 0));
    lowMatches.sort((a: any, b: any) => (b.cvMatchScore || 0) - (a.cvMatchScore || 0));
    
    return {
      discovered: jobsDiscovered,
      duplicates: duplicateCount,
      matched: jobsMatched,
      highMatches,
      mediumMatches,
      lowMatches,
      rejected: jobsRejected,
      gateRejected: gateRejectedCount,
      validationRejected: validationRejectedCount,
      errors,
      sourcesScraped,
      executionTime: Date.now() - startTime,
      rolesSearched: rolesToSearch,
      aiStatus,
      aiError: aiErrors[0] || null,
      aiProviderUsed,
      aiModelUsed,
    };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return {
      discovered: 0,
      duplicates: 0,
      matched: 0,
      highMatches: [],
      mediumMatches: [],
      lowMatches: [],
      rejected: 0,
      errors,
      sourcesScraped,
      executionTime: Date.now() - startTime,
      rolesSearched: [],
    };
  }
}

/**
 * Generate search queries for a specific role
 */
function generateSearchQueriesForRole(role: string): string[] {
  const queries: string[] = [];
  const roleLower = role.toLowerCase();
  
  // Basic queries
  queries.push(role);
  queries.push(`${role} jobs`);
  queries.push(`${role} job`);
  queries.push(`${role} vacancy`);
  queries.push(`${role} vacancies`);
  
  // Location variants
  const locations = ["Kenya", "Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Remote", "Worldwide"];
  for (const loc of locations) {
    queries.push(`${role} ${loc}`);
    queries.push(`${role} job ${loc}`);
  }
  
  // Experience level variants
  const levels = ["Junior", "Entry Level", "0-2 years", "0-5 years", "Fresher", "Trainee", "Intern"];
  for (const level of levels) {
    queries.push(`${role} ${level}`);
  }
  
  // Role and industry-specific expansions
  if (/developer|programmer|software/i.test(roleLower)) {
    queries.push(`${role} Kenya remote`);
    queries.push(`${role} worldwide`);
    queries.push(`${role} full-time`);
    queries.push(`${role} contract`);
  } else if (/doctor|physician|surgeon|medical|clinical|nurse|health/i.test(roleLower)) {
    queries.push(`${role} hospital Kenya`);
    queries.push(`${role} clinic Kenya`);
    queries.push(`${role} healthcare`);
    queries.push(`${role} full-time`);
  } else if (/accountant|accounting|audit|finance|financial|banking/i.test(roleLower)) {
    queries.push(`${role} Kenya`);
    queries.push(`${role} financial services`);
    queries.push(`${role} corporate`);
  } else if (/lawyer|attorney|legal|counsel/i.test(roleLower)) {
    queries.push(`${role} Kenya`);
    queries.push(`${role} law firm`);
    queries.push(`${role} corporate counsel`);
  } else if (/civil|mechanical|electrical|structural|engineer/i.test(roleLower)) {
    queries.push(`${role} Kenya`);
    queries.push(`${role} engineering`);
    queries.push(`${role} project`);
  } else if (/it support|technical support|help desk|ict|systems administrator/i.test(roleLower)) {
    queries.push(`${role} Nairobi`);
    queries.push(`${role} enterprise`);
    queries.push(`${role} infrastructure`);
  } else if (/operations|manager|coordinator|officer|specialist/i.test(roleLower)) {
    queries.push(`${role} Kenya`);
    queries.push(`${role} operations`);
  }
  
  return [...new Set(queries)];
}

// ============================================================================
// ENHANCED JOB MATCHING
// ============================================================================

/**
 * Enhanced job matching with comprehensive skill analysis
 */
export async function matchJobToUserEnhanced(
  job: NormalizedJob,
  accountId: string,
): Promise<{
  matchScore: number;
  decision: "STRONG_MATCH" | "POTENTIAL_MATCH" | "NOT_A_MATCH" | "INELIGIBLE";
  matchedSkills: string[];
  missingSkills: string[];
  experienceCompatibility: string;
  locationEligibility: string;
  hardEligibilityFailure: boolean;
  hardFailureReason: string | null;
  requirementVerification: RequirementVerification;
  cvMatch: {
    skillsMatch: number;
    roleMatch: number;
    locationMatch: number;
  };
}> {
  // Get user's CV data
  const candidateEvidence = await getOrGenerateCandidateEvidence(accountId);
  
  // Get user's enabled roles
  const { roles: enabledRoles } = await getUserEnabledRoles(accountId);
  
  // Extract skills from job
  const jobText = `${job.title} ${job.description} ${job.company} ${job.location || ''}`;
  const jobSkills = extractSkillsFromText(jobText);
  
  // Extract skills from candidate evidence
  const cvSkills = [
    ...candidateEvidence.demonstratedTechnicalSkills,
    ...candidateEvidence.selfReportedSkills,
  ];
  
  // Calculate skill match
  const matchedSkills = jobSkills.filter(skill => cvSkills.includes(skill));
  const missingSkills = jobSkills.filter(skill => !cvSkills.includes(skill));
  const skillsMatchScore = Math.round(
    (matchedSkills.length / Math.max(jobSkills.length, 1)) * 100
  );
  
  // Calculate role match
  const roleMatchScore = enabledRoles.some(role => 
    job.title.toLowerCase().includes(role.toLowerCase()) ||
    job.description.toLowerCase().includes(role.toLowerCase())
  ) ? 100 : 0;
  
  // Calculate location match
  const location = (job.location || "").toLowerCase();
  const isKenya = location.includes("kenya") || location.includes("nairobi");
  const isRemote = job.remote || location.includes("remote");
  const locationMatchScore = isKenya || isRemote ? 100 : 0;
  
  // Check experience requirements
  const minYears = extractContextualYears(jobText);
  const userExperience = candidateEvidence.yearsExperience;
  const experienceOk = minYears === null || minYears <= Math.max(userExperience + 1, 2);
  
  // Check hard eligibility
  const gateResult = evaluatePreIngestionGate(
    job,
    await getOrGenerateSearchDirective(accountId)
  );
  const hardEligibilityFailure = !gateResult.qualified || roleMatchScore === 0;
  const hardFailureReason = gateResult.rejectionReason || (roleMatchScore === 0 ? "Role does not match candidate's target career preferences" : null);
  
  // Verify requirements
  const requirementVerification = extractApplicationInstructions(job.description || '');
  
  // Calculate overall match score
  const matchScore = Math.round(
    skillsMatchScore * 0.4 +
    roleMatchScore * 0.3 +
    locationMatchScore * 0.2 +
    (experienceOk ? 10 : 0) +
    (requirementVerification.isVerified ? 5 : 0) +
    (job.remote ? 5 : 0)
  );
  
  // Determine decision
  let decision: "STRONG_MATCH" | "POTENTIAL_MATCH" | "NOT_A_MATCH" | "INELIGIBLE" = "NOT_A_MATCH";
  
  if (hardEligibilityFailure) {
    decision = "INELIGIBLE";
  } else if (matchScore >= 80 && skillsMatchScore >= 50 && roleMatchScore >= 60) {
    decision = "STRONG_MATCH";
  } else if (matchScore >= 50 && roleMatchScore >= 50 && skillsMatchScore >= 20) {
    decision = "POTENTIAL_MATCH";
  }
  
  return {
    matchScore,
    decision,
    matchedSkills,
    missingSkills,
    experienceCompatibility: experienceOk ? "Compatible" : `Requires ${minYears}+ years, candidate has ${userExperience}`,
    locationEligibility: isKenya || isRemote ? "Eligible" : `Location: ${location}`,
    hardEligibilityFailure,
    hardFailureReason,
    requirementVerification,
    cvMatch: {
      skillsMatch: skillsMatchScore,
      roleMatch: roleMatchScore,
      locationMatch: locationMatchScore,
    },
  };
}

// ============================================================================
// DISCOVERY SCHEDULING
// ============================================================================

/**
 * Schedule job discovery based on user settings
 */
export async function scheduleDiscovery(
  accountId: string,
): Promise<{
  scheduled: boolean;
  nextRunTime: Date | null;
  message: string;
}> {
  const settings = await getUserDiscoverySettings(accountId);
  
  if (settings.searchFrequency === "manual") {
    return {
      scheduled: false,
      nextRunTime: null,
      message: "Discovery is set to manual mode. Use 'Run Now' to start discovery.",
    };
  }
  
  // Calculate next run time based on frequency
  const now = new Date();
  let nextRun: Date | null = null;
  
  switch (settings.searchFrequency) {
    case "daily":
      nextRun = new Date(now);
      nextRun.setDate(now.getDate() + 1);
      if (settings.searchTimePreference) {
        const [hours, minutes] = settings.searchTimePreference.split(":");
        nextRun.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      } else {
        nextRun.setHours(9, 0, 0, 0); // Default 9 AM
      }
      break;
    case "every_2_days":
      nextRun = new Date(now);
      nextRun.setDate(now.getDate() + 2);
      nextRun.setHours(9, 0, 0, 0);
      break;
    case "weekly":
      nextRun = new Date(now);
      nextRun.setDate(now.getDate() + 7);
      nextRun.setHours(9, 0, 0, 0);
      break;
    case "biweekly":
      nextRun = new Date(now);
      nextRun.setDate(now.getDate() + 14);
      nextRun.setHours(9, 0, 0, 0);
      break;
  }
  
  if (nextRun) {
    // Save next run time
    await updateDiscoverySettings(accountId, {
      nextScheduledRun: nextRun.toISOString(),
    });
    
    return {
      scheduled: true,
      nextRunTime: nextRun,
      message: `Next discovery scheduled for ${nextRun.toLocaleString()}`,
    };
  }
  
  return {
    scheduled: false,
    nextRunTime: null,
    message: "Unable to schedule discovery",
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get discovery history for a user
 */
export async function getDiscoveryHistory(
  accountId: string,
  limit = 50,
): Promise<any[]> {
  // In production, query activity table
  // For now, return mock data
  return [];
}

/**
 * Get discovery statistics
 */
export async function getDiscoveryStatistics(
  accountId: string,
): Promise<{
  totalDiscoveries: number;
  lastDiscovery: string | null;
  avgJobsDiscovered: number;
  avgMatches: number;
  sourcesScraped: number;
  errors: number;
}> {
  // In production, query from database
  return {
    totalDiscoveries: 0,
    lastDiscovery: null,
    avgJobsDiscovered: 0,
    avgMatches: 0,
    sourcesScraped: 0,
    errors: 0,
  };
}

// ============================================================================
// EXPORT
// ============================================================================

export {
  ENHANCED_JOB_SOURCES,
  generateSearchQueriesForRole,
};
