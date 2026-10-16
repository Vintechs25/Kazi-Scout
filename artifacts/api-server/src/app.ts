import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import pinoHttp from "pino-http";
import router from "./routes/index";
import { logger } from "./lib/logger";
import type { ErrorRequestHandler } from "express";
import fs from "node:fs";
import { ensureDatabaseReady, isTursoConfigured } from "@workspace/db";

const app: Express = express();
const serveWeb = process.env.SERVE_WEB === "true";
const candidateDist1 = path.resolve(process.cwd(), "../ai-job-agent/dist/public");
const candidateDist2 = path.resolve(process.cwd(), "artifacts/ai-job-agent/dist/public");
const webDist = fs.existsSync(candidateDist1) ? candidateDist1 : candidateDist2;
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (_req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    serveWeb
      ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
      : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

if (process.env.VERCEL) {
  if (!process.env.SQLITE_PATH) {
    process.env.SQLITE_PATH = "/tmp/ai-job-agent.sqlite";
  }
  if (!process.env.CV_STORAGE_PATH) {
    process.env.CV_STORAGE_PATH = "/tmp/cvs";
  }
}

// Dedicated standalone health check endpoint that does not depend on
// database, external services, or heavy middleware
app.get(["/healthz", "/api/healthz"], (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const isTurso = isTursoConfigured();
  const isVercel = Boolean(process.env.VERCEL);
  res.status(200).json({
    status: "ok",
    ok: true,
    database: isTurso ? "turso" : "sqlite-local",
    isTurso,
    isVercel,
    storageStatus: isTurso ? "persistent" : isVercel ? "ephemeral" : "persistent-local",
  });
});

if (serveWeb) {
  app.use(express.static(webDist, { index: false }));
}

// Ensure database schema is ready before running any database-backed API routes
app.use("/api", async (_req, _res, next) => {
  try {
    await ensureDatabaseReady();
    next();
  } catch (err) {
    next(err);
  }
});

app.use("/api", router);
app.use("/", router);

if (serveWeb) {
  app.get("/{*splat}", (req, res, next) => {
    if (req.path === "/api" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(webDist, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}

const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  req.log.error({ err: error }, "Unhandled API error");
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  const status = code === "LIMIT_FILE_SIZE" ? 413 : code.startsWith("LIMIT_") ? 400 : 500;
  const message =
    status === 413
      ? "CV files must be 20 MB or smaller."
      : status === 400
        ? "Upload one PDF or DOCX CV at a time."
        : "The request could not be completed.";
  res.status(status).json({ error: message });
};
app.use(errorHandler);

export default app;
