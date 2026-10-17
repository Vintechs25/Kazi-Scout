import type { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";
import { GoogleJobsAdapter } from "./google-jobs-adapter";

/**
 * SearchOnlyAdapter
 * 
 * Sources that provide search-query endpoints.
 * Delegates to the Web Jobs Crawler / Google Jobs adapter to resolve concrete vacancies
 * matching candidate keywords and locations.
 */
export class SearchOnlyAdapter implements IJobConnector {
  readonly connectorType = "SEARCH_ONLY";
  private delegate = new GoogleJobsAdapter();

  validateConfiguration(source: JobSourceRecord): boolean {
    return Boolean(source.canonicalUrl);
  }

  getCapabilities(source: JobSourceRecord): ConnectorCapabilities {
    return this.delegate.getCapabilities(source);
  }

  async healthCheck(source: JobSourceRecord): Promise<ConnectorHealthReport> {
    return this.delegate.healthCheck(source);
  }

  async discoverListings(source: JobSourceRecord, filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    return this.delegate.discoverListings(source, filter);
  }
}
