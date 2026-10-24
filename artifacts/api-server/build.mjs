import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, copyFile, writeFile, cp, mkdir, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true }).catch(() => {});

  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/app.ts"),
      path.resolve(artifactDir, "src/prepare-db.ts"),
      path.resolve(artifactDir, "src/lib/connectors/kenya-aggressive-crawler.ts"),
      path.resolve(artifactDir, "src/routes/cvs.ts"),
      path.resolve(artifactDir, "src/lib/pre-ingestion-gate.ts"),
      path.resolve(artifactDir, "src/lib/search-directive.ts"),
      path.resolve(artifactDir, "src/lib/ai-job-evaluator.ts"),
      path.resolve(artifactDir, "src/lib/cv-role-engine.ts"),
      path.resolve(artifactDir, "src/lib/enhanced-job-search-service.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "libsql",
      "pdfjs-dist/*",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  await copyFile(path.resolve(distDir, "app.mjs"), path.resolve(distDir, "app.js"));
  await copyFile(path.resolve(distDir, "index.mjs"), path.resolve(distDir, "index.js"));
  await copyFile(path.resolve(distDir, "prepare-db.mjs"), path.resolve(distDir, "prepare-db.js"));

  // Ensure dist is explicitly marked as ESM
  await writeFile(
    path.resolve(distDir, "package.json"),
    JSON.stringify({ type: "module" }, null, 2)
  );

  // Expose root bridge entrypoints for Vercel
  await writeFile(
    path.resolve(artifactDir, "app.js"),
    'export { default } from "./dist/app.js";\n'
  );
  await writeFile(
    path.resolve(artifactDir, "app.mjs"),
    'export { default } from "./dist/app.mjs";\n'
  );
  await writeFile(
    path.resolve(artifactDir, "index.js"),
    'export * from "./dist/index.js";\n'
  );
  await writeFile(
    path.resolve(artifactDir, "index.mjs"),
    'export * from "./dist/index.mjs";\n'
  );
  await writeFile(
    path.resolve(artifactDir, "prepare-db.js"),
    'export * from "./dist/prepare-db.js";\n'
  );
  await writeFile(
    path.resolve(artifactDir, "prepare-db.mjs"),
    'export * from "./dist/prepare-db.mjs";\n'
  );

  // If production database credentials exist at build time, run database preparation
  if (process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL) {
    try {
      console.log("[Build] Detected production database configuration. Initializing database schema...");
      const { ensureDatabaseReady } = await import(path.resolve(distDir, "index.mjs"));
      const res = await ensureDatabaseReady();
      console.log(`[Build] Database ready (created ${res.tablesCreated.length} tables, ${res.columnsAdded.length} columns, ${res.indexesCreated.length} indexes).`);
    } catch (err) {
      console.warn("[Build] Database synchronization note during build:", err.message);
      console.warn("[Build] Database will complete synchronization on application startup.");
    }
  }

  // Dereference native SQLite dependencies into real folders
  async function copyFolderSafely(src, dest) {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.resolve(src, entry.name);
      const destPath = path.resolve(dest, entry.name);
      if (entry.isDirectory()) {
        await copyFolderSafely(srcPath, destPath);
      } else {
        try {
          await copyFile(srcPath, destPath);
        } catch (e) {
          // If locked on Windows (e.g. .node binary currently loaded), skip if target exists
          if (!existsSync(destPath)) {
            console.warn(`[Build] Warning copying file ${destPath}: ${e.message}`);
          }
        }
      }
    }
  }

  async function patchBetterSqlitePackage(dir) {
    try {
      const pJsonPath = path.resolve(dir, "package.json");
      if (existsSync(pJsonPath)) {
        const raw = await readFile(pJsonPath, "utf-8");
        const parsed = JSON.parse(raw);
        let changed = false;
        if (!parsed.exports) {
          parsed.exports = {
            ".": "./lib/index.js",
            "./*": "./*"
          };
          changed = true;
        }
        if (changed) {
          await writeFile(pJsonPath, JSON.stringify(parsed, null, 2));
        }
      }
      // Create bridge files in case resolution falls back to index.js
      await writeFile(path.resolve(dir, "index.js"), 'module.exports = require("./lib/index.js");\n');
      await writeFile(path.resolve(dir, "index.cjs"), 'module.exports = require("./lib/index.js");\n');
      await writeFile(
        path.resolve(dir, "index.mjs"),
        'import b from "./lib/index.js";\nexport default b;\nexport * from "./lib/index.js";\n'
      );
    } catch (err) {
      console.warn(`[Build] Note patching ${dir}: ${err.message}`);
    }
  }

  async function copyNativePackage(pkgName, searchPaths, targetDirs) {
    try {
      const pkgJsonPath = require.resolve(`${pkgName}/package.json`, {
        paths: searchPaths,
      });
      const srcDir = path.dirname(pkgJsonPath);
      for (const destRoot of targetDirs) {
        const destDir = path.resolve(destRoot, pkgName);
        if (path.resolve(srcDir) === path.resolve(destDir)) continue;
        try {
          await copyFolderSafely(srcDir, destDir);
        } catch (copyErr) {
          console.warn(`[Build] Warning copying to ${destDir}: ${copyErr.message}`);
        }
      }
      return srcDir;
    } catch (e) {
      console.warn(`[Build] Note for ${pkgName}: ${e.message}`);
      return null;
    }
  }

  const targetNodeModules = [
    path.resolve(distDir, "node_modules"),
    path.resolve(artifactDir, "node_modules"),
    path.resolve(artifactDir, "../../node_modules"),
  ];

  const searchRoots = [
    artifactDir,
    path.resolve(artifactDir, "../../"),
  ];

  const bSrc = await copyNativePackage("better-sqlite3", searchRoots, targetNodeModules);
  if (bSrc) {
    await patchBetterSqlitePackage(bSrc);
  }
  for (const root of targetNodeModules) {
    await patchBetterSqlitePackage(path.resolve(root, "better-sqlite3"));
  }

  const binSrc = await copyNativePackage("bindings", [bSrc, ...searchRoots].filter(Boolean), [
    ...targetNodeModules,
    path.resolve(distDir, "node_modules/better-sqlite3/node_modules"),
    path.resolve(artifactDir, "node_modules/better-sqlite3/node_modules"),
  ]);
  await copyNativePackage("file-uri-to-path", [binSrc, bSrc, ...searchRoots].filter(Boolean), [
    ...targetNodeModules,
    path.resolve(distDir, "node_modules/better-sqlite3/node_modules"),
    path.resolve(artifactDir, "node_modules/better-sqlite3/node_modules"),
    path.resolve(distDir, "node_modules/bindings/node_modules"),
    path.resolve(artifactDir, "node_modules/bindings/node_modules"),
  ]);
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});

