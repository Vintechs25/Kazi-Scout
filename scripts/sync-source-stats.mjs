import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts", "api-server", "package.json"));
const Database = require("better-sqlite3");

const db = new Database(path.join(root, "storage", "data", "ai-job-agent.sqlite"));

export function syncSourceStats() {
  const sources = db.prepare("SELECT id, name, canonical_url FROM job_sources").all();
  const updateStmt = db.prepare(`
    UPDATE job_sources 
    SET total_indexed = ?, 
        total_discovered = ?,
        last_job_discovered_at = CASE WHEN ? > 0 THEN COALESCE(last_job_discovered_at, unixepoch()) ELSE last_job_discovered_at END,
        status = CASE WHEN ? > 0 AND status != 'ACTIVE' THEN 'ACTIVE' ELSE status END
    WHERE id = ?
  `);

  let updatedCount = 0;
  for (const s of sources) {
    const directJobs = db.prepare("SELECT count(id) as c FROM jobs WHERE source = ? OR source = ? OR source LIKE ?").get(s.id, s.name, `%${s.name}%`);
    const provCount = db.prepare("SELECT count(id) as c FROM job_provenance WHERE source_id = ? OR source_name = ? OR source_name LIKE ?").get(s.id, s.name, `%${s.name}%`);

    let indexed = directJobs?.c || 0;
    let discovered = Math.max(provCount?.c || 0, indexed);

    // If source has known specific aliases in jobs table
    const aliases = [];
    if (s.id.includes("myjobmag")) aliases.push("myjobmag", "MyJobMag Kenya");
    if (s.id.includes("careerpoint")) aliases.push("Career Point Kenya", "careerpoint");
    if (s.id.includes("jobwebkenya")) aliases.push("JobWeb Kenya", "jobwebkenya");
    if (s.id.includes("jobicy")) aliases.push("Jobicy", "jobicy");
    if (s.id.includes("remoteok") || s.id.includes("remote-ok")) aliases.push("RemoteOK", "remoteok", "Remote OK");
    if (s.id.includes("weworkremotely")) aliases.push("WeWorkRemotely", "weworkremotely", "We Work Remotely");
    if (s.id.includes("arbeitnow")) aliases.push("Arbeitnow", "arbeitnow", "Arbeitnow Remote");
    if (s.id.includes("working-nomads")) aliases.push("Working Nomads", "workingnomads");
    if (s.id.includes("himalayas")) aliases.push("Himalayas", "himalayas");
    if (s.id.includes("remotive")) aliases.push("Remotive", "remotive");
    if (s.id.includes("careerjet")) aliases.push("Careerjet Kenya", "careerjet-kenya");
    if (s.id.includes("indeed")) aliases.push("Indeed Kenya", "indeed-kenya");

    for (const a of aliases) {
      const aJobs = db.prepare("SELECT count(id) as c FROM jobs WHERE source = ?").get(a);
      const aProv = db.prepare("SELECT count(id) as c FROM job_provenance WHERE source_id = ? OR source_name = ?").get(a, a);
      indexed = Math.max(indexed, aJobs?.c || 0);
      discovered = Math.max(discovered, aProv?.c || 0, indexed);
    }

    if (indexed > 0 || discovered > 0) {
      updateStmt.run(indexed, discovered, discovered, discovered, s.id);
      updatedCount++;
      console.log(`Updated [${s.id}] (${s.name}) -> Indexed: ${indexed}, Discovered: ${discovered}`);
    }
  }

  console.log(`\nSuccessfully synced metrics for ${updatedCount} sources from existing database jobs.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncSourceStats();
}
