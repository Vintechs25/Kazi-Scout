import { crawlJobsByKeywords } from "../artifacts/api-server/dist/lib/connectors/kenya-aggressive-crawler.mjs";
import { evaluatePreIngestionGate } from "../artifacts/api-server/dist/lib/pre-ingestion-gate.mjs";
import { getOrGenerateSearchDirective } from "../artifacts/api-server/dist/lib/search-directive.mjs";

console.log("Testing Kenya crawl + Gate with real user directive...");
const roles = ["Consultant Surgeon", "General Surgeon", "Medical Doctor", "Clinical Specialist"];
const directive = await getOrGenerateSearchDirective("local", false, roles);
console.log("Directive summary:", {
  targetRoleFamilies: directive.targetRoleFamilies,
  alternativeJobTitles: directive.alternativeJobTitles,
  candidateSummary: directive.candidateSummary,
});

const jobs = await crawlJobsByKeywords(roles, 30);
console.log(`Crawled ${jobs.length} jobs.`);

let qualifiedCount = 0;
for (const j of jobs) {
  const gate = evaluatePreIngestionGate(j, directive);
  if (gate.qualified) {
    qualifiedCount++;
    console.log(`  [QUALIFIED] ${j.title} | ${j.company}`);
  } else {
    console.log(`  [REJECTED] ${j.title} | ${j.company} -> Reason: ${gate.rejectionReason}`);
  }
}
console.log(`\nResult: ${qualifiedCount} / ${jobs.length} qualified through Pre-Ingestion Gate.`);
