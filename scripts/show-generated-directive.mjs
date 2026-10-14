import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts", "api-server", "package.json"));
const Database = require("better-sqlite3");

const dbPath = path.join(root, "storage", "data", "ai-job-agent.sqlite");
const db = new Database(dbPath, { readonly: true });

const profile = db.prepare("SELECT * FROM candidate_profiles WHERE id = 'primary'").get();
const masterCv = db.prepare("SELECT * FROM cvs WHERE is_master = 1").get();
const geminiSetting = db.prepare("SELECT * FROM integration_settings WHERE provider = 'gemini'").get();

console.log("Candidate Profile:", {
  fullName: profile.full_name,
  yearsExperience: profile.years_experience,
  city: profile.city,
  country: profile.country,
  targetRoles: JSON.parse(profile.target_roles || "[]"),
  skills: JSON.parse(profile.skills || "[]"),
  education: JSON.parse(profile.education || "[]"),
  certifications: JSON.parse(profile.certifications || "[]"),
});

console.log("\nMaster CV:", {
  id: masterCv?.id,
  filename: masterCv?.filename,
  isMaster: masterCv?.is_master,
});

console.log("\nGemini Integration:", {
  provider: geminiSetting?.provider,
  model: geminiSetting?.model,
  status: geminiSetting?.status,
});

db.close();
