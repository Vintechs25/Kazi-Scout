// Deployment-specific configuration for Vercel Serverless Functions
if (process.env.VERCEL) {
  if (!process.env.SQLITE_PATH) {
    process.env.SQLITE_PATH = "/tmp/ai-job-agent.sqlite";
  }
  if (!process.env.CV_STORAGE_PATH) {
    process.env.CV_STORAGE_PATH = "/tmp/cvs";
  }
}

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  process.env.SESSION_SECRET = "dev_secret_key_1234567890abcdefghijklmnopqrstuv";
}

// Import existing Express application without altering architecture
const { default: app } = await import("../artifacts/api-server/src/app");

export default app;
