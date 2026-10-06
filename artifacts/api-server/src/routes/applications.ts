import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { ListApplicationsResponse } from "@workspace/api-zod";
import { applicationsTable, db, jobsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/applications", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ application: applicationsTable, job: jobsTable })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .orderBy(desc(applicationsTable.appliedAt))
    .limit(500);

  res.json(
    ListApplicationsResponse.parse(
      rows.map(({ application, job }) => ({
        id: application.id,
        jobId: application.jobId,
        jobTitle: job.title,
        company: job.company,
        appliedAt: application.appliedAt.toISOString(),
        method: application.method,
        matchScore: application.matchScore,
        status: application.status,
        lastActivityAt: application.lastActivityAt.toISOString(),
      })),
    ),
  );
});

export default router;
