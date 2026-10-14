import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts", "api-server", "package.json"));
const Database = require("better-sqlite3");

const db = new Database(path.join(root, "storage", "data", "ai-job-agent.sqlite"), { readonly: true });
const [account] = db.prepare("SELECT id FROM accounts LIMIT 1").all();
db.close();

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

const cookieHeader = `job_agent_session=${createCookie(account.id)}`;

const testSourceIds = [
  "careerpoint-kenya",
  "myjobmag-kenya",
  "brightermonday-kenya",
  "jobwebkenya",
  "arbeitnow",
  "jobicy",
  "weworkremotely",
  "kra-kenya"
];

async function testSync() {
  for (const id of testSourceIds) {
    try {
      const res = await fetch(`http://127.0.0.1:5000/api/sources/${id}/sync`, {
        method: "POST",
        headers: { Cookie: cookieHeader }
      });
      const data = await res.json();
      console.log(`Sync [${id}] -> Status: ${res.status}, Count: ${data.discoveredCount}`);
      if (data.sampleListings && data.sampleListings.length > 0) {
        console.log(`   Sample: "${data.sampleListings[0].title}" at ${data.sampleListings[0].company}`);
      }
    } catch (e) {
      console.log(`Sync [${id}] -> Error: ${e.message}`);
    }
  }
}

testSync();
