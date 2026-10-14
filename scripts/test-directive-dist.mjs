import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// We can run against dist/index.mjs or call the generator logic directly
async function test() {
  const { getOrGenerateSearchDirective } = await import("../artifacts/api-server/dist/index.mjs");
  if (getOrGenerateSearchDirective) {
    const directive = await getOrGenerateSearchDirective();
    console.log("DIRECTIVE RESULT:", JSON.stringify(directive, null, 2));
  } else {
    console.log("getOrGenerateSearchDirective not directly exported from root index");
  }
}

test().catch(err => {
  console.log("Direct import test:", err.message);
});
