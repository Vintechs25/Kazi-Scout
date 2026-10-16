import type { IJobConnector } from "./types";
import { RssFeedAdapter } from "./rss-feed-adapter";
import { JsonApiAdapter } from "./json-api-adapter";
import { AtsRegistryAdapter } from "./ats-registry-adapter";
import { StructuredHtmlAdapter } from "./structured-html-adapter";
import { SitemapJsonLdAdapter } from "./sitemap-jsonld-adapter";
import { WordPressAdapter } from "./wordpress-adapter";
import { RemoteFeedsAdapter } from "./remote-feeds-adapter";
import { JoobleAdapter, ReliefWebAdapter } from "./tier-b-aggregators";
import { SearchOnlyAdapter } from "./search-only-adapter";
import { ManualUrlAdapter } from "./manual-url-adapter";
import { CommunityAnnouncementAdapter } from "./community-announcement-adapter";
import { GoogleJobsAdapter } from "./google-jobs-adapter";
import type { JobSourceRecord } from "@workspace/db";
import type { SourceDefinition } from "../source-registry-data";

const sitemapJsonLd = new SitemapJsonLdAdapter();
const wordPress = new WordPressAdapter();
const remoteFeeds = new RemoteFeedsAdapter();
const jooble = new JoobleAdapter();
const reliefWeb = new ReliefWebAdapter();
const atsRegistry = new AtsRegistryAdapter();
const rssFeed = new RssFeedAdapter();
const jsonApi = new JsonApiAdapter();
const structuredHtml = new StructuredHtmlAdapter();
const googleJobs = new GoogleJobsAdapter();

const connectors = new Map<string, IJobConnector>([
  ["FEED", rssFeed],
  ["RSS_FEED", rssFeed],
  ["JSON_API", jsonApi],
  ["ATS_REGISTRY", atsRegistry],
  ["STRUCTURED_HTML", sitemapJsonLd],
  ["JSON_LD", sitemapJsonLd],
  ["SITEMAP_JSONLD", sitemapJsonLd],
  ["WORDPRESS", wordPress],
  ["REMOTE_FEED", remoteFeeds],
  ["JOOBLE", jooble],
  ["RELIEFWEB", reliefWeb],
  ["SEARCH_ONLY", googleJobs],
  ["GOOGLE_JOBS", googleJobs],
  ["MANUAL_URL", new ManualUrlAdapter()],
  ["COMMUNITY_ANNOUNCEMENT", new CommunityAnnouncementAdapter()],
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
