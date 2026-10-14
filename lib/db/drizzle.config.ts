import { defineConfig } from "drizzle-kit";
import path from "path";

const projectRoot = path.resolve(__dirname, "../..");
const isTurso = Boolean(process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL);

export default defineConfig(
  isTurso
    ? {
        schema: "./src/schema/index.ts",
        dialect: "turso",
        dbCredentials: {
          url: (process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL)!,
          authToken: process.env.TURSO_AUTH_TOKEN,
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

