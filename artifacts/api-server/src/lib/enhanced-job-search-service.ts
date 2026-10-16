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
  errors: string[];
  sourcesScraped: string[];
  executionTime: number;
  rolesSearched: string[];
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
    
    // Get sources to scrape
    const allEnabledSources = overrideSources
      ? overrideSources.map(id => SOURCE_BY_ID[id]).filter(Boolean)
      : getEnabledSources();
    
    // Filter sources based on settings
    let sourcesToScrape = allEnabledSources;
    
    if (!settings.enableAllKenyaSources) {
      sourcesToScrape = sourcesToScrape.filter(s => s.country !== "Kenya");
    }
    if (!settings.enableGlobalRemoteSources) {
      sourcesToScrape = sourcesToScrape.filter(s => s.country === "Kenya");
    }
    if (!settings.enableRecruitmentAgencies) {
      sourcesToScrape = sourcesToScrape.filter(s => s.category !== "RECRUITMENT_AGENCY");
    }
    
    // Apply source preferences
    if (settings.preferredSourceIds.length > 0) {
      const preferredIds = new Set(settings.preferredSourceIds);
      sourcesToScrape = [
        ...sourcesToScrape.filter(s => preferredIds.has(s.id)),
        ...sourcesToScrape.filter(s => !preferredIds.has(s.id)),
      ];
    }
    
    // Apply excluded sources
    if (settings.excludedSourceIds.length > 0) {
      const excludedIds = new Set(settings.excludedSourceIds);
      sourcesToScrape = sourcesToScrape.filter(s => !excludedIds.has(s.id));
    }
    
    // Prioritize Republic of Kenya sources at the front of the queue
    const kenyaSources = sourcesToScrape.filter(s => s.country === "Kenya");
    const otherSources = sourcesToScrape.filter(s => s.country !== "Kenya");
    
    // Order high-yield Kenyan job portals and verified national portals at the very front
    const highYieldKenyaIds = [
      "myjobmag-kenya", "myjobmag",
      "brightermonday-kenya", "brightermonday",
      "jobwebkenya",
      "corporate-staffing-jobs", "corporatestaffing", "corporate-staffing",
      "psck-jobs", "psck-jobs-portal", "public-service-commission",
      "kenyajob", "jobs-in-kenya", "jobsinkenya",
      "careerpoint-kenya", "careerpointkenya",
    ];
    const topKenya: typeof kenyaSources = [];
    const seenTopIds = new Set<string>();
    for (const id of highYieldKenyaIds) {
      const match = kenyaSources.find(s => s.id === id);
      if (match && !seenTopIds.has(match.id)) {
        seenTopIds.add(match.id);
        topKenya.push(match);
      }
    }
    const restKenya = kenyaSources.filter(s => !seenTopIds.has(s.id));

    // Allow crawling all active Kenyan sources plus top remote sources
    const maxSources = aggressiveMode ? 100 : 60;
    sourcesToScrape = [...topKenya, ...restKenya, ...otherSources].slice(0, maxSources);
    
    // Generous per-source limit so rich Kenyan feeds yield full batches of listings
    const perSourceLimit = Math.max(35, Math.ceil(maxJobs / Math.max(1, Math.min(sourcesToScrape.length, 8))));

    // Track progress
    let jobsDiscovered = 0;
    let jobsMatched = 0;
    let highMatches: EnrichedJob[] = [];
    let mediumMatches: EnrichedJob[] = [];
    let lowMatches: EnrichedJob[] = [];
    let jobsRejected = 0;

    // Fetch directive once before loop
    const directive = await getOrGenerateSearchDirective();
    
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
            setTimeout(() => reject(new Error("Source crawl timed out after 8s")), 8000),
          );

          sourceJobs = await Promise.race([fetchPromise, timeoutPromise]);
          console.log(`[Discovery] Scraped ${source.id} (${source.name}): yielded ${sourceJobs.length} listings in ${Date.now() - t0}ms`);
        } catch (srcErr: any) {
          console.warn(`[Discovery] Source ${source.id} skipped: ${srcErr?.message || srcErr}`);
          errors.push(`Source ${source.id} failed: ${srcErr?.message || srcErr}`);
          continue;
        }

        if (!sourceJobs || sourceJobs.length === 0) {
          continue;
        }
        
        // Process each job
        for (const job of sourceJobs) {
          if (jobsDiscovered >= maxJobs) break;
          
          // Check for duplicates
          const fingerprint = fingerprintJob({
            company: job.company,
            title: job.title,
            location: job.location ?? null,
            description: job.description,
          });
          if (duplicateFingerprints.has(fingerprint)) {
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
            jobsRejected++;
            
            // Log rejection reason
            if (gateResult.rejectionReason) {
              // In production, log to database
            }
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
            
            if (filters?.requireApplicationInstructions && (!verificationResult.requirementVerification || !verificationResult.requirementVerification.hasClearInstructions)) {
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
    
    // Match discovered jobs against user's profile
    const candidateEvidence = await getOrGenerateCandidateEvidence();
    
    for (const job of discoveredJobs) {
      // Calculate match score based on CV
      const jobSkills = extractSkillsFromText(
        `${job.title} ${job.description} ${job.company} ${job.location || ''}`
      );
      
      const matchedSkills = jobSkills.filter(skill => 
        candidateEvidence.demonstratedTechnicalSkills.includes(skill) ||
        candidateEvidence.selfReportedSkills.includes(skill)
      );
      
      const cvMatchScore = Math.round(
        (matchedSkills.length / Math.max(jobSkills.length, 1)) * 100 * 0.7 +
        (job.remote ? 15 : 0) +
        (job.location?.toLowerCase().includes("kenya") ? 10 : 0)
      );
      
      const enrichedJob: Partial<EnrichedJob> & { matchScore?: number } = {
        ...job,
        cvMatchScore,
        cvMatchedSkills: matchedSkills,
        cvMissingSkills: jobSkills.filter(s => !matchedSkills.includes(s)),
        matchScore: cvMatchScore,
      };
      
      // Persist discovered job and its verification to database
      try {
        const status = cvMatchScore >= 80 ? "MATCHED" : cvMatchScore >= 50 ? "NEEDS_REVIEW" : "DISCOVERED";
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
            matchedSkills,
            missingSkills: jobSkills.filter(s => !matchedSkills.includes(s)),
            isAiVerified: Boolean(job.isRequirementVerified),
            discoveredAt: job.discoveredAt || new Date(),
          })
          .onConflictDoUpdate({
            target: jobsTable.fingerprint,
            set: {
              matchScore: cvMatchScore,
              matchedSkills,
              missingSkills: jobSkills.filter(s => !matchedSkills.includes(s)),
              isAiVerified: Boolean(job.isRequirementVerified),
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
              cvMatchedSkills: matchedSkills,
              cvMissingSkills: jobSkills.filter(s => !matchedSkills.includes(s)),
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

      if (cvMatchScore >= 80) {
        highMatches.push(enrichedJob as any);
      } else if (cvMatchScore >= 50) {
        mediumMatches.push(enrichedJob as any);
      } else {
        lowMatches.push(enrichedJob as any);
      }
      jobsMatched++;
    }
    
    // Sort matches by score
    highMatches.sort((a: any, b: any) => (b.cvMatchScore || 0) - (a.cvMatchScore || 0));
    mediumMatches.sort((a: any, b: any) => (b.cvMatchScore || 0) - (a.cvMatchScore || 0));
    lowMatches.sort((a: any, b: any) => (b.cvMatchScore || 0) - (a.cvMatchScore || 0));
    
    return {
      discovered: jobsDiscovered,
      duplicates: jobsRejected,
      matched: jobsMatched,
      highMatches,
      mediumMatches,
      lowMatches,
      rejected: jobsRejected,
      errors,
      sourcesScraped,
      executionTime: Date.now() - startTime,
      rolesSearched: rolesToSearch,
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
  const candidateEvidence = await getOrGenerateCandidateEvidence();
  
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
    await getOrGenerateSearchDirective()
  );
  const hardEligibilityFailure = !gateResult.qualified;
  const hardFailureReason = gateResult.rejectionReason || null;
  
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
  } else if (matchScore >= 80 && skillsMatchScore >= 60 && roleMatchScore >= 50) {
    decision = "STRONG_MATCH";
  } else if (matchScore >= 50 && skillsMatchScore >= 30) {
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
