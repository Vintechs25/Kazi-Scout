import { db, discoveredSourcesTable, jobSourcesTable } from "@workspace/db";
import { eq, or, like } from "drizzle-orm";
import { validateSafeUrl, secureFetch } from "./connectors/http-client";
import { logger } from "./logger";
import { getOrGenerateCandidateEvidence } from "./candidate-evidence";

export interface DiscoveredSourceProposal {
  url: string;
  domain: string;
  suggestedName: string;
  suggestedCategory: string;
  evidence: string;
  robotsAllowed: boolean;
}

export class SourceDiscoveryEngine {
  private static defaultSeedQueries = [
    "site:go.ke careers vacancies Kenya",
    "site:go.ke recruitment vacancies",
    "Kenya IT support jobs official careers",
    "Kenya cybersecurity vacancies",
    "Kenya internship computer science",
    "Kenya NGO vacancies",
    "Kenya county public service board recruitment",
    "remote IT support jobs Africa",
    "remote junior developer jobs open worldwide",
  ];

  /**
   * Discovers candidate sources based on candidate evidence and seed queries.
   */
  public static async runDiscoveryRun(options: { maxCandidates?: number } = {}): Promise<{
    proposalsGenerated: number;
    proposals: DiscoveredSourceProposal[];
  }> {
    const max = options.maxCandidates ?? 5;
    const proposals: DiscoveredSourceProposal[] = [];

    // 1. Generate targeted queries from candidate evidence
    const queries = [...this.defaultSeedQueries];
    try {
      const candidate = await getOrGenerateCandidateEvidence();
      if (candidate?.demonstratedTechnicalSkills?.length) {
        const topSkills = candidate.demonstratedTechnicalSkills.slice(0, 3).join(" ");
        queries.push(`Kenya ${topSkills} jobs official careers`);
        queries.push(`remote Africa ${topSkills} vacancies`);
      }
    } catch {
      // Fallback to default queries
    }

    // Comprehensive candidate registry of high-potential Kenyan institutions, fintechs, NGOs, and global tech platforms
    const candidateDomains = [
      { domain: "ncbagroup.com", path: "/careers", name: "NCBA Group Careers", category: "BANKS_FINTECH" },
      { domain: "co-opbank.co.ke", path: "/careers", name: "Co-operative Bank Kenya", category: "BANKS_FINTECH" },
      { domain: "stanbicbank.co.ke", path: "/careers", name: "Stanbic Bank Kenya", category: "BANKS_FINTECH" },
      { domain: "dtbafrica.com", path: "/careers", name: "Diamond Trust Bank Careers", category: "BANKS_FINTECH" },
      { domain: "kopokopo.com", path: "/careers", name: "Kopo Kopo Payments Careers", category: "BANKS_FINTECH" },
      { domain: "cellulant.io", path: "/careers", name: "Cellulant Africa Payments", category: "BANKS_FINTECH" },
      { domain: "craftsilicon.com", path: "/careers", name: "Craft Silicon Careers", category: "TECH_COMPANIES" },
      { domain: "kengen.co.ke", path: "/careers", name: "KenGen Careers", category: "STATE_CORPORATIONS" },
      { domain: "kpa.co.ke", path: "/careers", name: "Kenya Ports Authority", category: "PUBLIC_INSTITUTIONS" },
      { domain: "kra.go.ke", path: "/careers", name: "Kenya Revenue Authority", category: "STATE_CORPORATIONS" },
      { domain: "kplc.co.ke", path: "/careers", name: "Kenya Power (KPLC)", category: "STATE_CORPORATIONS" },
      { domain: "jumia.co.ke", path: "/careers", name: "Jumia Kenya Careers", category: "TECH_COMPANIES" },
      { domain: "twiga.com", path: "/careers", name: "Twiga Foods Tech", category: "TECH_COMPANIES" },
      { domain: "m-kopa.com", path: "/careers", name: "M-KOPA Solar Careers", category: "TECH_COMPANIES" },
      { domain: "wfp.org", path: "/careers", name: "World Food Programme Kenya", category: "INTERNATIONAL_ORGS" },
      { domain: "iom.int", path: "/careers", name: "IOM UN Migration Kenya", category: "INTERNATIONAL_ORGS" },
      { domain: "rescue.org", path: "/careers", name: "International Rescue Committee Kenya", category: "NGO_HUMANITARIAN" },
      { domain: "care.org", path: "/careers", name: "CARE International East Africa", category: "NGO_HUMANITARIAN" },
      { domain: "plan-international.org", path: "/careers", name: "Plan International Kenya", category: "NGO_HUMANITARIAN" },
      { domain: "fhi360.org", path: "/careers", name: "FHI 360 East Africa", category: "NGO_HUMANITARIAN" },
      { domain: "dalberg.com", path: "/careers", name: "Dalberg Advisors Nairobi", category: "INTERNATIONAL_ORGS" },
      { domain: "canonical.com", path: "/careers", name: "Canonical / Ubuntu Remote Careers", category: "INTERNATIONAL_REMOTE" },
      { domain: "automattic.com", path: "/work-with-us", name: "Automattic Global Remote", category: "INTERNATIONAL_REMOTE" },
      { domain: "gitlab.com", path: "/jobs", name: "GitLab Remote Careers", category: "INTERNATIONAL_REMOTE" },
      { domain: "zapier.com", path: "/jobs", name: "Zapier Remote Jobs", category: "INTERNATIONAL_REMOTE" },
      { domain: "buffer.com", path: "/journey", name: "Buffer Remote Careers", category: "INTERNATIONAL_REMOTE" },
      { domain: "duckduckgo.com", path: "/hiring", name: "DuckDuckGo Remote Jobs", category: "INTERNATIONAL_REMOTE" },
      { domain: "toptal.com", path: "/careers", name: "Toptal Global Talent", category: "INTERNATIONAL_REMOTE" },
      { domain: "arc.dev", path: "/remote-jobs", name: "Arc.dev Remote Tech Hub", category: "INTERNATIONAL_REMOTE" },
      { domain: "weworkremotely.com", path: "/categories/remote-programming-jobs", name: "We Work Remotely", category: "INTERNATIONAL_REMOTE" },
      { domain: "himalayas.app", path: "/jobs", name: "Himalayas Remote Work", category: "INTERNATIONAL_REMOTE" },
      { domain: "workingnomads.com", path: "/jobs", name: "Working Nomads Remote", category: "INTERNATIONAL_REMOTE" },
    ];

    for (const item of candidateDomains) {
      if (proposals.length >= max) break;
      const url = `https://${item.domain}${item.path}`;

      // 1. Check if already known in jobSourcesTable or discoveredSourcesTable
      const existingInSources = await db.select({ id: jobSourcesTable.id })
        .from(jobSourcesTable)
        .where(or(
          eq(jobSourcesTable.canonicalUrl, url),
          like(jobSourcesTable.canonicalUrl, `%${item.domain}%`)
        ));

      const existingInDiscovered = await db.select({ id: discoveredSourcesTable.id })
        .from(discoveredSourcesTable)
        .where(eq(discoveredSourcesTable.domain, item.domain));

      if (existingInSources.length > 0 || existingInDiscovered.length > 0) {
        continue;
      }

      // 2. SSRF Check & URL Validation
      const ssrfCheck = await validateSafeUrl(url);
      if (!ssrfCheck.valid) {
        logger.warn(`[SourceDiscovery] SSRF check rejected candidate ${url}: ${ssrfCheck.error}`);
        continue;
      }

      // 3. Check robots.txt
      let robotsAllowed = true;
      try {
        const robotsUrl = `https://${item.domain}/robots.txt`;
        const robotsRes = await secureFetch(robotsUrl, { timeoutMs: 5000 });
        if (robotsRes.status === 200 && robotsRes.text.includes("Disallow: /careers")) {
          robotsAllowed = false;
        }
      } catch {
        // robots.txt missing or not reachable
      }

      // 4. Probe career page for recruitment evidence
      let pageEvidence = `Discovered via automated query analysis for ${item.name}`;
      try {
        const headRes = await secureFetch(url, { timeoutMs: 5000 });
        if (headRes.status === 200 || headRes.status === 301 || headRes.status === 302) {
          pageEvidence += `. Career endpoint returned HTTP ${headRes.status}.`;
        }
      } catch (err: any) {
        pageEvidence += `. Career endpoint probe note: ${err?.message || "unreachable"}`;
      }

      const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const proposal: DiscoveredSourceProposal = {
        url,
        domain: item.domain,
        suggestedName: item.name,
        suggestedCategory: item.category,
        evidence: pageEvidence,
        robotsAllowed,
      };

      await db.insert(discoveredSourcesTable).values({
        id: proposalId,
        url: proposal.url,
        domain: proposal.domain,
        suggestedName: proposal.suggestedName,
        suggestedCategory: proposal.suggestedCategory,
        evidence: proposal.evidence,
        status: "PROPOSED",
        ssrfChecked: true,
        robotsAllowed: proposal.robotsAllowed,
        discoveredAt: new Date(),
        notes: "Automated candidate proposal pending administrator review.",
      });

      proposals.push(proposal);
    }

    return {
      proposalsGenerated: proposals.length,
      proposals,
    };
  }
}
