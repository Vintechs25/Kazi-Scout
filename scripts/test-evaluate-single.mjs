import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { evaluateSingleJob } = await import(pathToFileURL(path.join(root, "artifacts", "api-server", "src", "lib", "ai-job-evaluator.ts")).href);

console.log("Testing evaluateSingleJob...");
try {
  const result = await evaluateSingleJob({
    id: "test-123",
    title: "Consultant Surgeon",
    company: "Nairobi Hospital",
    location: "Nairobi, Kenya",
    description: "Seeking a qualified Consultant General Surgeon with MMed in Surgery and minimum 5 years experience.",
  });
  console.log("Result:", JSON.stringify(result, null, 2));
} catch (err) {
  console.error("evaluateSingleJob error:", err);
}
