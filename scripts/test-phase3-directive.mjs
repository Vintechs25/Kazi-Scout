import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { getOrGenerateSearchDirective } = await import(pathToFileURL(path.join(root, "artifacts", "api-server", "src", "lib", "search-directive.ts")).href);

console.log("Generating AI Search Directive from Verified Candidate Evidence...");
const result = await getOrGenerateSearchDirective(true);

const directive = result.directive || result;

console.log("SEARCH DIRECTIVE SUMMARY:");
console.log("- Source:", result.source);
console.log("- Provider:", directive.providerUsed || directive.searchStrategy?.aiProvider || "gemini");
console.log("- Target Role Families:", directive.targetRoleFamilies);
console.log("- Alternative Titles:", directive.alternativeJobTitles);
console.log("- Target Search Queries:", directive.targetedQueries || directive.searchStrategy?.targetedQueries);
console.log("- Expansion Strategies:", directive.searchExpansionStrategies || directive.searchStrategy?.searchExpansionStrategies);
console.log("- Allowed Countries:", directive.locationRestrictions?.allowedCountries);
console.log("- Worldwide Remote Allowed:", directive.locationRestrictions?.allowWorldwideRemote);
console.log("- Max Experience Years:", directive.maxExperienceYears);
console.log("- Seniority Exclusions:", directive.seniorityExclusions);
console.log("- Disqualification Rules:", directive.disqualificationRules);
