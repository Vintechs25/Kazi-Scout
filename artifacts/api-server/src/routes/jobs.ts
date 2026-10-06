import { Router, type IRouter } from "express";
import { and, desc, eq, like, or } from "drizzle-orm";
import {
  CreateJobBody,
  CreateJobResponse,
  GetJobParams,
  GetJobResponse,
  ListJobsQueryParams,
  ListJobsResponse,
  TrackJobApplicationBody,
  TrackJobApplicationParams,
  TrackJobApplicationResponse,
  UpdateJobBody,
  UpdateJobParams,
  UpdateJobResponse,
} from "@workspace/api-zod";
import { activityTable, applicationsTable, db, jobsTable } from "@workspace/db";
import { fingerprintJob, isPotentialDuplicate, normalizeCompany, normalizeText } from "../lib/job-deduplication";

const router: IRouter = Router();

function uniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT")
  );
}

function duplicateResponse(res: Parameters<Parameters<typeof router.post>[1]>[1], jobId: string): void {
  res.status(409).json({
    error: "This looks like a job already in your list. No second record was created.",
    existingJobId: jobId,
  });
}

router.get("/jobs", async (req, res): Promise<void> => {
  const parsed = ListJobsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filters = [];
  if (parsed.data.status) filters.push(eq(jobsTable.status, parsed.data.status));
  if (parsed.data.q?.trim()) {
    const term = `%${parsed.data.q.trim()}%`;
    filters.push(
      or(
        like(jobsTable.title, term),
        like(jobsTable.company, term),
        like(jobsTable.location, term),
        like(jobsTable.description, term),
      ),
    );
  }
  const rows = await db
    .select()
    .from(jobsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(jobsTable.discoveredAt))
    .limit(500);
  res.json(ListJobsResponse.parse(rows));
});

router.post("/jobs", async (req, res): Promise<void> => {
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const input = parsed.data;
  const normalizedCompany = normalizeCompany(input.company);
  const normalizedTitle = normalizeText(input.title);
  const normalizedLocation = normalizeText(input.location ?? "");
  const fingerprint = fingerprintJob(input);

  const [fingerprintMatch] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(eq(jobsTable.fingerprint, fingerprint))
    .limit(1);
  if (fingerprintMatch) {
    duplicateResponse(res, fingerprintMatch.id);
    return;
  }
  if (input.externalJobId) {
    const [sourceMatch] = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.source, input.source),
          eq(jobsTable.externalJobId, input.externalJobId),
        ),
      )
      .limit(1);
    if (sourceMatch) {
      duplicateResponse(res, sourceMatch.id);
      return;
    }
  }

  const id = crypto.randomUUID();
  const now = new Date();
  try {
    const [job] = await db
      .insert(jobsTable)
      .values({
        id,
        ...input,
        normalizedCompany,
        normalizedTitle,
        normalizedLocation,
        fingerprint,
        status: "DISCOVERED",
        discoveredAt: now,
      })
      .returning();
    await db.insert(activityTable).values({
      id: crypto.randomUUID(),
      kind: "job",
      message: `Added ${job.title} at ${job.company}.`,
      createdAt: now,
    });
    res.status(201).json(CreateJobResponse.parse(job));
  } catch (error) {
    if (uniqueConflict(error)) {
      const [existing] = await db
        .select({ id: jobsTable.id })
        .from(jobsTable)
        .where(
          input.externalJobId
            ? or(
                eq(jobsTable.fingerprint, fingerprint),
                and(
                  eq(jobsTable.source, input.source),
                  eq(jobsTable.externalJobId, input.externalJobId),
                ),
              )
            : eq(jobsTable.fingerprint, fingerprint),
        )
        .limit(1);
      if (existing) {
        duplicateResponse(res, existing.id);
        return;
      }
    }
    throw error;
  }
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, params.data.id));
  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return;
  }
  res.json(GetJobResponse.parse(job));
});

router.patch("/jobs/:id", async (req, res): Promise<void> => {
  const params = UpdateJobParams.safeParse(req.params);
  const body = UpdateJobBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid job update." });
    return;
  }
  const [job] = await db
    .update(jobsTable)
    .set({ status: body.data.status })
    .where(eq(jobsTable.id, params.data.id))
    .returning();
  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return;
  }
  await db.insert(activityTable).values({
    id: crypto.randomUUID(),
    kind: "job",
    message: `${job.title} at ${job.company} marked ${job.status.toLowerCase().replaceAll("_", " ")}.`,
    createdAt: new Date(),
  });
  res.json(UpdateJobResponse.parse(job));
});

router.post("/jobs/:id/track", async (req, res): Promise<void> => {
  const params = TrackJobApplicationParams.safeParse(req.params);
  const body = TrackJobApplicationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid application tracking request." });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, params.data.id));
  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return;
  }

  const [existingApplication] = await db
    .select({ id: applicationsTable.id })
    .from(applicationsTable)
    .where(eq(applicationsTable.jobId, job.id))
    .limit(1);
  if (existingApplication) {
    res.status(409).json({ error: "An application record already exists for this job." });
    return;
  }

  const existingApplications = await db
    .select({ job: jobsTable, application: applicationsTable })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id));
  const similarApplication = existingApplications.find(({ job: otherJob }) =>
    isPotentialDuplicate(job, otherJob),
  );
  if (similarApplication) {
    res.status(409).json({
      error: `A similar job already has an application record (${similarApplication.job.title} at ${similarApplication.job.company}). Review it before creating another.`,
    });
    return;
  }

  const now = new Date();
  const id = crypto.randomUUID();
  let application;
  try {
    [application] = await db
      .insert(applicationsTable)
      .values({
        id,
        jobId: job.id,
        method: body.data.method,
        status: "NEEDS_REVIEW",
        matchScore: job.matchScore,
        appliedAt: now,
        lastActivityAt: now,
      })
      .returning();
  } catch (error) {
    if (uniqueConflict(error)) {
      res.status(409).json({ error: "An application record already exists for this job." });
      return;
    }
    throw error;
  }
  await db.insert(activityTable).values({
    id: crypto.randomUUID(),
    kind: "application",
    message: `Prepared a review record for ${job.title} at ${job.company}. Nothing was submitted.`,
    createdAt: now,
  });
  res.status(201).json(
    TrackJobApplicationResponse.parse({
      ...application,
      jobTitle: job.title,
      company: job.company,
    }),
  );
});

export default router;
