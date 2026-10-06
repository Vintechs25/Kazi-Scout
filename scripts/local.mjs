import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const packageManager = isWindows ? "pnpm.cmd" : "pnpm";

try {
  process.loadEnvFile(path.join(root, ".env"));
} catch (error) {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "ENOENT"
  ) {
    throw error;
  }
}

function run(args, env = {}) {
  const result = spawnSync(packageManager, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: isWindows,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function setupDatabase() {
  const sqlitePath = path.resolve(
    root,
    process.env.SQLITE_PATH ?? "storage/data/ai-job-agent.sqlite",
  );
  mkdirSync(path.dirname(sqlitePath), { recursive: true });
  run(["--filter", "@workspace/db", "run", "push"]);
}

function buildWeb() {
  run(
    ["--filter", "@workspace/ai-job-agent", "run", "build"],
    { PORT: "5173", BASE_PATH: "/" },
  );
}

function startLocalApp(nodeEnv) {
  run(
    ["--filter", "@workspace/api-server", "run", "start"],
    {
      NODE_ENV: nodeEnv,
      PORT: "5000",
      SERVE_WEB: "true",
      LOCAL_APP: "true",
    },
  );
}

const command = process.argv[2];
if (command === "db:setup") {
  setupDatabase();
} else if (command === "build") {
  run(["run", "typecheck"]);
  run(["--filter", "@workspace/api-server", "run", "build"]);
  buildWeb();
} else if (command === "dev") {
  setupDatabase();
  run(["--filter", "@workspace/api-server", "run", "build"]);
  buildWeb();
  startLocalApp("development");
} else if (command === "start") {
  startLocalApp("production");
} else {
  process.stderr.write("Usage: npm run <dev|build|start|db:setup>\n");
  process.exit(2);
}
