import {
  db,
  jobSourcesTable,
  profileSourceSelectionTable,
  candidateProfilesTable,
  occupationTaxonomyTable,
  type JobSourceRecord,
  type ProfileSourceSelectionRecord,
} from "@workspace/db";
import { eq, and, or, inArray, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export interface StructuredProfile {
  profileId: string;
  occupations: string[]; // e.g. ["2211", "2212"] or target role titles
  industries: string[];  // e.g. ["healthcare", "finance"]
  countries: string[];   // e.g. ["KE"]
  regions: string[];     // e.g. ["nairobi", "mombasa"]
  workArrangements: string[]; // ["onsite", "hybrid", "remote"]
  employmentTypes: string[];  // ["permanent", "contract", "freelance", "internship"]
  languages: string[];   // ["en", "sw"]
}

export interface ScoredSource {
  source: JobSourceRecord;
  score: number;
  reason: string;
  isGeneralBoard: boolean;
  isRegionalMatch: boolean;
}

export interface RoutedSourceItem {
  source: JobSourceRecord;
  relevanceScore: number;
  reason: string;
  mode: "AUTO" | "PINNED" | "EXCLUDED";
}

export class SourceRouter {
  /**
   * Resolve a candidate profile into a structured profile object
   */
  static async resolveStructuredProfile(profileId: string = "primary", activeRoles?: string[]): Promise<StructuredProfile> {
    const [profile] = await db
      .select()
      .from(candidateProfilesTable)
      .where(or(
        eq(candidateProfilesTable.id, profileId),
        eq(candidateProfilesTable.id, "primary"),
        eq(candidateProfilesTable.id, "local")
      ))
      .limit(1);

    const targetRoles = [
      ...(Array.isArray(activeRoles) && activeRoles.length > 0 ? activeRoles : []),
      ...(Array.isArray(profile?.targetRoles) ? profile.targetRoles : []),
    ];
    const industries = Array.isArray(profile?.industries) ? profile.industries.map(i => i.toLowerCase()) : [];
    const country = (profile?.country || "KE").toUpperCase();
    const city = (profile?.city || "").toLowerCase();
    const preferredLocations = Array.isArray(profile?.preferredLocations)
      ? profile.preferredLocations.map(l => l.toLowerCase())
      : [];
    const workModes = Array.isArray(profile?.workModes) && profile.workModes.length > 0
      ? profile.workModes.map(w => w.toLowerCase())
      : ["onsite", "hybrid", "remote"];

    // Match target roles against occupation_taxonomy to find ISCO codes
    const iscoCodes: string[] = [];
    const allTaxonomy = await db.select().from(occupationTaxonomyTable);

    for (const role of targetRoles) {
      if (!role) continue;
      const roleLower = String(role).toLowerCase();
      const match = allTaxonomy.find(t =>
        t.title.toLowerCase().includes(roleLower) ||
        roleLower.includes(t.title.toLowerCase()) ||
        (t.synonyms || []).some((s: string) => s.toLowerCase().includes(roleLower) || roleLower.includes(s.toLowerCase())) ||
        (t.searchKeywords || []).some((k: string) => roleLower.includes(k.toLowerCase()))
      );
      if (match) {
        iscoCodes.push(match.iscoCode);
        if (match.industries) {
          industries.push(...match.industries.map((ind: string) => ind.toLowerCase()));
        }
      }
    }

    // Default regions
    const regions = [city, ...preferredLocations].filter(Boolean);

    return {
      profileId,
      occupations: [...new Set(iscoCodes)],
      industries: [...new Set(industries)],
      countries: country === "KENYA" ? ["KE"] : [country.slice(0, 2)],
      regions: [...new Set(regions)],
      workArrangements: workModes,
      employmentTypes: ["permanent", "contract"],
      languages: ["en", "sw"],
    };
  }

  /**
   * Route and select the best verified sources for a specific profile
   */
  static async routeSourcesForProfile(
    profileInput: StructuredProfile | string,
    activeRoles?: string[],
  ): Promise<RoutedSourceItem[]> {
    const profile = typeof profileInput === "string"
      ? await this.resolveStructuredProfile(profileInput, activeRoles)
      : profileInput;

    // 1. Fetch user PINNED and EXCLUDED overrides from profile_source_selection
    const existingSelections = await db
      .select()
      .from(profileSourceSelectionTable)
      .where(eq(profileSourceSelectionTable.profileId, profile.profileId));

    const pinnedSourceIds = new Set(existingSelections.filter(s => s.mode === "PINNED").map(s => s.sourceId));
    const excludedSourceIds = new Set(existingSelections.filter(s => s.mode === "EXCLUDED").map(s => s.sourceId));

    // 2. Fetch candidates: enabled, NOT isDefunct, READY/ACTIVE/DEGRADED, consecutiveFailures < 5, NOT SEARCH_ONLY
    const allSources = await db.select().from(jobSourcesTable);
    const candidates = allSources.filter(src => {
      if (pinnedSourceIds.has(src.id)) return true; // Pinned sources always pass candidate filter
      if (excludedSourceIds.has(src.id)) return false;
      if (!src.enabled) return false;
      if (src.isDefunct) return false;
      if (!["READY", "ACTIVE", "DEGRADED", "CONFIGURED"].includes(src.status)) return false;
      if ((src.consecutiveFailures || 0) >= 5) return false;
      if (src.integrationType === "SEARCH_ONLY" && !src.supportsFeed && !src.supportsApi && !src.supportsHtmlExtraction) return false;
      return true;
    });

    const isRemoteOnly = profile.workArrangements.length === 1 && profile.workArrangements[0] === "remote";
    const wantsFreelance = profile.employmentTypes.includes("freelance") || profile.employmentTypes.includes("contract");

    const scoredSources: ScoredSource[] = [];

    // 3. Evaluate each candidate source with hard filters & scoring
    for (const src of candidates) {
      if (pinnedSourceIds.has(src.id)) {
        scoredSources.push({
          source: src,
          score: 100,
          reason: "Pinned manually by candidate",
          isGeneralBoard: src.sourceKind === "GENERAL_BOARD",
          isRegionalMatch: false,
        });
        continue;
      }

      const srcCountries = Array.isArray(src.countries) && src.countries.length > 0 ? src.countries : [src.country === "Kenya" ? "KE" : "*"];
      const srcIndustries = Array.isArray(src.industries) && src.industries.length > 0 ? src.industries : ["*"];
      const srcOccupations = Array.isArray(src.occupationGroups) ? src.occupationGroups : ["*"];
      const srcWorkArrangements = Array.isArray(src.workArrangements) && src.workArrangements.length > 0 ? src.workArrangements : ["onsite", "hybrid", "remote"];
      const srcEmploymentTypes = Array.isArray(src.employmentTypes) && src.employmentTypes.length > 0 ? src.employmentTypes : ["permanent", "contract"];

      // --- HARD FILTERS ---
      // A. Country match: contains "*" OR intersects profile countries
      const countryMatch = srcCountries.includes("*") || srcCountries.some(c => profile.countries.includes(c));
      const remoteWorkArrangementMatch = isRemoteOnly && srcWorkArrangements.includes("remote");
      if (!countryMatch && !remoteWorkArrangementMatch) {
        continue;
      }

      // B. Employment types intersection
      const employmentMatch = srcEmploymentTypes.some(e => profile.employmentTypes.includes(e));
      if (!employmentMatch) {
        continue;
      }

      // C. Freelance marketplaces rule: ONLY if profile wants freelance/contract AND industry matches
      const isFreelanceMarket = src.sourceKind === "FREELANCE_MARKETPLACE";
      if (isFreelanceMarket) {
        if (!wantsFreelance) continue;
        const industryIntersects = srcIndustries.includes("*") || srcIndustries.some(i => profile.industries.includes(i));
        if (!industryIntersects) continue;
      }

      // --- SCORING (0 to 100) ---
      let score = 0;
      const scoreReasons: string[] = [];

      // 1. Occupation match (+30 points)
      if (profile.occupations.length > 0 && srcOccupations.length > 0) {
        const exactMatch = srcOccupations.some(so => profile.occupations.some(po => po.startsWith(so) || so.startsWith(po)));
        if (exactMatch) {
          score += 30;
          scoreReasons.push("Matches verified ISCO occupation code (+30)");
        } else if (srcOccupations.includes("*")) {
          score += 15;
          scoreReasons.push("General professional coverage (+15)");
        }
      } else if (srcOccupations.includes("*")) {
        score += 15;
      }

      // 2. Industries match (+25 points)
      const industryMatch = srcIndustries.includes("*") || srcIndustries.some(i => profile.industries.includes(i));
      if (industryMatch) {
        if (srcIndustries.some(i => profile.industries.includes(i))) {
          score += 25;
          scoreReasons.push(`Targeted industry coverage: ${profile.industries.filter(i => srcIndustries.includes(i)).join(", ")} (+25)`);
        } else {
          score += 15;
          scoreReasons.push("Cross-industry general portal (+15)");
        }
      }

      // 3. Country-specific match (+20 points)
      if (srcCountries.some(c => profile.countries.includes(c) && c !== "*")) {
        score += 20;
        scoreReasons.push(`Specific national coverage for ${profile.countries.join(", ")} (+20)`);
      } else if (srcCountries.includes("*")) {
        score += 10;
        scoreReasons.push("Global/remote feed (+10)");
      }

      // 4. Work arrangement match (+10 points)
      const arrangementIntersects = srcWorkArrangements.some(w => profile.workArrangements.includes(w));
      if (arrangementIntersects) {
        score += 10;
        scoreReasons.push("Matches preferred work arrangement (+10)");
      }

      // 5. Yield rate / historical quality (+10 points)
      const yieldRate = src.yieldRate ?? 0.5;
      const yieldPoints = Math.round(yieldRate * 10);
      score += yieldPoints;

      // 6. Full description / JSON-LD (+5 points)
      if (src.returnsFullDescription || src.hasJsonLdJobPosting) {
        score += 5;
        scoreReasons.push("High-fidelity structured posting capability (+5)");
      }

      // 7. Penalty for degraded status (-20 points)
      if (src.status === "DEGRADED") {
        score -= 20;
        scoreReasons.push("Degraded feed status (-20)");
      }

      // Floor score for general boards
      const isGeneral = src.sourceKind === "GENERAL_BOARD" || srcIndustries.includes("*");
      if (isGeneral && score < 40) {
        score = 40;
        scoreReasons.push("Baseline general portal floor score");
      }

      // Regional match for employer/government pages
      const regionMatch = profile.regions.some(r =>
        (src.region && src.region.toLowerCase().includes(r)) ||
        src.name.toLowerCase().includes(r) ||
        src.canonicalUrl.toLowerCase().includes(r)
      );

      scoredSources.push({
        source: src,
        score: Math.min(100, Math.max(0, score)),
        reason: scoreReasons.join(" · ") || "Selected based on career match",
        isGeneralBoard: isGeneral,
        isRegionalMatch: regionMatch,
      });
    }

    // 4. Selection Rules:
    // Sort by score descending
    scoredSources.sort((a, b) => b.score - a.score);

    // Keep all score >= 40, capped at ~25 per run
    const selectedMap = new Map<string, ScoredSource>();

    // Priority A: PINNED sources
    for (const sc of scoredSources) {
      if (pinnedSourceIds.has(sc.source.id)) {
        selectedMap.set(sc.source.id, sc);
      }
    }

    // Priority B: Regional employer/government matches
    for (const sc of scoredSources) {
      if (sc.isRegionalMatch && sc.score >= 35) {
        selectedMap.set(sc.source.id, sc);
      }
    }

    // Priority C: Always keep at least 3 general boards for the profile's country
    let generalCount = 0;
    for (const sc of scoredSources) {
      if (sc.isGeneralBoard && sc.score >= 30) {
        selectedMap.set(sc.source.id, sc);
        generalCount++;
        if (generalCount >= 4) break;
      }
    }

    // Priority D: Top ranked sources up to cap of 25
    for (const sc of scoredSources) {
      if (selectedMap.size >= 25) break;
      if (sc.score >= 40) {
        selectedMap.set(sc.source.id, sc);
      }
    }

    const finalSelected = Array.from(selectedMap.values());
    const scoreMap = new Map<string, ScoredSource>(scoredSources.map(s => [s.source.id, s]));

    // 5. Persist the selections to profile_source_selection table
    try {
      const now = new Date();
      for (const sel of finalSelected) {
        const mode = pinnedSourceIds.has(sel.source.id) ? "PINNED" : "AUTO";
        await db
          .insert(profileSourceSelectionTable)
          .values({
            id: `sel_${profile.profileId}_${sel.source.id}`,
            profileId: profile.profileId,
            sourceId: sel.source.id,
            mode,
            relevanceScore: sel.score,
            reason: sel.reason,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: profileSourceSelectionTable.id,
            set: {
              relevanceScore: sel.score,
              reason: sel.reason,
              updatedAt: now,
            },
          })
          .catch(() => {});
      }
    } catch (err: any) {
      console.warn("[SourceRouter] Error persisting selections:", err?.message || err);
    }

    return finalSelected.map(sel => ({
      source: sel.source,
      relevanceScore: sel.score,
      reason: sel.reason,
      mode: (pinnedSourceIds.has(sel.source.id) ? "PINNED" : "AUTO") as "AUTO" | "PINNED" | "EXCLUDED",
    }));
  }

  /**
   * User pin or exclude source control
   */
  static async setSourceMode(
    profileId: string,
    sourceId: string,
    mode: "AUTO" | "PINNED" | "EXCLUDED",
    reason?: string,
  ): Promise<void> {
    const id = `sel_${profileId}_${sourceId}`;
    const now = new Date();
    await db
      .insert(profileSourceSelectionTable)
      .values({
        id,
        profileId,
        sourceId,
        mode,
        relevanceScore: mode === "PINNED" ? 100 : mode === "EXCLUDED" ? 0 : 50,
        reason: reason || (mode === "PINNED" ? "Pinned by candidate" : mode === "EXCLUDED" ? "Excluded by candidate" : "Auto-routed"),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: profileSourceSelectionTable.id,
        set: {
          mode,
          reason: reason || (mode === "PINNED" ? "Pinned by candidate" : mode === "EXCLUDED" ? "Excluded by candidate" : "Auto-routed"),
          updatedAt: now,
        },
      });
  }
}
