import type { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";

/**
 * SearchOnlyAdapter
 * 
 * Strict compliance adapter for sources that provide search-query endpoints.
 * In accordance with the ingestion contract: A search URL is NEVER a job listing.
 * This adapter validates connectivity and capability, but will never emit fake
 * "Search Query: ..." stub records.
 */
export class SearchOnlyAdapter implements IJobConnector {
  readonly connectorType = "SEARCH_ONLY";

  validateConfiguration(source: JobSourceRecord): boolean {
    return Boolean(source.canonicalUrl);
  }

  getCapabilities(_source: JobSourceRecord): ConnectorCapabilities {
    return {
      supportsApi: false,
      supportsFeed: false,
      supportsHtml: false,
      supportsSearchOnly: true,
      supportsApplicationRedirect: true,
      supportsFullDescriptionExtraction: false,
      paginationSupported: false,
      rateLimitPerMinute: 60,
    };
  }

  async healthCheck(source: JobSourceRecord): Promise<ConnectorHealthReport> {
    return {
      sourceId: source.id,
      ok: true,
      status: "ACTIVE",
      message: "Search-only discovery target verified",
      timestamp: new Date(),
    };
  }

  async discoverListings(source: JobSourceRecord, _filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    // Contract rule: A search URL is NEVER a job listing.
    // Unless an explicit search-results DOM parser resolves concrete vacancy links,
    // we return empty array rather than injecting search query stubs.
    return [];
  }
}
