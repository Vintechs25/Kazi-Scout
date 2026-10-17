import { randomUUID } from "node:crypto";
import path from "node:path";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { applicationsTable, candidateProfilesTable, cvsTable, db, jobsTable, activityTable } from "@workspace/db";
import { extractApplicationDetails } from "../lib/application-extractor";
import { generateTailoredCoverLetter } from "../lib/cover-letter-generator";
import { sendApplicationEmail } from "../lib/email-dispatcher";
import { getAuthenticatedAccountId } from "../lib/auth";

import fs from "node:fs";

const router: IRouter = Router();

function getAccountId(req: any, res: any): string {
  return res?.locals?.accountId || getAuthenticatedAccountId(req) || "";
}

async function getProfileForAccount(accountId: string) {
  const [profile] = await db
    .select()
    .from(candidateProfilesTable)
    .where(
      accountId === "local"
        ? or(eq(candidateProfilesTable.id, "primary"), eq(candidateProfilesTable.id, "local"))
        : eq(candidateProfilesTable.id, accountId)
    )
    .limit(1);
  return profile;
}

function getStorageDir(): string {
  const custom = process.env.CV_STORAGE_PATH ?? (process.env.VERCEL ? "/tmp/cvs" : "storage/cvs");
  if (path.isAbsolute(custom)) return custom;
  const candidates = [
    path.resolve(process.cwd(), custom),
    path.resolve(process.cwd(), "..", custom),
    path.resolve(process.cwd(), "../..", custom),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(process.cwd(), custom);
}

const storageDir = getStorageDir();

/**
 * List all application records
 */
router.get("/applications", async (req, res): Promise<void> => {
  const accountId = getAccountId(req, res);
  if (!accountId) {
    res.json([]);
    return;
  }
  const appAccountFilter = accountId === "local"
    ? or(eq(applicationsTable.accountId, "local"), isNull(applicationsTable.accountId))
    : eq(applicationsTable.accountId, accountId);

  const rows = await db
    .select({
      application: applicationsTable,
      job: jobsTable,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .where(appAccountFilter)
    .orderBy(desc(applicationsTable.appliedAt))
    .limit(500);

  const result = rows.map(({ application, job }) => ({
    id: application.id,
    jobId: application.jobId,
    jobTitle: job.title,
    company: job.company,
    location: job.location,
    remote: job.remote,
    source: job.source,
    sourceUrl: job.sourceUrl,
    appliedAt: application.appliedAt.toISOString(),
    method: application.method,
    matchScore: application.matchScore,
    status: application.status,
    recipientEmail: application.recipientEmail,
    subjectLine: application.subjectLine,
    coverLetter: application.coverLetter,
    attachedDocumentIds: application.attachedDocumentIds
      ? JSON.parse(application.attachedDocumentIds)
      : [],
    lastActivityAt: application.lastActivityAt.toISOString(),
  }));

  res.json(result);
});

/**
 * Get a single application with full details
 */
router.get("/applications/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const accountId = getAccountId(req, res);
  const appAccountFilter = accountId === "local"
    ? or(eq(applicationsTable.accountId, "local"), isNull(applicationsTable.accountId))
    : eq(applicationsTable.accountId, accountId);
  const cvAccountFilter = accountId === "local"
    ? or(eq(cvsTable.accountId, "local"), isNull(cvsTable.accountId))
    : eq(cvsTable.accountId, accountId);

  const [row] = await db
    .select({
      application: applicationsTable,
      job: jobsTable,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .where(and(eq(applicationsTable.id, id), appAccountFilter))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Application not found" });
    return;
  }

  const { application, job } = row;
  const docIds: string[] = application.attachedDocumentIds
    ? JSON.parse(application.attachedDocumentIds)
    : [];

  let attachedDocs: any[] = [];
  if (docIds.length > 0) {
    attachedDocs = await db.select().from(cvsTable).where(and(inArray(cvsTable.id, docIds), cvAccountFilter));
  }

  res.json({
    id: application.id,
    jobId: application.jobId,
    jobTitle: job.title,
    company: job.company,
    location: job.location,
    remote: job.remote,
    salary: job.salary,
    source: job.source,
    sourceUrl: job.sourceUrl,
    jobDescription: job.description,
    appliedAt: application.appliedAt.toISOString(),
    method: application.method,
    matchScore: application.matchScore,
    status: application.status,
    recipientEmail: application.recipientEmail,
    subjectLine: application.subjectLine,
    coverLetter: application.coverLetter,
    attachedDocuments: attachedDocs.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      category: (d as any).category || "cv",
      fileType: d.fileType,
      sizeBytes: d.sizeBytes,
    })),
    lastActivityAt: application.lastActivityAt.toISOString(),
  });
});

/**
 * Prepare an Application Draft with AI Cover Letter & Auto-Matched Attachments
 */
router.post("/applications/prepare", async (req, res): Promise<void> => {
  const { jobId, method = "email" } = req.body;
  if (!jobId) {
    res.status(400).json({ error: "jobId is required" });
    return;
  }

  const accountId = getAccountId(req, res);
  const jobAccountFilter = accountId === "local"
    ? or(eq(jobsTable.accountId, "local"), isNull(jobsTable.accountId))
    : eq(jobsTable.accountId, accountId);
  const appAccountFilter = accountId === "local"
    ? or(eq(applicationsTable.accountId, "local"), isNull(applicationsTable.accountId))
    : eq(applicationsTable.accountId, accountId);
  const cvAccountFilter = accountId === "local"
    ? or(eq(cvsTable.accountId, "local"), isNull(cvsTable.accountId))
    : eq(cvsTable.accountId, accountId);

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, jobId), jobAccountFilter)).limit(1);
  if (!job) {
    res.status(404).json({ error: "Job record not found" });
    return;
  }

  const profile = await getProfileForAccount(accountId);
  const extractedDetails = extractApplicationDetails(job.description, job.sourceUrl, job.title, job.company);
  const pkg = await generateTailoredCoverLetter(profile, job, extractedDetails, storageDir);

  // Auto-pick matching documents from user's vault (CV, Academic Certificates, National ID)
  const allDocs = await db.select().from(cvsTable).where(cvAccountFilter).orderBy(desc(cvsTable.isMaster), desc(cvsTable.uploadedAt));
  const selectedDocIds: string[] = [];

  for (const doc of allDocs) {
    const cat = (doc as any).category || "cv";
    if (
      doc.isMaster ||
      cat === "cv" ||
      cat === "academic_diploma" ||
      cat === "national_id" ||
      cat === "professional_certification" ||
      pkg.suggestedDocumentCategories.includes(cat)
    ) {
      if (!selectedDocIds.includes(doc.id)) selectedDocIds.push(doc.id);
    }
  }

  if (selectedDocIds.length === 0 && allDocs.length > 0) {
    selectedDocIds.push(...allDocs.map((d) => d.id));
  }

  // Check if application already exists for this account
  const [existing] = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.jobId, jobId), appAccountFilter))
    .limit(1);

  const now = new Date();
  if (existing) {
    await db
      .update(applicationsTable)
      .set({
        status: "NEEDS_REVIEW",
        recipientEmail: pkg.recipientEmail || existing.recipientEmail,
        subjectLine: pkg.subject,
        coverLetter: pkg.coverLetter,
        attachedDocumentIds: JSON.stringify(selectedDocIds),
        matchScore: job.matchScore,
        lastActivityAt: now,
      })
      .where(and(eq(applicationsTable.id, existing.id), appAccountFilter));

    res.json({
      id: existing.id,
      jobId,
      status: "NEEDS_REVIEW",
      recipientEmail: pkg.recipientEmail || existing.recipientEmail,
      subjectLine: pkg.subject,
      coverLetter: pkg.coverLetter,
      attachedDocumentIds: selectedDocIds,
      message: "Application draft updated and ready for your approval.",
    });
    return;
  }

  const newId = randomUUID();
  await db.insert(applicationsTable).values({
    id: newId,
    accountId,
    jobId,
    method: method as any,
    status: "NEEDS_REVIEW",
    recipientEmail: pkg.recipientEmail,
    subjectLine: pkg.subject,
    coverLetter: pkg.coverLetter,
    attachedDocumentIds: JSON.stringify(selectedDocIds),
    matchScore: job.matchScore,
    appliedAt: now,
    lastActivityAt: now,
  });

  await db.insert(activityTable).values({
    id: randomUUID(),
    accountId,
    kind: "application",
    message: `Drafted tailored application package for ${job.title} at ${job.company}. Ready for your review.`,
    createdAt: now,
  });

  res.json({
    id: newId,
    jobId,
    status: "NEEDS_REVIEW",
    recipientEmail: pkg.recipientEmail,
    subjectLine: pkg.subject,
    coverLetter: pkg.coverLetter,
    attachedDocumentIds: selectedDocIds,
    message: "Application drafted with tailored cover letter and attachments.",
  });
});

/**
 * Regenerate Application Package (Subject, Cover Letter, Attachments)
 */
router.post("/applications/:id/regenerate", async (req, res): Promise<void> => {
  const { id } = req.params;
  const accountId = getAccountId(req, res);
  const appAccountFilter = accountId === "local"
    ? or(eq(applicationsTable.accountId, "local"), isNull(applicationsTable.accountId))
    : eq(applicationsTable.accountId, accountId);
  const jobAccountFilter = accountId === "local"
    ? or(eq(jobsTable.accountId, "local"), isNull(jobsTable.accountId))
    : eq(jobsTable.accountId, accountId);
  const cvAccountFilter = accountId === "local"
    ? or(eq(cvsTable.accountId, "local"), isNull(cvsTable.accountId))
    : eq(cvsTable.accountId, accountId);

  const [app] = await db.select().from(applicationsTable).where(and(eq(applicationsTable.id, id), appAccountFilter)).limit(1);
  if (!app) {
    res.status(404).json({ error: "Application record not found" });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, app.jobId), jobAccountFilter)).limit(1);
  if (!job) {
    res.status(404).json({ error: "Associated job record not found" });
    return;
  }

  const profile = await getProfileForAccount(accountId);
  const extractedDetails = extractApplicationDetails(job.description, job.sourceUrl, job.title, job.company);
  const pkg = await generateTailoredCoverLetter(profile, job, extractedDetails, storageDir);

  const allDocs = await db.select().from(cvsTable).where(cvAccountFilter).orderBy(desc(cvsTable.isMaster), desc(cvsTable.uploadedAt));
  const selectedDocIds: string[] = [];

  for (const doc of allDocs) {
    const cat = (doc as any).category || "cv";
    if (
      doc.isMaster ||
      cat === "cv" ||
      cat === "academic_diploma" ||
      cat === "national_id" ||
      cat === "professional_certification" ||
      pkg.suggestedDocumentCategories.includes(cat)
    ) {
      if (!selectedDocIds.includes(doc.id)) selectedDocIds.push(doc.id);
    }
  }

  if (selectedDocIds.length === 0 && allDocs.length > 0) {
    selectedDocIds.push(...allDocs.map((d) => d.id));
  }

  const now = new Date();
  await db
    .update(applicationsTable)
    .set({
      recipientEmail: pkg.recipientEmail || app.recipientEmail,
      subjectLine: pkg.subject,
      coverLetter: pkg.coverLetter,
      attachedDocumentIds: JSON.stringify(selectedDocIds),
      lastActivityAt: now,
    })
    .where(and(eq(applicationsTable.id, id), appAccountFilter));

  res.json({
    id,
    jobId: app.jobId,
    status: app.status,
    recipientEmail: pkg.recipientEmail || app.recipientEmail,
    subjectLine: pkg.subject,
    coverLetter: pkg.coverLetter,
    attachedDocumentIds: selectedDocIds,
    message: "Application package regenerated successfully!",
  });
});

/**
 * Bulk Prepare Applications for multiple jobs (e.g. all 70%+ matches)
 */
router.post("/applications/bulk-prepare", async (req, res): Promise<void> => {
  const { jobIds } = req.body;
  const targetIds: string[] = Array.isArray(jobIds) ? jobIds : [];

  if (targetIds.length === 0) {
    res.status(400).json({ error: "Provide an array of jobIds to prepare." });
    return;
  }

  const accountId = getAccountId(req, res);
  const appAccountFilter = accountId === "local"
    ? or(eq(applicationsTable.accountId, "local"), isNull(applicationsTable.accountId))
    : eq(applicationsTable.accountId, accountId);
  const jobAccountFilter = accountId === "local"
    ? or(eq(jobsTable.accountId, "local"), isNull(jobsTable.accountId))
    : eq(jobsTable.accountId, accountId);
  const cvAccountFilter = accountId === "local"
    ? or(eq(cvsTable.accountId, "local"), isNull(cvsTable.accountId))
    : eq(cvsTable.accountId, accountId);

  const profile = await getProfileForAccount(accountId);
  const allDocs = await db.select().from(cvsTable).where(cvAccountFilter).orderBy(desc(cvsTable.isMaster), desc(cvsTable.uploadedAt));
  let preparedCount = 0;

  for (const jobId of targetIds) {
    const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, jobId), jobAccountFilter)).limit(1);
    if (!job) continue;

    const extractedDetails = extractApplicationDetails(job.description, job.sourceUrl, job.title, job.company);
    const pkg = await generateTailoredCoverLetter(profile, job, extractedDetails, storageDir);

    const selectedDocIds: string[] = [];
    for (const doc of allDocs) {
      const cat = (doc as any).category || "cv";
      if (
        doc.isMaster ||
        cat === "cv" ||
        cat === "academic_diploma" ||
        cat === "national_id" ||
        cat === "professional_certification" ||
        pkg.suggestedDocumentCategories.includes(cat)
      ) {
        if (!selectedDocIds.includes(doc.id)) selectedDocIds.push(doc.id);
      }
    }
    if (selectedDocIds.length === 0 && allDocs.length > 0) {
      selectedDocIds.push(...allDocs.map((d) => d.id));
    }

    const [existing] = await db
      .select()
      .from(applicationsTable)
      .where(and(eq(applicationsTable.jobId, jobId), appAccountFilter))
      .limit(1);

    const now = new Date();
    if (existing) {
      await db
        .update(applicationsTable)
        .set({
          status: "NEEDS_REVIEW",
          recipientEmail: pkg.recipientEmail || existing.recipientEmail,
          subjectLine: pkg.subject,
          coverLetter: pkg.coverLetter,
          attachedDocumentIds: JSON.stringify(selectedDocIds),
          matchScore: job.matchScore,
          lastActivityAt: now,
        })
        .where(and(eq(applicationsTable.id, existing.id), appAccountFilter));
    } else {
      await db.insert(applicationsTable).values({
        id: randomUUID(),
        accountId,
        jobId,
        method: "email",
        status: "NEEDS_REVIEW",
        recipientEmail: pkg.recipientEmail,
        subjectLine: pkg.subject,
        coverLetter: pkg.coverLetter,
        attachedDocumentIds: JSON.stringify(selectedDocIds),
        matchScore: job.matchScore,
        appliedAt: now,
        lastActivityAt: now,
      });
    }
    preparedCount++;
  }

  res.json({
    preparedCount,
    message: `Prepared ${preparedCount} tailored application packages. Review and approve them before sending.`,
  });
});

/**
 * Update an Application Draft (Edit email, subject, cover letter, attachments)
 */
router.put("/applications/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { recipientEmail, subjectLine, coverLetter, attachedDocumentIds, status } = req.body;
  const accountId = getAccountId(req, res);
  const appAccountFilter = accountId === "local"
    ? or(eq(applicationsTable.accountId, "local"), isNull(applicationsTable.accountId))
    : eq(applicationsTable.accountId, accountId);
  const jobAccountFilter = accountId === "local"
    ? or(eq(jobsTable.accountId, "local"), isNull(jobsTable.accountId))
    : eq(jobsTable.accountId, accountId);

  const [existing] = await db.select().from(applicationsTable).where(and(eq(applicationsTable.id, id), appAccountFilter)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Application record not found" });
    return;
  }

  const updates: any = {
    lastActivityAt: new Date(),
  };

  if (recipientEmail !== undefined) updates.recipientEmail = recipientEmail;
  if (subjectLine !== undefined) updates.subjectLine = subjectLine;
  if (coverLetter !== undefined) updates.coverLetter = coverLetter;
  if (attachedDocumentIds !== undefined) {
    updates.attachedDocumentIds = Array.isArray(attachedDocumentIds)
      ? JSON.stringify(attachedDocumentIds)
      : attachedDocumentIds;
  }
  if (status !== undefined) {
    updates.status = status;
    if (["SUBMITTED", "EMAIL_SENT", "APPLIED", "INTERVIEW", "OFFER"].includes(status) && existing.jobId) {
      await db.update(jobsTable).set({ status: "APPLIED" as any }).where(and(eq(jobsTable.id, existing.jobId), jobAccountFilter));
    }
  }

  await db.update(applicationsTable).set(updates).where(and(eq(applicationsTable.id, id), appAccountFilter));

  res.json({ success: true, message: "Application updated." });
});

/**
 * Approve & Send a single application via connected Gmail / Email Dispatcher
 */
router.post("/applications/:id/send", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { recipientEmail, subjectLine, coverLetter, attachedDocumentIds } = req.body || {};
  const accountId = getAccountId(req, res);
  const appAccountFilter = accountId === "local"
    ? or(eq(applicationsTable.accountId, "local"), isNull(applicationsTable.accountId))
    : eq(applicationsTable.accountId, accountId);

  const [row] = await db
    .select({
      application: applicationsTable,
      job: jobsTable,
    })
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .where(and(eq(applicationsTable.id, id), appAccountFilter))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Application not found" });
    return;
  }

  const { application } = row;

  // Persist live edits from drawer before dispatching
  const updates: any = {};
  if (typeof recipientEmail === "string" && recipientEmail.trim()) {
    updates.recipientEmail = recipientEmail.trim();
    application.recipientEmail = recipientEmail.trim();
  }
  if (typeof subjectLine === "string" && subjectLine.trim()) {
    updates.subjectLine = subjectLine.trim();
    application.subjectLine = subjectLine.trim();
  }
  if (typeof coverLetter === "string" && coverLetter.trim()) {
    updates.coverLetter = coverLetter.trim();
    application.coverLetter = coverLetter.trim();
  }
  if (attachedDocumentIds !== undefined) {
    const ids = Array.isArray(attachedDocumentIds)
      ? attachedDocumentIds
      : typeof attachedDocumentIds === "string"
        ? JSON.parse(attachedDocumentIds)
        : [];
    updates.attachedDocumentIds = JSON.stringify(ids);
    application.attachedDocumentIds = JSON.stringify(ids);
  }

  if (Object.keys(updates).length > 0) {
    updates.lastActivityAt = new Date();
    await db.update(applicationsTable).set(updates).where(and(eq(applicationsTable.id, id), appAccountFilter));
  }

  const profile = await getProfileForAccount(accountId);

  const result = await sendApplicationEmail(application, profile, storageDir);

  if (!result.success) {
    res.status(400).json({ error: result.error || "Failed to dispatch email." });
    return;
  }

  res.json({
    success: true,
    messageId: result.messageId,
    message: `Application approved and successfully sent to ${application.recipientEmail}!`,
  });
});

/**
 * Bulk Approve & Send multiple ready applications
 */
router.post("/applications/bulk-send", async (req, res): Promise<void> => {
  const { applicationIds } = req.body;
  const targetIds: string[] = Array.isArray(applicationIds) ? applicationIds : [];

  if (targetIds.length === 0) {
    res.status(400).json({ error: "Provide applicationIds to dispatch." });
    return;
  }

  const accountId = getAccountId(req, res);
  const appAccountFilter = accountId === "local"
    ? or(eq(applicationsTable.accountId, "local"), isNull(applicationsTable.accountId))
    : eq(applicationsTable.accountId, accountId);

  const profile = await getProfileForAccount(accountId);

  const results: { id: string; success: boolean; error?: string }[] = [];

  for (const appId of targetIds) {
    const [app] = await db.select().from(applicationsTable).where(and(eq(applicationsTable.id, appId), appAccountFilter)).limit(1);
    if (!app || !app.recipientEmail) {
      results.push({ id: appId, success: false, error: "No recipient email" });
      continue;
    }

    const sendRes = await sendApplicationEmail(app, profile, storageDir);
    results.push({ id: appId, success: sendRes.success, error: sendRes.error });
  }

  const sentCount = results.filter((r) => r.success).length;
  res.json({
    sentCount,
    total: targetIds.length,
    results,
    message: `Successfully sent ${sentCount} of ${targetIds.length} applications.`,
  });
});

router.post("/applications/bulk", async (req, res): Promise<void> => {
  const { action, applicationIds, status } = req.body || {};
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    res.status(400).json({ error: "applicationIds array is required" });
    return;
  }

  const validIds = applicationIds.filter((id) => typeof id === "string" && id.trim().length > 0);
  if (validIds.length === 0) {
    res.status(400).json({ error: "No valid application IDs provided" });
    return;
  }

  const accountId = getAccountId(req, res);
  const appAccountFilter = accountId === "local"
    ? or(eq(applicationsTable.accountId, "local"), isNull(applicationsTable.accountId))
    : eq(applicationsTable.accountId, accountId);

  try {
    if (action === "status") {
      const allowedStatuses = [
        "REVIEW_READY",
        "DRAFT",
        "SUBMITTED",
        "EMAIL_SENT",
        "AWAITING_RESPONSE",
        "RECRUITER_RESPONSE",
        "INTERVIEW",
        "ASSESSMENT",
        "OFFER",
        "REJECTED",
        "ARCHIVED",
      ];
      if (!status || !allowedStatuses.includes(status)) {
        res.status(400).json({ error: `Invalid status. Must be one of: ${allowedStatuses.join(", ")}` });
        return;
      }
      await db.update(applicationsTable)
        .set({ status: status as any, lastActivityAt: new Date() })
        .where(and(inArray(applicationsTable.id, validIds), appAccountFilter));

      res.json({ success: true, count: validIds.length, action: "status", status });
    } else if (action === "delete") {
      await db.delete(applicationsTable).where(and(inArray(applicationsTable.id, validIds), appAccountFilter));
      res.json({ success: true, count: validIds.length, action: "delete" });
    } else {
      res.status(400).json({ error: "Invalid action. Supported actions: status, delete" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Bulk operation failed" });
  }
});

/**
 * Delete an application record
 */
router.delete("/applications/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const accountId = getAccountId(req, res);
  const appAccountFilter = accountId === "local"
    ? or(eq(applicationsTable.accountId, "local"), isNull(applicationsTable.accountId))
    : eq(applicationsTable.accountId, accountId);

  await db.delete(applicationsTable).where(and(eq(applicationsTable.id, id), appAccountFilter));
  res.json({ success: true, message: "Application removed." });
});

export default router;
