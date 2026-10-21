import { getAiBrainHealth } from "../artifacts/api-server/dist/lib/ai-job-evaluator.mjs";

console.log("Checking AI brain health via function...");
const health = await getAiBrainHealth(true);
console.log("Health result:", health);
