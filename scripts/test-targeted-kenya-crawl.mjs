import { crawlJobsByKeywords } from "../artifacts/api-server/dist/lib/connectors/kenya-aggressive-crawler.mjs";

console.log("Testing targeted Kenya crawl for Medical / Doctor roles...");
const t0 = Date.now();
const jobs = await crawlJobsByKeywords(["Consultant Surgeon", "General Surgeon", "Medical Doctor", "Clinical Specialist"], 30);
console.log(`Crawl finished in ${((Date.now() - t0) / 1000).toFixed(1)}s, total jobs returned: ${jobs.length}`);

for (const [i, j] of jobs.slice(0, 15).entries()) {
  console.log(`  ${i + 1}. [${j.sourceId}] ${j.title} | ${j.company} | ${j.location}`);
}
