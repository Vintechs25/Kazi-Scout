import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts", "api-server", "package.json"));
const Database = require("better-sqlite3");
const dbPath = path.join(root, "storage", "data", "ai-job-agent.sqlite");

console.log("Opening database:", dbPath);
const db = new Database(dbPath);

const total = db.prepare("SELECT count(*) as count FROM jobs").get();
console.log("Total jobs in DB:", total.count);

const byStatus = db.prepare("SELECT status, count(*) as count FROM jobs GROUP BY status").all();
console.log("Jobs by status:", byStatus);

const rejected = db.prepare("SELECT id, title, company, location, remote, rejection_reason FROM jobs WHERE status = 'REJECTED'").all();
console.log("Rejected jobs count:", rejected.length);

// Sample 10 rejected jobs
console.log("\nSample 10 rejected jobs:");
for (const j of rejected.slice(0, 10)) {
  console.log(`- [${j.id.slice(0, 8)}] "${j.title}" at "${j.company}" (reason: ${j.rejection_reason})`);
}

db.close();
