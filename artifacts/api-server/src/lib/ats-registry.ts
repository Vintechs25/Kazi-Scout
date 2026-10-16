/**
 * Public ATS Registry & Connectors for Kenyan & Africa-Hiring Employers
 * Connects directly to public ATS APIs (Greenhouse, Lever, Ashby, Recruitee)
 * with zero scraping and clean structured JSON.
 */

export interface AtsCompany {
  name: string;
  ats: "greenhouse" | "lever" | "ashby" | "recruitee" | "smartrecruiters" | "workable" | "personio" | "workday";
  token: string;
  subdomain?: string;
  tenant?: string;
  site?: string;
  isKenyanLocal: boolean;
  category?: string;
}

export const KENYA_AND_AFRICA_ATS_REGISTRY: AtsCompany[] = [
  // Health & Medical Employers & International NGOs
  { name: "GiveDirectly", ats: "greenhouse", token: "givedirectly", isKenyanLocal: true, category: "NGO_INTERNATIONAL" },
  { name: "Water Mission", ats: "greenhouse", token: "watermission", isKenyanLocal: true, category: "HEALTHCARE" },
  { name: "One Acre Fund", ats: "greenhouse", token: "oneacrefund", isKenyanLocal: true, category: "NGO_INTERNATIONAL" },
  { name: "Lwala Community Alliance", ats: "greenhouse", token: "lwalacommunityalliance", isKenyanLocal: true, category: "HEALTHCARE" },
  { name: "Mercy Corps", ats: "greenhouse", token: "mercycorps", isKenyanLocal: true, category: "NGO_INTERNATIONAL" },
  { name: "Sanergy / Regen", ats: "lever", token: "sanergy", isKenyanLocal: true, category: "HEALTHCARE" },
  { name: "Turaco Health", ats: "ashby", token: "turaco", isKenyanLocal: true, category: "HEALTHCARE" },
  { name: "KoboToolbox", ats: "greenhouse", token: "kobotoolbox", isKenyanLocal: true, category: "NGO_INTERNATIONAL" },

  // Commercial, Enterprise & Tech Employers
  { name: "Ona Systems", ats: "lever", token: "ona", isKenyanLocal: true, category: "TECH_EMPLOYER" },
  { name: "Andela", ats: "lever", token: "andela", isKenyanLocal: true, category: "TECH_EMPLOYER" },
  { name: "M-KOPA", ats: "lever", token: "m-kopa", isKenyanLocal: true, category: "BANK_FINTECH" },
  { name: "Bboxx", ats: "lever", token: "bboxx", isKenyanLocal: true, category: "TECH_EMPLOYER" },
  { name: "SunCulture", ats: "lever", token: "sunculture", isKenyanLocal: true, category: "TECH_EMPLOYER" },
  { name: "Apollo Agriculture", ats: "greenhouse", token: "apolloagriculture", isKenyanLocal: true, category: "BANK_FINTECH" },
  { name: "Wave", ats: "greenhouse", token: "wave", isKenyanLocal: true, category: "BANK_FINTECH" },
  { name: "Chipper Cash", ats: "lever", token: "chippercash", isKenyanLocal: true, category: "BANK_FINTECH" },
  { name: "Flutterwave", ats: "lever", token: "flutterwave", isKenyanLocal: true, category: "BANK_FINTECH" },
  { name: "Paystack", ats: "lever", token: "paystack", isKenyanLocal: true, category: "BANK_FINTECH" },
  { name: "Komaza", ats: "lever", token: "komaza", isKenyanLocal: true, category: "TECH_EMPLOYER" },
  { name: "Cellulant", ats: "lever", token: "cellulant", isKenyanLocal: true, category: "BANK_FINTECH" },
  { name: "Twiga Foods", ats: "workable", token: "twigafoods", subdomain: "twigafoods", isKenyanLocal: true, category: "TECH_EMPLOYER" },
  { name: "Copia Global", ats: "greenhouse", token: "copiaglobal", isKenyanLocal: true, category: "TECH_EMPLOYER" },
  { name: "Wasoko", ats: "lever", token: "wasoko", isKenyanLocal: true, category: "TECH_EMPLOYER" },
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

export async function fetchFromAtsCompany(comp: AtsCompany, timeoutMs = 6000): Promise<RawAtsJob[]> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 1. Greenhouse
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

    // 2. Lever
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

    // 3. Ashby
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

    // 4. SmartRecruiters
    if (comp.ats === "smartrecruiters") {
      const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(comp.token)}/postings`;
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!res.ok) return [];
      const data = (await res.json()) as { content?: any[] };
      const postings = data.content || [];
      return postings.map((p: any) => {
        const loc = [p.location?.city, p.location?.region, p.location?.country].filter(Boolean).join(", ") || (comp.isKenyanLocal ? "Nairobi, Kenya" : "Worldwide");
        const title = p.name || "";
        const isKenya = loc.toLowerCase().includes("kenya") || loc.toLowerCase().includes("nairobi") || comp.isKenyanLocal;
        return {
          title,
          company: comp.name,
          location: loc,
          remote: Boolean(p.location?.remote),
          url: `https://jobs.smartrecruiters.com/${comp.token}/${p.id}`,
          externalId: `sr-${comp.token}-${p.id}`,
          description: `Posting at ${comp.name} for ${title} (${loc})`,
          postedDate: p.releasedDate ? new Date(p.releasedDate) : new Date(),
          isKenyanMarket: isKenya,
        };
      });
    }

    // 5. Workable
    if (comp.ats === "workable") {
      const subdomain = comp.subdomain || comp.token;
      const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(subdomain)}`;
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!res.ok) return [];
      const data = (await res.json()) as { jobs?: any[] };
      const jobs = data.jobs || [];
      return jobs.map((j: any) => {
        const loc = [j.city, j.country].filter(Boolean).join(", ") || (comp.isKenyanLocal ? "Nairobi, Kenya" : "Worldwide");
        const title = j.title || "";
        const isKenya = loc.toLowerCase().includes("kenya") || loc.toLowerCase().includes("nairobi") || comp.isKenyanLocal;
        return {
          title,
          company: comp.name,
          location: loc,
          remote: Boolean(j.telecommuting || loc.toLowerCase().includes("remote")),
          url: j.url || `https://apply.workable.com/${subdomain}/j/${j.shortcode}/`,
          externalId: `workable-${subdomain}-${j.shortcode || j.id}`,
          description: `Role at ${comp.name}: ${title}. Location: ${loc}`,
          postedDate: j.published ? new Date(j.published) : new Date(),
          isKenyanMarket: isKenya,
        };
      });
    }

    // 6. Recruitee
    if (comp.ats === "recruitee") {
      const url = `https://${encodeURIComponent(comp.token)}.recruitee.com/api/offers/`;
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!res.ok) return [];
      const data = (await res.json()) as { offers?: any[] };
      const offers = data.offers || [];
      return offers.map((o: any) => {
        const loc = [o.city, o.country].filter(Boolean).join(", ") || (comp.isKenyanLocal ? "Nairobi, Kenya" : "Worldwide");
        const title = o.title || "";
        const isKenya = loc.toLowerCase().includes("kenya") || loc.toLowerCase().includes("nairobi") || comp.isKenyanLocal;
        return {
          title,
          company: comp.name,
          location: loc,
          remote: Boolean(o.remote),
          url: o.careers_url || `https://${comp.token}.recruitee.com/o/${o.slug || o.id}`,
          externalId: `recruitee-${comp.token}-${o.id}`,
          description: o.description || `Position at ${comp.name}: ${title}`,
          postedDate: o.published_at ? new Date(o.published_at) : new Date(),
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
