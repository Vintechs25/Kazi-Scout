import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const projectRoot = path.resolve(process.cwd(), "../..");
const databasePath = path.resolve(
  projectRoot,
  process.env.SQLITE_PATH ?? "storage/data/ai-job-agent.sqlite",
);
mkdirSync(path.dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
export const db = drizzle(sqlite, { schema });

export * from "./schema";
