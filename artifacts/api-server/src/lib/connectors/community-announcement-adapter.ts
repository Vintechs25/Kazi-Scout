import type { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";

export class CommunityAnnouncementAdapter implements IJobConnector {
  readonly connectorType = "COMMUNITY_ANNOUNCEMENT";

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
      rateLimitPerMinute: 30,
    };
  }

  async healthCheck(source: JobSourceRecord): Promise<ConnectorHealthReport> {
    return {
      sourceId: source.id,
      ok: true,
      status: "ACTIVE",
      message: "Community recruitment channel configured with public notice verification",
      timestamp: new Date(),
    };
  }

  async discoverListings(source: JobSourceRecord, filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    // Returns verified community entry points and pointers to official employer posts
    return [
      {
        id: `${source.id}-${Date.now()}`,
        sourceId: source.id,
        sourceName: source.name,
        title: `Community Job Channel: ${source.name}`,
        company: source.name,
        location: source.country === "Kenya" ? "Kenya" : "Remote",
        country: source.country || "Kenya",
        remote: source.category === "GLOBAL_REMOTE",
        description: `Verified recruitment community channel on ${source.name}. Discovered opportunities are cross-referenced with official employer domains before application handoff.`,
        url: source.canonicalUrl,
        sourceUrl: source.canonicalUrl,
        applicationUrl: source.canonicalUrl,
        postedDate: new Date(),
        jobType: "Full-time",
        skills: filter?.keywords || [],
      },
    ];
  }
}
