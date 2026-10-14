import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "artifacts", "api-server", "package.json"));
const Database = require("better-sqlite3");

const dbPath = path.join(root, "storage", "data", "ai-job-agent.sqlite");
const db = new Database(dbPath);

console.log("Checking tables before:");
console.log(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name));

const { db: drizzleDb } = await import("../lib/db/src/index.ts");

console.log("Checking tables after lib/db import:");
console.log(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name));

db.close();
