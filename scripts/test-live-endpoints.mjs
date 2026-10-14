import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts", "api-server", "package.json"));
const Database = require("better-sqlite3");

const dbPath = path.join(root, "storage", "data", "ai-job-agent.sqlite");
const db = new Database(dbPath, { readonly: true });
const [account] = db.prepare("SELECT id FROM accounts LIMIT 1").all();
db.close();

if (!account) {
  console.log("No account found in DB");
  process.exit(1);
}

const secret = process.env.SESSION_SECRET || "dev_secret_key_1234567890abcdefghijklmnopqrstuv";

function sign(payload) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function createCookie(accountId) {
  const payload = Buffer.from(
    JSON.stringify({ sub: accountId, exp: Date.now() + 12 * 60 * 60 * 1000 })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

const cookieVal = createCookie(account.id);
const cookieHeader = `job_agent_session=${cookieVal}`;

async function main() {
  console.log("Testing live /api/jobs/directive endpoint...");
  const dirRes = await fetch("http://localhost:5000/api/jobs/directive", {
    headers: { Cookie: cookieHeader },
  });
  console.log("Directive status:", dirRes.status);
  const directive = await dirRes.json();
  console.log("Generated Directive:", JSON.stringify(directive, null, 2));

  console.log("\nTesting live /api/jobs endpoint...");
  const jobsRes = await fetch("http://localhost:5000/api/jobs", {
    headers: { Cookie: cookieHeader },
  });
  console.log("Jobs status:", jobsRes.status);
  const jobs = await jobsRes.json();
  console.log(`Fetched ${jobs.length} jobs.`);
  
  const rejectedCount = jobs.filter(j => j.status === "REJECTED").length;
  const appliedCount = jobs.filter(j => j.status === "APPLIED").length;
  const qualifiedCount = jobs.filter(j => j.status !== "REJECTED" && j.status !== "IGNORED").length;

  console.log(`- Qualified jobs: ${qualifiedCount}`);
  console.log(`- Applied jobs: ${appliedCount}`);
  console.log(`- Disqualified / Rejected jobs: ${rejectedCount}`);

  if (jobs.length > 0) {
    console.log("\nSample job record:");
    console.log({
      title: jobs[0].title,
      company: jobs[0].company,
      status: jobs[0].status,
      matchScore: jobs[0].matchScore,
      rejectionReason: jobs[0].rejectionReason,
      matchReason: jobs[0].matchReason,
    });
  }
}

main().catch(console.error);
