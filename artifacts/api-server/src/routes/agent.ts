import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  ControlAgentBody,
  ControlAgentResponse,
  GetAgentStatusResponse,
} from "@workspace/api-zod";
import { db, systemStateTable } from "@workspace/db";
import { handleAgentCommand, getAgentStatus } from "../lib/agent-worker";
import { discoverAndMatchJobs } from "../lib/job-search-service";

const router: IRouter = Router();

router.get("/agent/status", async (_req, res): Promise<void> => {
  try {
    const status = await getAgentStatus();
    res.json(
      GetAgentStatusResponse.parse({
        state: status.state,
        message: status.message,
        updatedAt: status.updatedAt.toISOString(),
      }),
    );
  } catch (error) {
    res.status(500).json(
      GetAgentStatusResponse.parse({
        state: "ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
        updatedAt: new Date().toISOString(),
      }),
    );
  }
});

router.post("/agent/trigger-search", async (_req, res): Promise<void> => {
  try {
    const result = await discoverAndMatchJobs();
    res.json({
      success: true,
      result,
    });
  } catch (error: any) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to trigger search",
    });
  }
});

router.post("/agent/control", async (req, res): Promise<void> => {
  const parsed = ControlAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await handleAgentCommand(parsed.data.command);
    res.json(
      ControlAgentResponse.parse({
        state: result.state,
        message: result.message,
        updatedAt: result.updatedAt,
      }),
    );
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    });
  }
});

export default router;
