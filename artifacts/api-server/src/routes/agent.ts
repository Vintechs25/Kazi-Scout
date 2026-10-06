import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  ControlAgentBody,
  ControlAgentResponse,
  GetAgentStatusResponse,
} from "@workspace/api-zod";
import { db, systemStateTable } from "@workspace/db";

const router: IRouter = Router();

async function getState() {
  const [state] = await db
    .select()
    .from(systemStateTable)
    .where(eq(systemStateTable.id, "agent"))
    .limit(1);
  return state;
}

router.get("/agent/status", async (_req, res): Promise<void> => {
  const state = await getState();
  res.json(
    GetAgentStatusResponse.parse({
      state: state?.agentState ?? "STOPPED",
      message: state?.agentMessage ?? "Background workers are not configured yet.",
      updatedAt: (state?.updatedAt ?? new Date()).toISOString(),
    }),
  );
});

router.post("/agent/control", async (req, res): Promise<void> => {
  const parsed = ControlAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.command !== "stop") {
    res.status(409).json({
      error: "Discovery workers and authorized job sources are not configured yet. The agent remains stopped.",
    });
    return;
  }

  const updatedAt = new Date();
  const [state] = await db
    .insert(systemStateTable)
    .values({
      id: "agent",
      agentState: "STOPPED",
      agentMessage: "Stopped. No automated applications or submissions can run.",
      updatedAt,
    })
    .onConflictDoUpdate({
      target: systemStateTable.id,
      set: {
        agentState: "STOPPED",
        agentMessage: "Stopped. No automated applications or submissions can run.",
        updatedAt,
      },
    })
    .returning();
  res.json(
    ControlAgentResponse.parse({
      state: state.agentState,
      message: state.agentMessage,
      updatedAt: state.updatedAt.toISOString(),
    }),
  );
});

export default router;
