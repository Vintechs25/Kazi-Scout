/**
 * Type definitions for search-related endpoints
 * Simplified types without zod dependency
 */

// Job Search Filter types
export interface JobSearchFilter {
  keywords: string[];
  locations: string[];
  remote: boolean;
  minSalary?: number;
  maxSalary?: number;
  jobTypes?: string[];
  excludeKeywords?: string[];
  experienceLevel?: string[];
  industries?: string[];
  companies?: string[];
  datePosted?: string;
  sortBy?: "relevance" | "date" | "salary";
}

// Manual Search Request
export interface ManualSearchBody {
  keywords?: string[];
  locations?: string[];
  remote?: boolean;
  minSalary?: number;
  jobTypes?: string[];
  excludeKeywords?: string[];
  limit?: number;
}

// Job Search Result
export interface JobSearchResult {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  salary: string | null;
  source: string;
  sourceUrl: string | null;
  matchScore: number | null;
  discoveredAt: string;
}

// Manual Search Response
export interface ManualSearchResponse {
  jobs: JobSearchResult[];
  stats: {
    totalFound: number;
    filtered: number;
    matched: number;
    highMatches: number;
    sourceStats: Record<string, { total: number; matched: number }>;
  };
}

// Get Search Filters Response
export interface GetSearchFiltersResponse {
  filters: JobSearchFilter;
  activeProfiles: number;
  availableSources: Array<{
    id: string;
    name: string;
    enabled: boolean;
    rateLimit: number;
    countries: string[];
    remoteOnly: boolean;
  }>;
  kenyaSources: string[];
  internationalSources: string[];
}

// Save Search Filters Request
export interface SaveSearchFiltersBody {
  filters: JobSearchFilter;
  minMatchScore?: number;
}

// Save Search Filters Response
export interface SaveSearchFiltersResponse {
  profileId: string;
  message: string;
}

// Trigger Auto-Apply Request
export interface TriggerAutoApplyBody {
  minMatchScore?: number;
  maxApplications?: number;
  template?: string;
}

// Application Result
export interface ApplicationResult {
  jobId: string;
  jobTitle: string;
  company: string;
  success: boolean;
  error?: string;
  applicationId?: string;
}

// Trigger Auto-Apply Response
export interface TriggerAutoApplyResponse {
  applied: number;
  skipped: number;
  errors: number;
  results: ApplicationResult[];
}

// Job Stats
export interface JobStats {
  total: number;
  discovered: number;
  matched: number;
  shortlisted: number;
  remote: number;
  kenya: number;
}

// Application Stats
export interface ApplicationStats {
  total: number;
  submitted: number;
  interviews: number;
  offers: number;
}

// Job Preview
export interface JobPreview {
  id: string;
  title: string;
  company: string;
  matchScore: number | null;
}

// Get Search Stats Response
export interface GetSearchStatsResponse {
  jobs: JobStats;
  applications: ApplicationStats;
  recentJobs: JobPreview[];
  highMatchJobs: JobPreview[];
}

// Source Info
export interface SourceInfo {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  rateLimit: number;
  countries: string[];
  remoteOnly: boolean;
  apiRequired: boolean;
  description: string;
}
