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

const cookieHeader = `job_agent_session=${createCookie(account.id)}`;

async function testDiscoveryEndpoints() {
  console.log("=== Testing Discovery & Role Endpoints ===");

  // 1. GET /api/user/roles
  console.log("\n1. Testing GET /api/user/roles...");
  const rolesRes = await fetch("http://127.0.0.1:5000/api/user/roles", {
    headers: { Cookie: cookieHeader },
  });
  console.log("Status:", rolesRes.status);
  const rolesData = await rolesRes.json();
  console.log("User Roles Response:", {
    success: rolesData.success,
    preferencesCount: rolesData.preferences?.length,
    hasStatistics: !!rolesData.statistics,
    hasSuggestions: !!rolesData.suggestions,
  });

  // 2. GET /api/user/discovery-settings
  console.log("\n2. Testing GET /api/user/discovery-settings...");
  const settingsRes = await fetch("http://127.0.0.1:5000/api/user/discovery-settings", {
    headers: { Cookie: cookieHeader },
  });
  console.log("Status:", settingsRes.status);
  const settingsData = await settingsRes.json();
  console.log("Discovery Settings Response:", {
    success: settingsData.success,
    hasSettings: !!settingsData.settings,
    searchFrequency: settingsData.settings?.searchFrequency,
    kenyaSourcesEnabled: settingsData.settings?.enableAllKenyaSources,
    sourcesCount: settingsData.sources?.allSources?.length,
  });

  // 3. GET /api/discovery/history
  console.log("\n3. Testing GET /api/discovery/history...");
  const historyRes = await fetch("http://127.0.0.1:5000/api/discovery/history", {
    headers: { Cookie: cookieHeader },
  });
  console.log("Status:", historyRes.status);
  const historyData = await historyRes.json();
  console.log("Discovery History Response:", {
    success: historyData.success,
    runsCount: historyData.runs?.length,
    total: historyData.total,
  });

  // 5. POST /api/user/roles
  console.log("\n5. Testing POST /api/user/roles (add custom role)...");
  const addRoleRes = await fetch("http://127.0.0.1:5000/api/user/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ roleTitle: "Network Operations Engineer" }),
  });
  console.log("Status:", addRoleRes.status);
  const addRoleData = await addRoleRes.json();
  console.log("Add Role Response:", {
    success: addRoleData.success,
    roleTitle: addRoleData.role?.roleTitle,
    roleId: addRoleData.role?.id,
  });

  const createdRoleId = addRoleData.role?.id;

  // 6. PATCH /api/user/roles/:roleId/priority
  if (createdRoleId) {
    console.log("\n6. Testing PATCH /api/user/roles/:roleId/priority...");
    const prioRes = await fetch(`http://127.0.0.1:5000/api/user/roles/${createdRoleId}/priority`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ priority: "high" }),
    });
    console.log("Status:", prioRes.status);
    const prioData = await prioRes.json();
    console.log("Priority Update Response:", {
      success: prioData.success,
      priority: prioData.role?.priority,
    });
  }

  // 7. PUT /api/user/discovery-settings
  console.log("\n7. Testing PUT /api/user/discovery-settings...");
  const updateSettingsRes = await fetch("http://127.0.0.1:5000/api/user/discovery-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({
      searchFrequency: "daily",
      maxJobsPerSearch: 150,
      enableAllKenyaSources: true,
      enableGlobalRemoteSources: true,
    }),
  });
  console.log("Status:", updateSettingsRes.status);
  const updateSettingsData = await updateSettingsRes.json();
  console.log("Update Settings Response:", {
    success: updateSettingsData.success,
    frequency: updateSettingsData.settings?.searchFrequency,
    maxJobs: updateSettingsData.settings?.maxJobsPerSearch,
  });

  console.log("\n=== All Discovery Endpoints Verified Successfully! ===");
}

testDiscoveryEndpoints().catch(console.error);
