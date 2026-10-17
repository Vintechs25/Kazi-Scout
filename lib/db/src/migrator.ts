import * as schema from "./schema/index";
import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { Client as LibsqlClient } from "@libsql/client/web";

export interface DatabaseExecutor {
  isTurso: boolean;
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<void>;
  executeMultiple(sql: string): Promise<void>;
}

export function createSqliteExecutor(sqlite: any): DatabaseExecutor {
  return {
    isTurso: false,
    async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      const stmt = sqlite.prepare(sql);
      return stmt.all(params) as T[];
    },
    async execute(sql: string, params: any[] = []): Promise<void> {
      const stmt = sqlite.prepare(sql);
      stmt.run(params);
    },
    async executeMultiple(sql: string): Promise<void> {
      sqlite.exec(sql);
    },
  };
}

export function createLibsqlExecutor(client: LibsqlClient): DatabaseExecutor {
  return {
    isTurso: true,
    async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      const result = await client.execute({ sql, args: params });
      return (result.rows || []) as T[];
    },
    async execute(sql: string, params: any[] = []): Promise<void> {
      await client.execute({ sql, args: params });
    },
    async executeMultiple(sql: string): Promise<void> {
      await client.executeMultiple(sql);
    },
  };
}

export function formatDefaultValue(val: any, _sqlType: string): string {
  if (val === undefined || val === null) return "";
  if (typeof val === "boolean") return ` DEFAULT ${val ? 1 : 0}`;
  if (typeof val === "number") return ` DEFAULT ${val}`;
  if (typeof val === "string") return ` DEFAULT '${val.replace(/'/g, "''")}'`;
  if (typeof val === "object") return ` DEFAULT '${JSON.stringify(val).replace(/'/g, "''")}'`;
  return "";
}

export function buildColumnDef(col: any, isAlterTable = false): string {
  const name = `"${col.name}"`;
  const type = (col.getSQLType() || "text").toLowerCase();
  let def = `${name} ${type}`;

  if (col.primary && !isAlterTable) {
    def += " PRIMARY KEY";
  }

  const hasExplicitDefault = col.hasDefault && col.default !== undefined;
  if (hasExplicitDefault) {
    def += formatDefaultValue(col.default, type);
  }

  if (col.notNull) {
    if (!isAlterTable) {
      def += " NOT NULL";
    } else {
      // In SQLite: ALTER TABLE ADD COLUMN requires a DEFAULT value when NOT NULL is specified.
      if (hasExplicitDefault) {
        def += " NOT NULL";
      } else {
        if (type.includes("int") || type.includes("real") || type.includes("num")) {
          def += " DEFAULT 0 NOT NULL";
        } else {
          def += " DEFAULT '' NOT NULL";
        }
      }
    }
  }

  // SQLite forbids UNIQUE in ALTER TABLE ADD COLUMN.
  // Unique constraints for migrated columns are safely added via CREATE UNIQUE INDEX.
  if (col.isUnique && !isAlterTable) {
    def += " UNIQUE";
  }

  return def;
}

export function buildCreateTableSql(table: any): string {
  const cfg = getTableConfig(table);
  const colDefs = cfg.columns.map((c: any) => buildColumnDef(c, false));
  return `CREATE TABLE IF NOT EXISTS "${cfg.name}" (\n  ${colDefs.join(",\n  ")}\n);`;
}

export interface SyncResult {
  tablesCreated: string[];
  columnsAdded: string[];
  indexesCreated: string[];
}

export async function synchronizeDatabaseSchema(executor: DatabaseExecutor): Promise<SyncResult> {
  const results: SyncResult = {
    tablesCreated: [],
    columnsAdded: [],
    indexesCreated: [],
  };

  // 1. Temporarily disable foreign keys so table creation order does not cause errors
  try {
    await executor.execute("PRAGMA foreign_keys = OFF;");
  } catch {
    // libSQL or remote might ignore PRAGMA foreign_keys
  }

  // 2. Discover existing tables
  let existingTables = new Set<string>();
  try {
    const tableRows = await executor.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream_%';"
    );
    existingTables = new Set(tableRows.map((r) => r.name));
  } catch (err) {
    console.warn("[DB Auto-Init] Note querying existing tables:", err);
  }

  // 3. Discover existing indexes
  let existingIndexes = new Set<string>();
  try {
    const indexRows = await executor.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%';"
    );
    existingIndexes = new Set(indexRows.map((r) => r.name));
  } catch (err) {
    console.warn("[DB Auto-Init] Note querying existing indexes:", err);
  }

  // 4. Discover existing columns for existing tables
  const existingColumns = new Map<string, Set<string>>();
  for (const tableName of existingTables) {
    try {
      const colRows = await executor.query<{ name: string }>(`PRAGMA table_info("${tableName}");`);
      existingColumns.set(tableName, new Set(colRows.map((c) => c.name)));
    } catch (e) {
      console.warn(`[DB Auto-Init] Note reading columns for ${tableName}:`, e);
    }
  }

  // 5. Gather all tables from Drizzle schema (source of truth)
  const schemaTables: any[] = [];
  for (const item of Object.values(schema)) {
    if (isTable(item)) {
      schemaTables.push(item);
    }
  }

  // 6. Ensure all tables exist or create them
  for (const table of schemaTables) {
    const cfg = getTableConfig(table);
    if (!existingTables.has(cfg.name)) {
      const ddl = buildCreateTableSql(table);
      try {
        await executor.execute(ddl);
        existingTables.add(cfg.name);
        existingColumns.set(cfg.name, new Set(cfg.columns.map((c: any) => c.name)));
        results.tablesCreated.push(cfg.name);
        console.log(`[DB Auto-Init] Created table "${cfg.name}"`);
      } catch (err: any) {
        const msg = String(err?.message || "");
        if (!msg.includes("already exists")) {
          console.error(`[DB Auto-Init] Failed to create table "${cfg.name}":`, err);
          throw err;
        }
      }
    } else {
      // 7. Table already exists: check for missing columns and apply safe column additions
      const liveCols = existingColumns.get(cfg.name) || new Set();
      for (const col of cfg.columns) {
        if (!liveCols.has(col.name)) {
          const colDef = buildColumnDef(col, true);
          const alterSql = `ALTER TABLE "${cfg.name}" ADD COLUMN ${colDef};`;
          try {
            await executor.execute(alterSql);
            liveCols.add(col.name);
            results.columnsAdded.push(`${cfg.name}.${col.name}`);
            console.log(`[DB Auto-Init] Added missing column "${cfg.name}"."${col.name}"`);
          } catch (err: any) {
            const msg = String(err?.message || "");
            if (!msg.includes("duplicate column") && !msg.includes("already exists")) {
              console.error(`[DB Auto-Init] Failed to add column "${cfg.name}"."${col.name}":`, err);
              throw err;
            }
          }
        }
      }
    }

    // Safe index upgrade: drop legacy non-composite unique indexes on jobs table
    if (cfg.name === "jobs") {
      if (existingIndexes.has("jobs_fingerprint_unique")) {
        try {
          await executor.execute('DROP INDEX IF EXISTS "jobs_fingerprint_unique";');
          existingIndexes.delete("jobs_fingerprint_unique");
        } catch {}
      }
      if (existingIndexes.has("jobs_source_external_id_unique")) {
        try {
          await executor.execute('DROP INDEX IF EXISTS "jobs_source_external_id_unique";');
          existingIndexes.delete("jobs_source_external_id_unique");
        } catch {}
      }
    }

    // 8. Ensure all table indexes exist
    for (const idx of cfg.indexes) {
      const idxName = idx.config.name;
      if (!existingIndexes.has(idxName)) {
        const isUnique = idx.config.unique ? "UNIQUE " : "";
        const cols = idx.config.columns.map((c: any) => `"${c.name}"`).join(", ");
        const idxSql = `CREATE ${isUnique}INDEX IF NOT EXISTS "${idxName}" ON "${cfg.name}" (${cols});`;
        try {
          await executor.execute(idxSql);
          existingIndexes.add(idxName);
          results.indexesCreated.push(idxName);
        } catch (err: any) {
          const msg = String(err?.message || "");
          if (!msg.includes("already exists")) {
            console.warn(`[DB Auto-Init] Warning creating index "${idxName}":`, err);
          }
        }
      }
    }

    // 9. Ensure unique columns have unique index
    for (const col of cfg.columns) {
      if (col.isUnique && !col.primary) {
        const uIdxName = `${cfg.name}_${col.name}_unique`;
        if (!existingIndexes.has(uIdxName)) {
          const uIdxSql = `CREATE UNIQUE INDEX IF NOT EXISTS "${uIdxName}" ON "${cfg.name}" ("${col.name}");`;
          try {
            await executor.execute(uIdxSql);
            existingIndexes.add(uIdxName);
            results.indexesCreated.push(uIdxName);
          } catch (err: any) {
            const msg = String(err?.message || "");
            if (!msg.includes("already exists")) {
              console.warn(`[DB Auto-Init] Warning creating unique index "${uIdxName}":`, err);
            }
          }
        }
      }
    }
  }

  // 10. Re-enable foreign keys
  try {
    await executor.execute("PRAGMA foreign_keys = ON;");
  } catch {
    // Ignore
  }

  // 11. Idempotent default seeding (never overwriting user configuration or accounts)
  try {
    await seedDefaultData(executor);
  } catch (seedErr) {
    console.warn("[DB Auto-Init] Note during default seeding:", seedErr);
  }

  return results;
}

async function seedDefaultData(executor: DatabaseExecutor): Promise<void> {
  // Idempotently seed system_state if table is empty
  try {
    const rows = await executor.query<{ count: number }>("SELECT count(*) as count FROM system_state;");
    const count = Number(rows[0]?.count ?? 0);
    if (count === 0) {
      const now = Math.floor(Date.now() / 1000);
      await executor.execute(
        `INSERT INTO system_state (id, agent_state, agent_message, application_mode, updated_at) ` +
        `VALUES ('agent', 'STOPPED', 'Agent is stopped. No automated actions are running.', 'approval', ${now});`
      );
      console.log("[DB Auto-Init] Seeded default system_state record.");
    }
  } catch (err) {
    console.warn("[DB Auto-Init] Note checking system_state for default seed:", err);
  }
}
