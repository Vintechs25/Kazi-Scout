import type { IJobConnector } from "./types";
import { RssFeedAdapter } from "./rss-feed-adapter";
import { JsonApiAdapter } from "./json-api-adapter";
import { AtsRegistryAdapter } from "./ats-registry-adapter";
import { StructuredHtmlAdapter } from "./structured-html-adapter";
import { SearchOnlyAdapter } from "./search-only-adapter";
import { ManualUrlAdapter } from "./manual-url-adapter";
import { CommunityAnnouncementAdapter } from "./community-announcement-adapter";
import { GoogleJobsConnector } from "./google-jobs-scraper";
import type { JobSourceRecord } from "@workspace/db";
import type { SourceDefinition } from "../source-registry-data";

const connectors = new Map<string, IJobConnector>([
  ["FEED", new RssFeedAdapter()],
  ["RSS_FEED", new RssFeedAdapter()],
  ["JSON_API", new JsonApiAdapter()],
  ["ATS_REGISTRY", new AtsRegistryAdapter()],
  ["STRUCTURED_HTML", new StructuredHtmlAdapter()],
  ["SEARCH_ONLY", new SearchOnlyAdapter()],
  ["MANUAL_URL", new ManualUrlAdapter()],
  ["COMMUNITY_ANNOUNCEMENT", new CommunityAnnouncementAdapter()],
  ["GOOGLE_JOBS", new GoogleJobsConnector()],
]);

export function getConnectorForSource(source: JobSourceRecord | SourceDefinition): IJobConnector {
  const byConnector = connectors.get(source.connectorType);
  if (byConnector) return byConnector;

  const byIntegration = connectors.get(source.integrationType);
  if (byIntegration) return byIntegration;

  if (source.supportsFeed) return connectors.get("FEED")!;
  if (source.supportsApi) return connectors.get("JSON_API")!;
  if (source.supportsHtmlExtraction) return connectors.get("STRUCTURED_HTML")!;
  if (source.supportsSearchOnly) return connectors.get("SEARCH_ONLY")!;

  return connectors.get("SEARCH_ONLY")!;
}

export function getAllConnectors(): Map<string, IJobConnector> {
  return connectors;
}
