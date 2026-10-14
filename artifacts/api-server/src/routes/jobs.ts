import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, like, ne, or } from "drizzle-orm";
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
import { activityTable, applicationsTable, db, jobsTable, jobProvenanceTable, jobRequirementVerificationsTable } from "@workspace/db";
import { fingerprintJob, isPotentialDuplicate, normalizeCompany, normalizeText } from "../lib/job-deduplication";
import { discoverAndMatchJobs } from "../lib/job-search-service";
import { getOrGenerateSearchDirective } from "../lib/search-directive";
import { evaluatePreIngestionGate } from "../lib/pre-ingestion-gate";
import { batchEvaluateQualifiedJobs } from "../lib/ai-job-evaluator";
import { getVerifiedMasterCv } from "../lib/cv-storage";
import { getOrGenerateCandidateEvidence } from "../lib/candidate-evidence";
import { verifyJobRequirementsForUser } from "../lib/job-search-service-enhanced";

const router: IRouter = Router();

router.get("/jobs/directive", async (_req, res): Promise<void> => {
  try {
    const directive = await getOrGenerateSearchDirective();
    res.json(directive);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to retrieve search directive" });
  }
});

router.post("/jobs/directive/refresh", async (_req, res): Promise<void> => {
  try {
    const directive = await getOrGenerateSearchDirective(true);
    res.json(directive);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to refresh search directive" });
  }
});

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

  // Find all jobs that have submitted applications
  const submittedApps = await db
    .select({ jobId: applicationsTable.jobId })
    .from(applicationsTable)
    .where(
      inArray(applicationsTable.status, [
        "SUBMITTED",
        "EMAIL_SENT",
        "AWAITING_RESPONSE",
        "RECRUITER_RESPONSE",
        "INTERVIEW",
        "ASSESSMENT",
        "OFFER",
      ]),
    );
  const appliedJobIds = new Set(submittedApps.map((a) => a.jobId));
  const appliedArray = Array.from(appliedJobIds);

  const tab = (req.query.tab as string | undefined)?.toLowerCase();
  const minScoreParam = req.query.minScore ? Number(req.query.minScore) : undefined;

  const filters = [];

  // Tab-based or status-based filtering
  if (tab === "strong" || req.query.aiDecision === "STRONG_MATCH") {
    const minThreshold = minScoreParam ?? 80;
    filters.push(
      eq(jobsTable.aiDecision, "STRONG_MATCH"),
      gte(jobsTable.matchScore, minThreshold),
      eq(jobsTable.isAiVerified, true),
      eq(jobsTable.hardEligibilityFailure, false),
    );
  } else if (tab === "potential" || req.query.aiDecision === "POTENTIAL_MATCH") {
    filters.push(
      eq(jobsTable.aiDecision, "POTENTIAL_MATCH"),
      gte(jobsTable.matchScore, 50),
      eq(jobsTable.hardEligibilityFailure, false),
    );
  } else if (tab === "insufficient" || req.query.aiDecision === "INSUFFICIENT_INFORMATION") {
    filters.push(eq(jobsTable.aiDecision, "INSUFFICIENT_INFORMATION"));
  } else if (tab === "rejected" || parsed.data.status === "REJECTED") {
    filters.push(
      or(
        eq(jobsTable.status, "REJECTED"),
        eq(jobsTable.aiDecision, "NOT_A_MATCH"),
        eq(jobsTable.aiDecision, "INELIGIBLE"),
        eq(jobsTable.hardEligibilityFailure, true),
      ),
    );
  } else if (tab === "applied" || parsed.data.status === "APPLIED") {
    filters.push(
      appliedArray.length > 0
        ? or(eq(jobsTable.status, "APPLIED"), inArray(jobsTable.id, appliedArray))
        : eq(jobsTable.status, "APPLIED"),
    );
  } else if (parsed.data.status) {
    filters.push(eq(jobsTable.status, parsed.data.status));
  } else if (tab !== "all") {
    // Default Active View: Strict AI-Verified mode hides rejected, ineligible, and hard failures
    filters.push(
      ne(jobsTable.status, "REJECTED"),
      ne(jobsTable.aiDecision, "NOT_A_MATCH"),
      ne(jobsTable.aiDecision, "INELIGIBLE"),
      eq(jobsTable.hardEligibilityFailure, false),
    );
  }

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

  let rows = await db
    .select()
    .from(jobsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(jobsTable.discoveredAt))
    .limit(500);

  // Ensure any job that has a submitted application is returned with status APPLIED
  const reconciledRows = rows.map((job) => {
    if (appliedJobIds.has(job.id) && job.status !== "APPLIED") {
      db.update(jobsTable).set({ status: "APPLIED" as any }).where(eq(jobsTable.id, job.id)).catch(() => {});
      return { ...job, status: "APPLIED" as const };
    }
    return job;
  });

  const validated = ListJobsResponse.parse(reconciledRows);
  const payload = validated.map((item, idx) => {
    const raw = reconciledRows[idx] as any;
    return {
      ...item,
      rejectionReason: raw.rejectionReason ?? null,
      matchReason: raw.matchReason ?? null,
      aiDecision: raw.aiDecision ?? null,
      aiProvider: raw.aiProvider ?? null,
      aiModel: raw.aiModel ?? null,
      aiEvaluatedAt: raw.aiEvaluatedAt ? new Date(raw.aiEvaluatedAt).toISOString() : null,
      evidenceFingerprint: raw.evidenceFingerprint ?? null,
      matchedSkills: raw.matchedSkills ?? [],
      missingSkills: raw.missingSkills ?? [],
      uncertainties: raw.uncertainties ?? [],
      isAiVerified: Boolean(raw.isAiVerified),
      hardEligibilityFailure: Boolean(raw.hardEligibilityFailure),
    };
  });

  res.json(payload);
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

  const [submittedApp] = await db
    .select({ id: applicationsTable.id })
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.jobId, job.id),
        inArray(applicationsTable.status, ["SUBMITTED", "EMAIL_SENT", "AWAITING_RESPONSE", "RECRUITER_RESPONSE", "INTERVIEW", "ASSESSMENT", "OFFER"]),
      ),
    )
    .limit(1);

  if (submittedApp && job.status !== "APPLIED") {
    job.status = "APPLIED" as any;
    db.update(jobsTable).set({ status: "APPLIED" as any }).where(eq(jobsTable.id, job.id)).catch(() => {});
  }

  const rawJob = job as any;
  res.json({
    ...GetJobResponse.parse(job),
    rejectionReason: rawJob.rejectionReason ?? null,
    matchReason: rawJob.matchReason ?? null,
    aiDecision: rawJob.aiDecision ?? null,
    aiProvider: rawJob.aiProvider ?? null,
    aiModel: rawJob.aiModel ?? null,
    aiEvaluatedAt: rawJob.aiEvaluatedAt ? new Date(rawJob.aiEvaluatedAt).toISOString() : null,
    evidenceFingerprint: rawJob.evidenceFingerprint ?? null,
    matchedSkills: rawJob.matchedSkills ?? [],
    missingSkills: rawJob.missingSkills ?? [],
    uncertainties: rawJob.uncertainties ?? [],
    isAiVerified: Boolean(rawJob.isAiVerified),
    hardEligibilityFailure: Boolean(rawJob.hardEligibilityFailure),
  });
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
    .select()
    .from(applicationsTable)
    .where(eq(applicationsTable.jobId, job.id))
    .limit(1);
  if (existingApplication) {
    res.status(200).json(
      TrackJobApplicationResponse.parse({
        ...existingApplication,
        jobTitle: job.title,
        company: job.company,
      }),
    );
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

router.post("/jobs/bulk", async (req, res): Promise<void> => {
  const { action, jobIds, status } = req.body || {};
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    res.status(400).json({ error: "jobIds array is required" });
    return;
  }

  const validIds = jobIds.filter((id) => typeof id === "string" && id.trim().length > 0);
  if (validIds.length === 0) {
    res.status(400).json({ error: "No valid job IDs provided" });
    return;
  }

  try {
    if (action === "status") {
      const allowedStatuses = ["DISCOVERED", "MATCHED", "SHORTLISTED", "APPLIED", "REJECTED", "IGNORED", "NEEDS_REVIEW"];
      if (!status || !allowedStatuses.includes(status)) {
        res.status(400).json({ error: `Invalid status. Must be one of: ${allowedStatuses.join(", ")}` });
        return;
      }
      await db.update(jobsTable)
        .set({ status: status as any })
        .where(inArray(jobsTable.id, validIds));

      res.json({ success: true, count: validIds.length, action: "status", status });
    } else if (action === "delete") {
      await db.delete(applicationsTable).where(inArray(applicationsTable.jobId, validIds)).catch(() => {});
      await db.delete(jobProvenanceTable).where(inArray(jobProvenanceTable.jobId, validIds)).catch(() => {});
      await db.delete(jobRequirementVerificationsTable).where(inArray(jobRequirementVerificationsTable.jobId, validIds)).catch(() => {});
      await db.delete(jobsTable).where(inArray(jobsTable.id, validIds));

      res.json({ success: true, count: validIds.length, action: "delete" });
    } else if (action === "verify") {
      const accountId = res.locals.accountId || "primary";
      const results: Record<string, any> = {};
      for (const id of validIds) {
        try {
          const verifyResult = await verifyJobRequirementsForUser(id, accountId);
          results[id] = verifyResult;
        } catch (e: any) {
          results[id] = { error: e?.message || "Verification failed" };
        }
      }
      res.json({ success: true, count: validIds.length, action: "verify", results });
    } else {
      res.status(400).json({ error: "Invalid action. Supported actions: status, delete, verify" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Bulk operation failed" });
  }
});

router.delete("/jobs/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "Job ID is required." });
    return;
  }
  try {
    // Delete associated applications first to avoid foreign key violations
    await db.delete(applicationsTable).where(eq(applicationsTable.jobId, id));
    const [deleted] = await db.delete(jobsTable).where(eq(jobsTable.id, id)).returning();
    if (!deleted) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    res.json({ success: true, deletedId: id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete job." });
  }
});

router.post("/jobs/wipe", async (_req, res): Promise<void> => {
  try {
    await db.delete(applicationsTable);
    await db.delete(jobsTable);
    res.json({ success: true, message: "All job records and associated applications have been wiped." });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to wipe job records." });
  }
});

router.post("/jobs/clean-all", async (_req, res): Promise<void> => {
  try {
    // Preserve all applications, applied jobs, and shortlist history
    // Run discoverAndMatchJobs with the new CV-aware directive & qualification gate
    const result = await discoverAndMatchJobs();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("Error during clean-all:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to clean and refresh jobs." });
  }
});

router.post("/jobs/re-evaluate", async (_req, res): Promise<void> => {
  try {
    const cvDossier = await getVerifiedMasterCv();
    if (!cvDossier.loaded || !cvDossier.cvRecord) {
      res.status(400).json({
        error: `Master CV verification failed: ${cvDossier.error || "Cannot load master CV file"}. Re-evaluation aborted.`,
      });
      return;
    }
    const evidence = await getOrGenerateCandidateEvidence();
    const directive = await getOrGenerateSearchDirective();
    const allJobs = await db.select().from(jobsTable);

    let rejectedByGate = 0;
    const candidatesForAi = [];

    for (const job of allJobs) {
      if (job.status === "APPLIED") continue;

      const gate = evaluatePreIngestionGate(
        {
          title: job.title,
          company: job.company,
          location: job.location,
          remote: job.remote,
          description: job.description,
          source: job.source,
          sourceUrl: job.sourceUrl,
        },
        directive,
      );

      if (!gate.qualified) {
        await db
          .update(jobsTable)
          .set({
            status: "REJECTED",
            rejectionReason: gate.rejectionReason || "Disqualified by pre-ingestion gate",
            aiDecision: "INELIGIBLE",
            hardEligibilityFailure: true,
          })
          .where(eq(jobsTable.id, job.id));
        rejectedByGate++;
      } else {
        candidatesForAi.push(job);
      }
    }

    // Run AI Evaluation
    const aiResults = await batchEvaluateQualifiedJobs(
      candidatesForAi,
      evidence,
      cvDossier.text,
      3,
    );

    let strongMatches = 0;
    let potentialMatches = 0;
    let rejectedByAi = 0;

    for (const job of candidatesForAi) {
      const result = aiResults.get(job.id);
      if (result) {
        let status: "MATCHED" | "NEEDS_REVIEW" | "REJECTED" = "NEEDS_REVIEW";
        if (result.decision === "STRONG_MATCH") {
          status = "MATCHED";
          strongMatches++;
        } else if (result.decision === "POTENTIAL_MATCH") {
          status = "NEEDS_REVIEW";
          potentialMatches++;
        } else if (result.decision === "INSUFFICIENT_INFORMATION") {
          status = "NEEDS_REVIEW";
        } else {
          status = "REJECTED";
          rejectedByAi++;
        }

        await db
          .update(jobsTable)
          .set({
            matchScore: result.matchScore,
            status: (job.status === "APPLIED" ? "APPLIED" : status) as any,
            matchReason: result.explanation,
            aiDecision: result.decision,
            aiProvider: result.providerUsed,
            aiModel: result.modelUsed,
            aiEvaluatedAt: new Date(result.evaluatedAt),
            evidenceFingerprint: result.evidenceFingerprint,
            matchedSkills: result.matchedSkills,
            missingSkills: result.missingSkills,
            uncertainties: result.uncertainties,
            isAiVerified: result.isAiVerified,
            hardEligibilityFailure: result.hardEligibilityFailure,
            rejectionReason:
              result.hardFailureReason ||
              (status === "REJECTED" ? result.explanation : null),
          })
          .where(eq(jobsTable.id, job.id));
      }
    }

    res.json({
      success: true,
      evaluated: allJobs.length,
      rejectedByGate,
      aiEvaluated: candidatesForAi.length,
      strongMatches,
      potentialMatches,
      rejectedByAi,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to re-evaluate jobs" });
  }
});

export default router;

