import { secureFetch } from "./http-client";
import type { IJobConnector, NormalizedListing, ConnectorFilter, ConnectorHealthReport, ConnectorCapabilities } from "./types";
import type { JobSourceRecord } from "@workspace/db";

export class ManualUrlAdapter implements IJobConnector {
  readonly connectorType = "MANUAL_URL";

  validateConfiguration(source: JobSourceRecord): boolean {
    return true;
  }

  getCapabilities(_source: JobSourceRecord): ConnectorCapabilities {
    return {
      supportsApi: false,
      supportsFeed: false,
      supportsHtml: true,
      supportsSearchOnly: false,
      supportsApplicationRedirect: true,
      supportsFullDescriptionExtraction: true,
      paginationSupported: false,
      rateLimitPerMinute: 30,
    };
  }

  async healthCheck(source: JobSourceRecord): Promise<ConnectorHealthReport> {
    return {
      sourceId: source.id,
      ok: true,
      status: "ACTIVE",
      message: "Manual URL connector operational",
      timestamp: new Date(),
    };
  }

  async discoverListings(_source: JobSourceRecord, _filter?: ConnectorFilter): Promise<NormalizedListing[]> {
    return []; // Manual listings are provided explicitly via API or UI
  }

  async fetchListingDetails(source: JobSourceRecord, url: string): Promise<Partial<NormalizedListing> | null> {
    try {
      const res = await secureFetch(url, { timeoutMs: 15_000 });
      if (!res.ok) return null;

      const titleMatch = res.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "Custom Vacancy";

      return {
        url,
        title,
        sourceUrl: url,
        applicationUrl: url,
        description: res.text.replace(/<[^>]+>/g, " ").slice(0, 3000),
      };
    } catch {
      return null;
    }
  }
}
