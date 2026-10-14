/**
 * Agent Worker
 * Background job for automated job discovery and application
 * This would run as a separate process or in a worker thread
 */

import { db, systemStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { discoverAndMatchJobs } from "./job-search-service";
import { autoApplyToHighMatchJobs, checkForApplicationResponses } from "./application-service";
import { getGmailScope, GMAIL_SCOPES } from "./gmail-oauth-utils";

// Agent configuration
export interface AgentConfig {
  searchIntervalMinutes: number; // How often to search for new jobs
  applyIntervalMinutes: number; // How often to apply to jobs
  checkResponsesIntervalMinutes: number; // How often to check for responses
  minMatchScore: number; // Minimum score to auto-apply
  maxApplicationsPerRun: number; // Max applications per run
  applicationTemplate: string; // Template to use for applications
  autoApply: boolean; // Whether to auto-apply to jobs
  sources: string[]; // Which job sources to use
}

// Default configuration
const DEFAULT_CONFIG: AgentConfig = {
  searchIntervalMinutes: 60, // Search every hour
  applyIntervalMinutes: 120, // Apply every 2 hours
  checkResponsesIntervalMinutes: 180, // Check responses every 3 hours
  minMatchScore: 80, // Only apply to jobs with 80%+ match
  maxApplicationsPerRun: 5, // Max 5 applications per run
  applicationTemplate: "kenya-focused", // Use Kenya-focused template
  autoApply: true, // Auto-apply by default
  sources: ["kenya", "international"], // Search both Kenya and international
};

// Agent state management
let agentConfig: AgentConfig = { ...DEFAULT_CONFIG };
let isRunning = false;
let searchTimeout: NodeJS.Timeout | null = null;
let applyTimeout: NodeJS.Timeout | null = null;
let responseTimeout: NodeJS.Timeout | null = null;

/**
 * Update agent configuration
 */
export function configureAgent(config: Partial<AgentConfig>): AgentConfig {
  agentConfig = { ...agentConfig, ...config };
  return agentConfig;
}

/**
 * Get current agent configuration
 */
export function getAgentConfig(): AgentConfig {
  return { ...agentConfig };
}

/**
 * Update agent state in database
 */
async function updateAgentState(
  state: "STOPPED" | "STARTING" | "RUNNING" | "PAUSED" | "ERROR",
  message: string,
): Promise<void> {
  const updatedAt = new Date();
  await db
    .insert(systemStateTable)
    .values({
      id: "agent",
      agentState: state,
      agentMessage: message,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: systemStateTable.id,
      set: {
        agentState: state,
        agentMessage: message,
        updatedAt,
      },
    });
}

/**
 * Search for new jobs
 */
async function runJobSearch(): Promise<void> {
  try {
    console.log("[Agent] Starting job search...");
    await updateAgentState("RUNNING", "Searching for new jobs...");

    const result = await discoverAndMatchJobs();

    console.log("[Agent] Job search completed:");
    console.log(`  - Discovered: ${result.discovered}`);
    console.log(`  - Duplicates: ${result.duplicates}`);
    console.log(`  - Matched: ${result.matched}`);
    console.log(`  - High matches: ${result.highMatches.length}`);

    // If we have high matches and auto-apply is enabled, trigger application
    if (agentConfig.autoApply && result.highMatches.length > 0) {
      console.log(`[Agent] Found ${result.highMatches.length} high-match jobs. Preparing to apply...`);
    }

    await updateAgentState("RUNNING", `Last search: ${result.discovered} new, ${result.duplicates} duplicates, ${result.matched} matched`);
  } catch (error) {
    console.error("[Agent] Job search error:", error);
    await updateAgentState("ERROR", `Job search failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Apply to high-match jobs
 */
async function runJobApplications(): Promise<void> {
  try {
    console.log("[Agent] Starting job applications...");
    await updateAgentState("RUNNING", "Applying to high-match jobs...");

    const result = await autoApplyToHighMatchJobs(
      agentConfig.minMatchScore,
      agentConfig.maxApplicationsPerRun,
      agentConfig.applicationTemplate,
    );

    console.log("[Agent] Job applications completed:");
    console.log(`  - Applied: ${result.applied}`);
    console.log(`  - Skipped: ${result.skipped}`);
    console.log(`  - Errors: ${result.errors}`);

    await updateAgentState(
      "RUNNING",
      `Last application run: ${result.applied} applied, ${result.skipped} skipped, ${result.errors} errors`,
    );
  } catch (error) {
    console.error("[Agent] Job application error:", error);
    await updateAgentState("ERROR", `Application failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Check for application responses
 */
async function runResponseCheck(): Promise<void> {
  try {
    console.log("[Agent] Checking for application responses...");
    await updateAgentState("RUNNING", "Checking for application responses...");

    const result = await checkForApplicationResponses();

    console.log("[Agent] Response check completed:");
    console.log(`  - New responses: ${result.newResponses}`);
    console.log(`  - Interviews: ${result.interviews}`);
    console.log(`  - Rejections: ${result.rejections}`);

    await updateAgentState(
      "RUNNING",
      `Last response check: ${result.newResponses} responses, ${result.interviews} interviews, ${result.rejections} rejections`,
    );
  } catch (error) {
    console.error("[Agent] Response check error:", error);
    await updateAgentState("ERROR", `Response check failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Start the agent worker
 */
export async function startAgent(): Promise<void> {
  if (isRunning) {
    console.log("[Agent] Agent is already running");
    return;
  }

  console.log("[Agent] Starting agent worker...");
  isRunning = true;

  // Check if Gmail is configured
  // In a real implementation, we would check the database
  console.log("[Agent] Checking Gmail configuration...");

  // Initialize agent state
  await updateAgentState("STARTING", "Initializing agent worker...");

  // Start job search cycle
  await runJobSearch(); // Run immediately on start

  // Schedule regular job searches
  searchTimeout = setInterval(async () => {
    if (!isRunning) return;
    await runJobSearch();
  }, agentConfig.searchIntervalMinutes * 60000);

  // Schedule regular applications (offset by half the interval)
  setTimeout(() => {
    applyTimeout = setInterval(async () => {
      if (!isRunning) return;
      await runJobApplications();
    }, agentConfig.applyIntervalMinutes * 60000);
  }, (agentConfig.applyIntervalMinutes * 60000) / 2);

  // Schedule regular response checks (offset by 1/3 of the interval)
  setTimeout(() => {
    responseTimeout = setInterval(async () => {
      if (!isRunning) return;
      await runResponseCheck();
    }, agentConfig.checkResponsesIntervalMinutes * 60000);
  }, (agentConfig.checkResponsesIntervalMinutes * 60000) / 3);

  await updateAgentState("RUNNING", "Agent worker is running. Discovery and application cycles started.");
  console.log("[Agent] Agent worker started successfully");
}

/**
 * Stop the agent worker
 */
export async function stopAgent(): Promise<void> {
  if (!isRunning) {
    console.log("[Agent] Agent is already stopped");
    return;
  }

  console.log("[Agent] Stopping agent worker...");
  isRunning = false;

  // Clear all timeouts
  if (searchTimeout) clearInterval(searchTimeout);
  if (applyTimeout) clearInterval(applyTimeout);
  if (responseTimeout) clearInterval(responseTimeout);

  searchTimeout = null;
  applyTimeout = null;
  responseTimeout = null;

  await updateAgentState("STOPPED", "Agent worker stopped. No automated actions are running.");
  console.log("[Agent] Agent worker stopped successfully");
}

/**
 * Pause the agent worker
 */
export async function pauseAgent(): Promise<void> {
  if (!isRunning) {
    console.log("[Agent] Agent is not running, cannot pause");
    return;
  }

  console.log("[Agent] Pausing agent worker...");
  isRunning = false;

  // Clear all timeouts
  if (searchTimeout) clearInterval(searchTimeout);
  if (applyTimeout) clearInterval(applyTimeout);
  if (responseTimeout) clearInterval(responseTimeout);

  searchTimeout = null;
  applyTimeout = null;
  responseTimeout = null;

  await updateAgentState("PAUSED", "Agent worker paused. Discovery and application cycles suspended.");
  console.log("[Agent] Agent worker paused successfully");
}

/**
 * Resume the agent worker
 */
export async function resumeAgent(): Promise<void> {
  if (isRunning) {
    console.log("[Agent] Agent is already running");
    return;
  }

  console.log("[Agent] Resuming agent worker...");
  isRunning = true;

  // Restart all cycles
  searchTimeout = setInterval(async () => {
    if (!isRunning) return;
    await runJobSearch();
  }, agentConfig.searchIntervalMinutes * 60000);

  setTimeout(() => {
    applyTimeout = setInterval(async () => {
      if (!isRunning) return;
      await runJobApplications();
    }, agentConfig.applyIntervalMinutes * 60000);
  }, (agentConfig.applyIntervalMinutes * 60000) / 2);

  setTimeout(() => {
    responseTimeout = setInterval(async () => {
      if (!isRunning) return;
      await runResponseCheck();
    }, agentConfig.checkResponsesIntervalMinutes * 60000);
  }, (agentConfig.checkResponsesIntervalMinutes * 60000) / 3);

  await updateAgentState("RUNNING", "Agent worker resumed. Discovery and application cycles restarted.");
  console.log("[Agent] Agent worker resumed successfully");
}

/**
 * Run a manual job search and application cycle
 */
export async function runManualCycle(): Promise<{
  search: {
    discovered: number;
    duplicates: number;
    matched: number;
    highMatches: number;
  };
  apply: {
    applied: number;
    skipped: number;
    errors: number;
  };
}> {
  console.log("[Agent] Running manual cycle...");

  // Run search
  const searchResult = await discoverAndMatchJobs();

  // Run applications if auto-apply is enabled
  let applyResult = { applied: 0, skipped: 0, errors: 0 };
  if (agentConfig.autoApply) {
    applyResult = await autoApplyToHighMatchJobs(
      agentConfig.minMatchScore,
      agentConfig.maxApplicationsPerRun,
      agentConfig.applicationTemplate,
    );
  }

  console.log("[Agent] Manual cycle completed:");
  console.log(`  - Search: ${searchResult.discovered} discovered, ${searchResult.matched} matched`);
  console.log(`  - Apply: ${applyResult.applied} applied, ${applyResult.skipped} skipped`);

  return {
    search: {
      discovered: searchResult.discovered,
      duplicates: searchResult.duplicates,
      matched: searchResult.matched,
      highMatches: searchResult.highMatches.length,
    },
    apply: {
      applied: applyResult.applied,
      skipped: applyResult.skipped,
      errors: applyResult.errors,
    },
  };
}

/**
 * Get agent status
 */
export async function getAgentStatus() {
  const [state] = await db
    .select()
    .from(systemStateTable)
    .where(eq(systemStateTable.id, "agent"))
    .limit(1);

  return {
    state: state?.agentState ?? "STOPPED",
    message: state?.agentMessage ?? "Background workers are not configured yet.",
    updatedAt: state?.updatedAt ?? new Date(),
    isRunning,
    config: agentConfig,
  };
}

/**
 * Handle agent command
 */
export async function handleAgentCommand(
  command: "start" | "pause" | "resume" | "stop" | "runNow",
): Promise<{ state: string; message: string; updatedAt: string }> {
  const updatedAt = new Date();

  switch (command) {
    case "start":
      await startAgent();
      return {
        state: "RUNNING",
        message: "Agent worker started. Discovery and application cycles active.",
        updatedAt: updatedAt.toISOString(),
      };

    case "pause":
      await pauseAgent();
      return {
        state: "PAUSED",
        message: "Agent worker paused. All automated actions suspended.",
        updatedAt: updatedAt.toISOString(),
      };

    case "resume":
      await resumeAgent();
      return {
        state: "RUNNING",
        message: "Agent worker resumed. Discovery and application cycles restarted.",
        updatedAt: updatedAt.toISOString(),
      };

    case "stop":
      await stopAgent();
      return {
        state: "STOPPED",
        message: "Agent worker stopped. No automated actions are running.",
        updatedAt: updatedAt.toISOString(),
      };

    case "runNow":
      const result = await runManualCycle();
      return {
        state: "RUNNING",
        message: `Manual run: ${result.search.discovered} jobs discovered, ${result.apply.applied} applications sent.`,
        updatedAt: updatedAt.toISOString(),
      };

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// Export for use in routes
export {
  startAgent as start,
  stopAgent as stop,
  pauseAgent as pause,
  resumeAgent as resume,
  runManualCycle as runNow,
};
