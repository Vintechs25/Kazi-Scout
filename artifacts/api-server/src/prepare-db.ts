import { ensureDatabaseReady, isTursoConfigured } from "@workspace/db";

async function main() {
  const target = isTursoConfigured() ? "Turso / libSQL (Production)" : "SQLite (Local)";
  console.log(`[Database Setup] Initializing and preparing database schema for ${target}...`);
  try {
    const results = await ensureDatabaseReady();
    console.log("[Database Setup] Database synchronization complete:");
    console.log(`  - Tables created: ${results.tablesCreated.length} (${results.tablesCreated.join(", ") || "none"})`);
    console.log(`  - Columns added: ${results.columnsAdded.length} (${results.columnsAdded.join(", ") || "none"})`);
    console.log(`  - Indexes created: ${results.indexesCreated.length} (${results.indexesCreated.join(", ") || "none"})`);
    console.log("[Database Setup] Database is ready for Kazi Scout.");
    process.exit(0);
  } catch (err) {
    console.error("[Database Setup Error]:", err);
    process.exit(1);
  }
}

main();
