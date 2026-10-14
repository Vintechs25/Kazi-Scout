/**
 * Public ATS Registry & Connectors for Kenyan & Africa-Hiring Employers
 * Connects directly to public ATS APIs (Greenhouse, Lever, Ashby, Recruitee)
 * with zero scraping and clean structured JSON.
 */

export interface AtsCompany {
  name: string;
  ats: "greenhouse" | "lever" | "ashby" | "recruitee";
  token: string;
  isKenyanLocal: boolean;
}

export const KENYA_AND_AFRICA_ATS_REGISTRY: AtsCompany[] = [
  // Leading Kenyan & East African tech employers & NGOs
  { name: "KoboToolbox", ats: "greenhouse", token: "kobotoolbox", isKenyanLocal: true },
  { name: "GiveDirectly", ats: "greenhouse", token: "givedirectly", isKenyanLocal: true },
  { name: "Ona Systems", ats: "lever", token: "ona", isKenyanLocal: true },
  { name: "Andela", ats: "lever", token: "andela", isKenyanLocal: true },
  { name: "M-KOPA", ats: "lever", token: "m-kopa", isKenyanLocal: true },
  { name: "Bboxx", ats: "lever", token: "bboxx", isKenyanLocal: true },
  { name: "SunCulture", ats: "lever", token: "sunculture", isKenyanLocal: true },
  { name: "Apollo Agriculture", ats: "greenhouse", token: "apolloagriculture", isKenyanLocal: true },
  { name: "Turaco", ats: "ashby", token: "turaco", isKenyanLocal: true },
  { name: "Wave", ats: "greenhouse", token: "wave", isKenyanLocal: true },
  { name: "Chipper Cash", ats: "lever", token: "chippercash", isKenyanLocal: true },
  { name: "Flutterwave", ats: "lever", token: "flutterwave", isKenyanLocal: true },
  { name: "Paystack", ats: "lever", token: "paystack", isKenyanLocal: true },
  { name: "Water Mission", ats: "greenhouse", token: "watermission", isKenyanLocal: true },
  { name: "One Acre Fund", ats: "greenhouse", token: "oneacrefund", isKenyanLocal: true },
  { name: "Komaza", ats: "lever", token: "komaza", isKenyanLocal: true },
  { name: "Lwala Community Alliance", ats: "greenhouse", token: "lwalacommunityalliance", isKenyanLocal: true },
  { name: "Mercy Corps", ats: "greenhouse", token: "mercycorps", isKenyanLocal: true },
  { name: "Sanergy", ats: "lever", token: "sanergy", isKenyanLocal: true },
  { name: "Cellulant", ats: "lever", token: "cellulant", isKenyanLocal: true },
];

export interface RawAtsJob {
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string;
  externalId: string;
  description: string;
  postedDate: Date;
  isKenyanMarket: boolean;
}

export async function fetchFromAtsCompany(comp: AtsCompany, timeoutMs = 4000): Promise<RawAtsJob[]> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (comp.ats === "greenhouse") {
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(comp.token)}/jobs?content=true`;
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!res.ok) return [];
      const data = (await res.json()) as { jobs?: any[] };
      const jobs = data.jobs || [];
      return jobs.map((j: any) => {
        const loc = j.location?.name || (comp.isKenyanLocal ? "Nairobi, Kenya" : "Worldwide Remote");
        const title = j.title || "";
        const desc = j.content || "";
        const isKenya = loc.toLowerCase().includes("kenya") || loc.toLowerCase().includes("nairobi") || comp.isKenyanLocal;
        return {
          title,
          company: comp.name,
          location: loc,
          remote: loc.toLowerCase().includes("remote") || desc.toLowerCase().includes("remote"),
          url: j.absolute_url || `https://boards.greenhouse.io/${comp.token}/jobs/${j.id}`,
          externalId: `gh-${comp.token}-${j.id}`,
          description: desc,
          postedDate: j.updated_at ? new Date(j.updated_at) : new Date(),
          isKenyanMarket: isKenya,
        };
      });
    }

    if (comp.ats === "lever") {
      const url = `https://api.lever.co/v0/postings/${encodeURIComponent(comp.token)}?mode=json`;
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!res.ok) return [];
      const jobs = (await res.json()) as any[];
      if (!Array.isArray(jobs)) return [];
      return jobs.map((j: any) => {
        const loc = j.categories?.location || (comp.isKenyanLocal ? "Nairobi, Kenya" : "Worldwide Remote");
        const title = j.text || "";
        const desc = `${j.descriptionPlain || ""} ${j.additionalPlain || ""}`;
        const isKenya = loc.toLowerCase().includes("kenya") || loc.toLowerCase().includes("nairobi") || comp.isKenyanLocal;
        return {
          title,
          company: comp.name,
          location: loc,
          remote: j.workplaceType === "remote" || loc.toLowerCase().includes("remote"),
          url: j.hostedUrl || j.applyUrl || `https://jobs.lever.co/${comp.token}/${j.id}`,
          externalId: `lever-${comp.token}-${j.id}`,
          description: desc,
          postedDate: j.createdAt ? new Date(j.createdAt) : new Date(),
          isKenyanMarket: isKenya,
        };
      });
    }

    if (comp.ats === "ashby") {
      const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(comp.token)}`;
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!res.ok) return [];
      const data = (await res.json()) as { jobs?: any[] };
      const jobs = data.jobs || [];
      return jobs.map((j: any) => {
        const loc = j.location || (comp.isKenyanLocal ? "Nairobi, Kenya" : "Worldwide Remote");
        const title = j.title || "";
        const desc = j.descriptionHtml || "";
        const isKenya = loc.toLowerCase().includes("kenya") || loc.toLowerCase().includes("nairobi") || comp.isKenyanLocal;
        return {
          title,
          company: comp.name,
          location: loc,
          remote: j.isRemote || loc.toLowerCase().includes("remote"),
          url: j.jobUrl || `https://jobs.ashbyhq.com/${comp.token}/${j.id}`,
          externalId: `ashby-${comp.token}-${j.id}`,
          description: desc,
          postedDate: j.publishedAt ? new Date(j.publishedAt) : new Date(),
          isKenyanMarket: isKenya,
        };
      });
    }

    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(id);
  }
}

let cachedAtsJobs: { timestamp: number; jobs: RawAtsJob[] } | null = null;

export async function fetchAllAtsJobs(): Promise<RawAtsJob[]> {
  if (cachedAtsJobs && Date.now() - cachedAtsJobs.timestamp < 300_000) {
    return cachedAtsJobs.jobs;
  }

  const allResults: RawAtsJob[] = [];
  const promises = KENYA_AND_AFRICA_ATS_REGISTRY.map((comp) => fetchFromAtsCompany(comp));
  const settled = await Promise.allSettled(promises);
  for (const s of settled) {
    if (s.status === "fulfilled" && Array.isArray(s.value)) {
      allResults.push(...s.value);
    }
  }

  cachedAtsJobs = { timestamp: Date.now(), jobs: allResults };
  return allResults;
}
