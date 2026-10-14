import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, copyFile, writeFile, cp, mkdir } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/app.ts"),
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

  // Dereference native SQLite dependencies into real folders
  async function copyNativePackage(pkgName, searchPaths, targetDirs) {
    try {
      const pkgJsonPath = require.resolve(`${pkgName}/package.json`, {
        paths: searchPaths,
      });
      const srcDir = path.dirname(pkgJsonPath);
      for (const destRoot of targetDirs) {
        const destDir = path.resolve(destRoot, pkgName);
        if (path.resolve(srcDir) === path.resolve(destDir)) continue;
        await rm(destDir, { recursive: true, force: true }).catch(() => {});
        await mkdir(path.dirname(destDir), { recursive: true });
        await cp(srcDir, destDir, { recursive: true, dereference: true });
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

