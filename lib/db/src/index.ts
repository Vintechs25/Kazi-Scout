import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { drizzle as drizzleBetterSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql/web";
import { createClient, type Client as LibsqlClient } from "@libsql/client/web";
import * as schema from "./schema/index";
import {
  createLibsqlExecutor,
  createSqliteExecutor,
  synchronizeDatabaseSchema,
  type DatabaseExecutor,
  type SyncResult,
} from "./migrator";

const _req = createRequire(import.meta.url);

function loadBetterSqlite3(): any {
  const currentFile = typeof import.meta.url === "string" ? fileURLToPath(import.meta.url) : "";
  const currentDir = currentFile ? path.dirname(currentFile) : process.cwd();
  const searchDirs = [
    process.cwd(),
    currentDir,
    path.resolve(currentDir, ".."),
    path.resolve(currentDir, "../.."),
    path.resolve(currentDir, "node_modules"),
    path.resolve(currentDir, "../node_modules"),
    path.resolve(currentDir, "../../node_modules"),
    path.resolve(process.cwd(), "artifacts/api-server"),
    path.resolve(process.cwd(), "artifacts/api-server/dist"),
    path.resolve(process.cwd(), "node_modules/better-sqlite3"),
    path.resolve(process.cwd(), "artifacts/api-server/node_modules/better-sqlite3"),
    path.resolve(process.cwd(), "dist/node_modules/better-sqlite3"),
    "/var/task",
    "/var/task/dist",
    "/var/task/node_modules/better-sqlite3",
    "/var/task/dist/node_modules/better-sqlite3",
  ];
  for (const dir of searchDirs) {
    try {
      const resolved = _req.resolve("better-sqlite3", { paths: [dir] });
      const mod = _req(resolved);
      return mod.default || mod;
    } catch {
      // try next
    }
  }
  return _req("better-sqlite3");
}

function getDatabasePath(): string {
  if (process.env.SQLITE_PATH === ":memory:") return ":memory:";
  if (process.env.SQLITE_PATH) return path.resolve(process.cwd(), process.env.SQLITE_PATH);
  if (process.env.VERCEL) {
    if (process.platform === "win32") {
      return path.resolve(process.env.TEMP || "storage/data", "ai-job-agent.sqlite");
    }
    return "/tmp/ai-job-agent.sqlite";
  }
  
  const candidates = [
    path.resolve(process.cwd(), "storage/data/ai-job-agent.sqlite"),
    path.resolve(process.cwd(), "../storage/data/ai-job-agent.sqlite"),
    path.resolve(process.cwd(), "../../storage/data/ai-job-agent.sqlite"),
  ];
  
  const existing = candidates.filter(c => existsSync(c));
  if (existing.length > 0) {
    existing.sort((a, b) => {
      try {
        return statSync(b).size - statSync(a).size;
      } catch {
        return 0;
      }
    });
    return existing[0];
  }
  return candidates[0];
}

let _sqliteInstance: any = null;
let _libsqlClient: LibsqlClient | null = null;
let _drizzleInstance: any = null;
let _readyPromise: Promise<SyncResult> | null = null;

export function getDatabaseInstance(): any {
  if (!_sqliteInstance) {
    const Database = loadBetterSqlite3();
    const databasePath = getDatabasePath();
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    const sqlite = new Database(databasePath);
    try {
      if (!process.env.VERCEL) {
        sqlite.pragma("journal_mode = WAL");
      } else {
        sqlite.pragma("journal_mode = DELETE");
      }
      sqlite.pragma("foreign_keys = ON");
    } catch (err) {
      console.warn("[SQLite Init] Note configuring pragmas:", err);
    }
    _sqliteInstance = sqlite;
  }
  return _sqliteInstance;
}

export function isTursoConfigured(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL);
}

export function getLibsqlClient(): LibsqlClient {
  if (!_libsqlClient) {
    const url = (process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL)!.trim();
    const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
    _libsqlClient = createClient({
      url,
      authToken,
    });
  }
  return _libsqlClient;
}

/**
 * Ensures the database schema is completely initialized and synchronized
 * with the Drizzle schema source of truth. Safe to call concurrently and repeatedly.
 */
export async function ensureDatabaseReady(): Promise<SyncResult> {
  if (!_readyPromise) {
    _readyPromise = (async () => {
      let executor: DatabaseExecutor;
      if (isTursoConfigured()) {
        const client = getLibsqlClient();
        executor = createLibsqlExecutor(client);
      } else {
        const sqlite = getDatabaseInstance();
        executor = createSqliteExecutor(sqlite);
      }
      return await synchronizeDatabaseSchema(executor);
    })().catch((err) => {
      _readyPromise = null; // Reset so subsequent requests can retry on transient failures
      throw err;
    });
  }
  return _readyPromise;
}

export function getDb(): ReturnType<typeof drizzleBetterSqlite<typeof schema>> {
  if (!_drizzleInstance) {
    if (isTursoConfigured()) {
      const client = getLibsqlClient();
      _drizzleInstance = drizzleLibsql(client, { schema });
    } else {
      const sqlite = getDatabaseInstance();
      _drizzleInstance = drizzleBetterSqlite(sqlite, { schema });
    }
    // Proactively trigger non-blocking schema check on connection
    void ensureDatabaseReady().catch((err) => {
      console.error("[Database Ready Note]:", err);
    });
  }
  return _drizzleInstance;
}

export const db: ReturnType<typeof drizzleBetterSqlite<typeof schema>> = new Proxy(
  {} as ReturnType<typeof drizzleBetterSqlite<typeof schema>>,
  {
    get(_target, prop, receiver) {
      const instance = getDb() as any;
      const value = Reflect.get(instance, prop, receiver);
      if (typeof value === "function") {
        return value.bind(instance);
      }
      return value;
    },
  }
);

export * from "./schema/index";
export * from "./migrator";
