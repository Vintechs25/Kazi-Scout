import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts", "api-server", "package.json"));

async function testBrighterMonday() {
  try {
    const res = await fetch("https://www.brightermonday.co.ke/jobs", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    console.log("BrighterMonday status:", res.status);
    const html = await res.text();
    console.log("HTML length:", html.length);
    
    // Look for link patterns
    const aMatches = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    console.log("Total <a> tags:", aMatches.length);
    const jobLinks = aMatches.filter(m => /listings\/|job\//i.test(m[1]));
    console.log("Listing matches:", jobLinks.length);
    for (const j of jobLinks.slice(0, 8)) {
      const text = j[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      console.log("  LINK:", j[1], "\n  TEXT:", text);
    }
  } catch (e) {
    console.error("BM Error:", e.message);
  }
}

testBrighterMonday();
