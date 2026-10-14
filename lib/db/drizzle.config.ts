import { defineConfig } from "drizzle-kit";
import path from "path";

const projectRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: path.resolve(
      projectRoot,
      process.env.SQLITE_PATH ?? "storage/data/ai-job-agent.sqlite",
    ),
  },
});
