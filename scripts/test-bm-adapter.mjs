import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts", "api-server", "package.json"));

async function testAdapter() {
  const { StructuredHtmlAdapter } = await import("../artifacts/api-server/dist/index.mjs");
  const adapter = new StructuredHtmlAdapter();
  const source = {
    id: "brightermonday-kenya",
    name: "BrighterMonday Kenya",
    canonicalUrl: "https://www.brightermonday.co.ke/jobs",
    category: "KENYAN_JOB_BOARD",
    country: "Kenya",
    config: {
      searchUrl: "https://www.brightermonday.co.ke/jobs",
      itVacancies: "https://www.brightermonday.co.ke/jobs/software-data"
    }
  };
  
  const res = await adapter.discoverListings(source, { limit: 20 });
  console.log("BrighterMonday discovered listings:", res.length);
  for (const item of res.slice(0, 5)) {
    console.log(" - Title:", item.title, "Company:", item.company, "URL:", item.url);
  }
}

testAdapter();
