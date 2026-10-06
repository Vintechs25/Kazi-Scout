import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { GetDashboardResponse } from "@workspace/api-zod";
import { activityTable, applicationsTable, db, jobsTable, systemStateTable } from "@workspace/db";

const router: IRouter = Router();
const submittedStatuses = new Set([
  "SUBMITTED",
  "EMAIL_SENT",
  "AWAITING_RESPONSE",
  "RECRUITER_RESPONSE",
  "INTERVIEW",
  "ASSESSMENT",
  "OFFER",
]);
const responseStatuses = new Set([
  "RECRUITER_RESPONSE",
  "INTERVIEW",
  "ASSESSMENT",
  "OFFER",
  "REJECTED",
]);

router.get("/dashboard", async (_req, res): Promise<void> => {
  const [jobs, applications, activity, state] = await Promise.all([
    db.select().from(jobsTable),
    db.select().from(applicationsTable),
    db.select().from(activityTable).orderBy(desc(activityTable.createdAt)).limit(12),
    db.select().from(systemStateTable).limit(1),
  ]);
  const submitted = applications.filter((application) => submittedStatuses.has(application.status));
  const responded = applications.filter((application) => responseStatuses.has(application.status));
  const [topMatch] = jobs
    .filter((job) => job.matchScore !== null)
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
  const currentState = state[0];

  res.json(
    GetDashboardResponse.parse({
      jobsDiscovered: jobs.length,
      newMatches: jobs.filter((job) => job.status === "MATCHED").length,
      applicationsSubmitted: submitted.length,
      applicationsPending: applications.filter((application) =>
        ["NEEDS_REVIEW", "PREPARING", "READY_TO_SUBMIT", "AWAITING_RESPONSE"].includes(application.status),
      ).length,
      interviews: applications.filter((application) => application.status === "INTERVIEW").length,
      offers: applications.filter((application) => application.status === "OFFER").length,
      responseRate: submitted.length ? Math.round((responded.length / submitted.length) * 100) : 0,
      topMatchScore: topMatch?.matchScore ?? null,
      jobsAwaitingReview: jobs.filter((job) => job.status === "NEEDS_REVIEW").length,
      agent: {
        state: currentState?.agentState ?? "STOPPED",
        message: currentState?.agentMessage ?? "Background workers are not configured yet.",
        updatedAt: (currentState?.updatedAt ?? new Date()).toISOString(),
      },
      recentActivity: activity.map((item) => ({
        id: item.id,
        message: item.message,
        createdAt: item.createdAt.toISOString(),
      })),
    }),
  );
});

export default router;
