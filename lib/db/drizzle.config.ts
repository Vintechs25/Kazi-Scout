import { defineConfig } from "drizzle-kit";
import path from "path";

const projectRoot = path.resolve(__dirname, "../..");
const tursoUrl = (
  process.env.TURSO_DATABASE_URL ||
  process.env.TURSO_URL ||
  process.env.TURSO_DB_URL ||
  process.env.LIBSQL_URL ||
  process.env.DATABASE_URL ||
  ""
).replace(/^["']|["']$/g, "").trim();

const tursoToken = (
  process.env.TURSO_AUTH_TOKEN ||
  process.env.TURSO_TOKEN ||
  process.env.LIBSQL_AUTH_TOKEN ||
  process.env.DATABASE_AUTH_TOKEN ||
  ""
).replace(/^["']|["']$/g, "").trim();

const isTurso = Boolean(tursoUrl && !tursoUrl.endsWith(".sqlite") && !tursoUrl.endsWith(".db"));

export default defineConfig(
  isTurso
    ? {
        schema: "./src/schema/index.ts",
        dialect: "turso",
        dbCredentials: {
          url: tursoUrl,
          authToken: tursoToken || undefined,
        },
      }
    : {
        schema: "./src/schema/index.ts",
        dialect: "sqlite",
        dbCredentials: {
          url: path.resolve(
            projectRoot,
            process.env.SQLITE_PATH ?? "storage/data/ai-job-agent.sqlite",
          ),
        },
      }
);

