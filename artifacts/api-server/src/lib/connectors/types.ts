import type { JobSourceRecord } from "@workspace/db";

export interface NormalizedListing {
  id: string; // Unique within connector or hash
  sourceId: string;
  sourceName: string;
  externalJobId?: string | null;
  title: string;
  company: string;
  location?: string | null;
  county?: string | null;
  country: string;
  remote: boolean;
  workplaceType?: "On-site" | "Hybrid" | "Remote" | "Unknown";
  remoteEligibility?: "Worldwide" | "Africa" | "Kenya" | "Country-Restricted" | "Unknown";
  salary?: string | null;
  description: string;
  url: string;
  sourceUrl?: string | null;
  applicationUrl?: string | null;
  applicationEmail?: string | null;
  postedDate?: Date | null;
  deadlineDate?: Date | null;
  jobType?: string | null; // Full-time, Internship, Contract, etc.
  skills?: string[];
  rawPayload?: Record<string, any>;
}

export interface ConnectorFilter {
  keywords?: string[];
  locations?: string[];
  remoteOnly?: boolean;
  limit?: number;
  county?: string;
  minDate?: Date;
}

export interface ConnectorHealthReport {
  sourceId: string;
  ok: boolean;
  status: "ACTIVE" | "DEGRADED" | "AUTH_REQUIRED" | "BLOCKED" | "ERROR" | "UNSUPPORTED";
  statusCode?: number;
  responseTimeMs?: number;
  message?: string;
  timestamp: Date;
}

export interface ConnectorCapabilities {
  supportsApi: boolean;
  supportsFeed: boolean;
  supportsHtml: boolean;
  supportsSearchOnly: boolean;
  supportsApplicationRedirect: boolean;
  supportsFullDescriptionExtraction: boolean;
  paginationSupported: boolean;
  rateLimitPerMinute: number;
}

export interface IJobConnector {
  readonly connectorType: string;

  /**
   * Validate source configuration
   */
  validateConfiguration(source: JobSourceRecord): boolean;

  /**
   * Probe source endpoint to verify accessibility and health
   */
  healthCheck(source: JobSourceRecord): Promise<ConnectorHealthReport>;

  /**
   * Discover job vacancies from the source
   */
  discoverListings(source: JobSourceRecord, filter?: ConnectorFilter): Promise<NormalizedListing[]>;

  /**
   * Scrape jobs with custom configuration
   */
  scrape?(config: any): Promise<NormalizedListing[]>;

  /**
   * Fetch full job details if snippet was incomplete
   */
  fetchListingDetails?(source: JobSourceRecord, url: string): Promise<Partial<NormalizedListing> | null>;

  /**
   * Inspect connector capabilities for this source
   */
  getCapabilities(source: JobSourceRecord): ConnectorCapabilities;
}
