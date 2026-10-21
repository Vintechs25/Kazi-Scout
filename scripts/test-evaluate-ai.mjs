import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { evaluateSingleJob } = await import(pathToFileURL(path.join(root, "artifacts", "api-server", "dist", "lib", "ai-job-evaluator.mjs")).href);

console.log("Testing evaluateSingleJob...");
try {
  const result = await evaluateSingleJob({
    id: "test-med-1",
    title: "Consultant General Surgeon",
    company: "The Nairobi Hospital",
    location: "Nairobi, Kenya",
    description: "The Nairobi Hospital seeks a Consultant General Surgeon. Requirements: MMed in General Surgery, KMPDC registration, 5+ years post-qualification surgical experience, demonstrated leadership in surgical theatre and inpatient care.",
  });
  console.log("Evaluation Result:", JSON.stringify(result, null, 2));
} catch (err) {
  console.error("evaluateSingleJob error:", err);
}
