import { aggressiveCrawlKenya, ALL_KENYA_SOURCES } from "../artifacts/api-server/dist/lib/connectors/kenya-aggressive-crawler.mjs";

console.log("Total registered Kenyan source endpoints:", ALL_KENYA_SOURCES.length);

async function main() {
  console.log("Testing individual sources directly using sourceIds filter...\n");
  
  const sourcesToTest = [
    "brightermonday",
    "myjobmag",
    "jobwebkenya",
    "careerpoint-kenya",
    "corporate-staffing",
    "reliefweb-kenya",
    "summit-recruitment",
    "gap-recruitment",
    "devex-jobs-kenya",
    "ngojobsafrica",
    "psck-jobs",
    "nea-kenya",
    "kra-careers"
  ];

  for (const sId of sourcesToTest) {
    const src = ALL_KENYA_SOURCES.find(s => s.id === sId);
    if (!src) continue;
    const t0 = Date.now();
    try {
      const jobs = await aggressiveCrawlKenya({
        maxJobs: 25,
        perRequestTimeout: 8000,
        sourceIds: [sId],
        multiPage: false,
      });
      console.log(`[${src.id}] -> Found ${jobs.length} jobs in ${Date.now() - t0}ms`);
      if (jobs.length > 0) {
        console.log(`   Sample: "${jobs[0].title}" at ${jobs[0].company} (${jobs[0].url.slice(0, 75)})`);
      }
    } catch (e) {
      console.log(`[${src.id}] -> Error: ${e.message}`);
    }
  }
}

main().catch(err => {
  console.error("Test error:", err);
});
