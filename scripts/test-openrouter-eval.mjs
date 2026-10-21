import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts", "api-server", "package.json"));
const Database = require("better-sqlite3");

const { decryptCredentials } = await import(pathToFileURL(path.join(root, "artifacts", "api-server", "src", "lib", "credential-encryption.ts")).href);

const db = new Database(path.join(root, "storage", "data", "ai-job-agent.sqlite"), { readonly: true });
const row = db.prepare("SELECT encrypted_credentials, model FROM integration_settings WHERE provider = 'openai'").get();
db.close();

const creds = decryptCredentials(row.encrypted_credentials);
console.log("Model:", row.model);
const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${creds.apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: row.model,
    messages: [
      { role: "system", content: "You are a JSON assistant." },
      { role: "user", content: "Return JSON: {\"result\": \"pass\"}" }
    ],
    response_format: { type: "json_object" },
  }),
});

console.log("Status with json_object:", res.status);
const text = await res.text();
console.log("Body:", text.slice(0, 300));
