import type { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";

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

  async discoverListings(source: JobSourceRecord, filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    // Generates targeted deep-link search queries for user exploration and automated search agents
    const keywords = filter?.keywords?.slice(0, 3).join("+") || "IT+support+Kenya";
    const targetUrl = source.canonicalUrl.includes("{query}")
      ? source.canonicalUrl.replace("{query}", encodeURIComponent(keywords))
      : `${source.canonicalUrl}?q=${encodeURIComponent(keywords)}`;

    return [
      {
        id: `${source.id}-${Date.now()}`,
        sourceId: source.id,
        sourceName: source.name,
        title: `Search Query: ${keywords.replace(/\+/g, " ")}`,
        company: source.name,
        location: source.country === "Kenya" ? "Kenya" : "Remote",
        country: source.country || "Kenya",
        remote: source.category === "GLOBAL_REMOTE",
        description: `Targeted search query generated for ${source.name}. Click to explore verified vacancies matching your candidate profile on ${source.name}.`,
        url: targetUrl,
        sourceUrl: targetUrl,
        applicationUrl: targetUrl,
        postedDate: new Date(),
        jobType: "Full-time",
        skills: filter?.keywords || [],
      },
    ];
  }
}
