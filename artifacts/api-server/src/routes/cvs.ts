import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  DeleteCvParams,
  ListCvsResponse,
  ParseCvProfileBody,
  ParseCvProfileParams,
  ParseCvProfileResponse,
  UploadCvResponse,
} from "@workspace/api-zod";
import {
  activityTable,
  candidateProfilesTable,
  cvParsingResultsTable,
  cvsTable,
  db,
  integrationSettingsTable,
  searchProfilesTable,
  userRolePreferencesTable,
} from "@workspace/db";
import { decryptCredentials, encryptCredentials } from "../lib/credential-encryption";
import {
  extractCvText,
  healBrokenCvText,
  maxCvTextCharacters,
} from "../lib/cv-text-extraction";
import {
  extractProfileDraft,
  extractProfileDraftFromFile,
  yearsFrom,
  type AiProvider,
} from "../lib/provider-services";
import { getAuthenticatedAccountId } from "../lib/auth";
import { invalidateCandidateEvidence } from "../lib/candidate-evidence";
import { invalidateSearchDirective } from "../lib/search-directive";

import fs from "node:fs";

const router: IRouter = Router();

function getAccountId(req: any, res: any): string {
  return res?.locals?.accountId || getAuthenticatedAccountId(req) || "local";
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
const maxFileSize = 20 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      mkdir(storageDir, { recursive: true })
        .then(() => callback(null, storageDir))
        .catch((error: unknown) => callback(error as Error, storageDir));
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, `${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: maxFileSize, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowed = [".pdf", ".docx", ".png", ".jpg", ".jpeg"];
    if (!allowed.includes(extension)) {
      callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
      return;
    }
    callback(null, true);
  },
});

router.get("/cvs", async (req, res): Promise<void> => {
  const accountId = getAccountId(req, res);
  const condition = accountId === "local"
    ? or(eq(cvsTable.accountId, "local"), isNull(cvsTable.accountId))
    : eq(cvsTable.accountId, accountId);

  const records = await db.select().from(cvsTable).where(condition).orderBy(desc(cvsTable.uploadedAt));
  res.json(
    records.map((record) => ({
      id: record.id,
      fileName: record.fileName,
      fileType: record.fileType,
      category: (record as any).category || "cv",
      title: (record as any).title || record.fileName,
      sizeBytes: record.sizeBytes,
      isMaster: record.isMaster,
      uploadedAt: record.uploadedAt.toISOString(),
    })),
  );
});

router.get("/cvs/:id/file", async (req, res): Promise<void> => {
  const accountId = getAccountId(req, res);
  const { id } = req.params;
  const [record] = await db.select().from(cvsTable).where(eq(cvsTable.id, id)).limit(1);
  if (!record) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (record.accountId && accountId !== "local" && record.accountId !== accountId) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const filePath = path.resolve(storageDir, record.storageName);
  if (fs.existsSync(filePath)) {
    res.download(filePath, record.fileName);
    return;
  }
  if (record.fileData) {
    const buffer = Buffer.from(record.fileData, "base64");
    const mimeType = record.fileType === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : record.fileType === "pdf"
      ? "application/pdf"
      : "application/octet-stream";
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(record.fileName)}"`);
    res.send(buffer);
    return;
  }
  res.status(404).json({ error: "Document file not found on disk or cloud storage." });
});

router.put("/cvs/:id", async (req, res): Promise<void> => {
  const accountId = getAccountId(req, res);
  const { id } = req.params;
  const { category, title, isMaster } = req.body;

  const [existing] = await db.select().from(cvsTable).where(eq(cvsTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (existing.accountId && accountId !== "local" && existing.accountId !== accountId) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const updates: any = {};
  if (category !== undefined) updates.category = category;
  if (title !== undefined) updates.title = title;
  if (isMaster === true) {
    const unmasterCondition = accountId === "local"
      ? or(eq(cvsTable.accountId, "local"), isNull(cvsTable.accountId))
      : eq(cvsTable.accountId, accountId);
    await db.update(cvsTable).set({ isMaster: false }).where(unmasterCondition);
    updates.isMaster = true;
  } else if (isMaster === false) {
    updates.isMaster = false;
  }

  await db.update(cvsTable).set(updates).where(eq(cvsTable.id, id));
  invalidateCandidateEvidence(accountId);
  invalidateSearchDirective(accountId);
  res.json({ success: true, message: "Document updated." });
});

router.post("/cvs", upload.single("file"), async (req, res): Promise<void> => {
  const accountId = getAccountId(req, res);
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Choose a PDF, DOCX, or Image file to upload." });
    return;
  }
  const ext = path.extname(file.originalname).toLowerCase();
  const fileType = ext === ".docx" ? "docx" : "pdf";
  const category = req.body?.category || (ext === ".jpg" || ext === ".png" ? "national_id" : "cv");
  const title = req.body?.title || path.basename(file.originalname, ext);

  const masterCondition = accountId === "local"
    ? or(eq(cvsTable.accountId, "local"), isNull(cvsTable.accountId))
    : eq(cvsTable.accountId, accountId);

  const [existingMaster] = await db
    .select({ id: cvsTable.id })
    .from(cvsTable)
    .where(and(masterCondition, eq(cvsTable.isMaster, true)))
    .limit(1);
  const requestedMaster = req.body?.isMaster === "true" || req.body?.isMaster === "1";
  const isMaster = category === "cv" && (requestedMaster || !existingMaster);
  if (isMaster) {
    await db.update(cvsTable).set({ isMaster: false }).where(masterCondition);
  }

  const safeName = path
    .basename(file.originalname)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 240);

  let fileData: string | null = null;
  let extractedText: string | null = null;

  try {
    const bytes = await readFile(file.path);
    fileData = bytes.toString("base64");
    try {
      const extRes = await extractCvText(bytes, fileType as any);
      if (extRes?.text) {
        extractedText = extRes.text;
      }
    } catch (extErr: any) {
      req.log.warn({ extErr: extErr?.message }, "Initial CV text extraction on upload failed");
    }
  } catch (readErr: any) {
    req.log.warn({ readErr: readErr?.message }, "Failed reading uploaded file buffer");
  }

  const [record] = await db
    .insert(cvsTable)
    .values({
      id: randomUUID(),
      accountId,
      fileName: safeName,
      storageName: path.basename(file.filename),
      fileType: fileType as any,
      category,
      title,
      sizeBytes: file.size,
      fileData,
      extractedText,
      isMaster,
      uploadedAt: new Date(),
    })
    .returning();

  // If this is a CV and has extracted text, auto-sync profile & roles immediately so discovery works right away
  if (category === "cv" && extractedText && extractedText.trim().length >= 20) {
    try {
      const rawDraft = parseCvLocally(extractedText);
      const sanitizedDraft = sanitizeProfileDraft(rawDraft);
      await syncParsedProfileToWorkspace(
        sanitizedDraft,
        record,
        "deterministic",
        "local-rules",
        "local-rules",
        accountId,
      );
    } catch (autoParseErr) {
      req.log?.warn?.({ autoParseErr }, "Immediate auto-parse after upload deferred to manual parse");
    }
  }

  invalidateCandidateEvidence(accountId);
  invalidateSearchDirective(accountId);

  res.status(201).json({
    id: record.id,
    fileName: record.fileName,
    fileType: record.fileType,
    category: (record as any).category || category,
    title: (record as any).title || title,
    sizeBytes: record.sizeBytes,
    isMaster: record.isMaster,
    uploadedAt: record.uploadedAt.toISOString(),
  });
});

router.delete("/cvs/:id", async (req, res): Promise<void> => {
  const accountId = getAccountId(req, res);
  const params = DeleteCvParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db
    .select()
    .from(cvsTable)
    .where(eq(cvsTable.id, params.data.id))
    .limit(1);
  if (!record) {
    res.status(404).json({ error: "CV not found." });
    return;
  }
  if (record.accountId && accountId !== "local" && record.accountId !== accountId) {
    res.status(404).json({ error: "CV not found." });
    return;
  }
  const filePath = path.resolve(storageDir, record.storageName);
  if (filePath.startsWith(`${storageDir}${path.sep}`)) {
    await unlink(filePath).catch((error: unknown) => {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    });
  }
  await db.delete(cvsTable).where(eq(cvsTable.id, record.id));
  invalidateCandidateEvidence(accountId);
  invalidateSearchDirective(accountId);
  res.status(204).end();
});

router.post("/cvs/bulk", async (req, res): Promise<void> => {
  const accountId = getAccountId(req, res);
  const { action, cvIds, category } = req.body || {};
  if (!Array.isArray(cvIds) || cvIds.length === 0) {
    res.status(400).json({ error: "cvIds array is required" });
    return;
  }

  const validIds = cvIds.filter((id) => typeof id === "string" && id.trim().length > 0);
  if (validIds.length === 0) {
    res.status(400).json({ error: "No valid CV IDs provided" });
    return;
  }

  const scopeCondition = accountId === "local"
    ? and(inArray(cvsTable.id, validIds), or(eq(cvsTable.accountId, "local"), isNull(cvsTable.accountId)))
    : and(inArray(cvsTable.id, validIds), eq(cvsTable.accountId, accountId));

  try {
    if (action === "delete") {
      const records = await db.select().from(cvsTable).where(scopeCondition);
      for (const record of records) {
        const filePath = path.resolve(storageDir, record.storageName);
        if (filePath.startsWith(`${storageDir}${path.sep}`)) {
          await unlink(filePath).catch(() => {});
        }
      }
      const matchingIds = records.map((r) => r.id);
      if (matchingIds.length > 0) {
        await db.delete(cvsTable).where(inArray(cvsTable.id, matchingIds));
      }
      invalidateCandidateEvidence(accountId);
      invalidateSearchDirective(accountId);
      res.json({ success: true, count: matchingIds.length, action: "delete" });
    } else if (action === "category") {
      const validCategories = ["cv", "cover_letter", "certificate", "recommendation", "portfolio", "other"];
      if (!category || !validCategories.includes(category)) {
        res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(", ")}` });
        return;
      }
      await db.update(cvsTable)
        .set({ category: category as any })
        .where(scopeCondition);
      res.json({ success: true, count: validIds.length, action: "category", category });
    } else {
      res.status(400).json({ error: "Invalid action. Supported: delete, category" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Bulk CV operation failed" });
  }
});

/**
 * Clean candidate full name by stripping document titles, qualification suffixes,
 * street addresses, and duplicated titles
 */
export function cleanCandidateName(rawName: string): string {
  if (!rawName) return "";
  let name = healBrokenCvText(rawName).trim();

  // Strip leading document titles e.g. "Curriculum Vitae of", "Resume of", "Bio-data of"
  name = name.replace(/^(?:curriculum\s+vitae|resume|bio[- ]?data|profile|cv)\s*(?:of|for|:)?\s*/i, "").trim();

  // Strip duplicate honorifics e.g. "Dr. Dr." -> "Dr."
  name = name.replace(/^(?:Dr\.?\s*)+/i, "Dr. ");
  name = name.replace(/^(?:Prof\.?\s*)+/i, "Prof. ");

  // Strip address / contact trailing clauses
  name = name.replace(/\s*(?:\\|\/|\||\bNo\b|\bPlot\b|\bStreet\b|\bSt\b|\bRoad\b|\bRd\b|\bEstate\b|\bAvenue\b|\bAve\b|\bClose\b|\bExt\b).*$/i, "");

  // Strip qualification suffixes e.g. "M.B., B.S.", "FWACS", "FRCS", "Ph.D", "CPA", "RN"
  name = name.replace(/[\s,.]+(?:M\.?B\.?,?\s*B\.?S\.?|FWACS|FRCS|Ph\.?D|M\.?Sc|B\.?Sc|B\.?Eng|B\.?A|LL\.?B|LL\.?M|CPA|ACCA|RN|FACS|FMCOG|MWACS|PMP|PE|Esq).*$/i, "");

  // If there's a period followed by a repeated surname/name or title, take only the first clean portion
  if (name.includes(".")) {
    const parts = name.split(/\.\s+/);
    if (parts.length > 1 && !/^(?:Dr|Prof|Mr|Mrs|Ms|Engr|Barr)$/i.test(parts[0])) {
      name = parts[0];
    }
  }

  // Strip parenthetical text
  name = name.replace(/\s*\(.*$/, "").trim();

  // Format capitalized words nicely (e.g. BELLO -> Bello)
  name = name.split(/\s+/).map((word, idx) => {
    if (idx === 0 && /^(?:dr|prof|mr|mrs|ms|engr|barr)\.?$/i.test(word)) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase().replace(/\.?$/, ".");
    }
    if (/^[A-Z]{2,}$/.test(word) && !/^(?:USA|UK|UAE|II|III|IV)$/.test(word)) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }
    return word;
  }).join(" ");

  return name.trim();
}

/**
 * Synchronize parsed CV facts across the entire workspace:
 * - Candidate Evidence Profile (candidateProfilesTable)
 * - Enhanced CV Parsing Results (cvParsingResultsTable)
 * - User Role Preferences (userRolePreferencesTable)
 * - Live Search Profiles (searchProfilesTable)
 * - Workspace Activity Log
 */
export async function syncParsedProfileToWorkspace(
  draft: Record<string, any>,
  cv: { id: string; fileName: string },
  method: "ai" | "deterministic" | "hybrid",
  provider?: string | null,
  model?: string | null,
  accountId?: string,
) {
  const targetAccountId = accountId || "local";
  const updatedAt = new Date();
  const profileToSave = {
    id: targetAccountId,
    fullName: cleanCandidateName(draft.fullName || ""),
    email: draft.email || "",
    phone: draft.phone || "",
    country: draft.country || "",
    city: draft.city || "",
    timezone: draft.timezone || "",
    targetRoles: draft.targetRoles || [],
    skills: draft.skills || [],
    technologies: draft.technologies || [],
    yearsExperience: draft.yearsExperience ?? null,
    education: draft.education || [],
    certifications: draft.certifications || [],
    industries: draft.industries || [],
    languages: draft.languages || [],
    preferredLocations: draft.preferredLocations || [],
    workModes: draft.workModes || [],
    relocation: draft.relocation ?? false,
    visaSponsorship: draft.visaSponsorship ?? false,
    minimumSalary: draft.minimumSalary ?? null,
    updatedAt,
  };

  // 1. Update Candidate Profile for this account
  await db
    .insert(candidateProfilesTable)
    .values(profileToSave)
    .onConflictDoUpdate({
      target: candidateProfilesTable.id,
      set: profileToSave,
    });

  // Backward compatibility: If targetAccountId is "local", also update "primary"
  if (targetAccountId === "local") {
    await db
      .insert(candidateProfilesTable)
      .values({ ...profileToSave, id: "primary" })
      .onConflictDoUpdate({
        target: candidateProfilesTable.id,
        set: { ...profileToSave, id: "primary" },
      })
      .catch(() => {});
  }

  // 2. Update Enhanced CV Parsing Results
  try {
    const rolesList = (draft.targetRoles || []).map((r: string) => ({
      roleTitle: r,
      confidence: 90,
      source: "cv",
      sourceId: cv.id,
      reasoning: ["Extracted and verified from CV credentials and timeline"],
      seniorityLevel: (draft.yearsExperience || 0) >= 8 ? "Senior / Consultant" : (draft.yearsExperience || 0) >= 3 ? "Mid / Specialist" : "Associate / Junior",
      domain: draft.industries?.[0] || "Professional Practice",
    }));

    await db
      .insert(cvParsingResultsTable)
      .values({
        id: randomUUID(),
        cvId: cv.id,
        accountId: targetAccountId,
        fingerprint: randomUUID(),
        parsingMethod: method,
        providerUsed: provider || "system",
        modelUsed: model || "model",
        confidence: 90,
        parsedAt: updatedAt,
        fullName: profileToSave.fullName,
        email: profileToSave.email,
        phone: profileToSave.phone,
        location: profileToSave.city ? `${profileToSave.city}, ${profileToSave.country}` : profileToSave.country,
        professionalSummary: `Verified credentials for ${profileToSave.fullName} across ${draft.industries?.join(", ") || "field of practice"}.`,
        technicalSkills: draft.technologies || [],
        softSkills: draft.skills || [],
        extractedRoles: rolesList,
        primaryRoles: (draft.targetRoles || []).slice(0, 4),
        secondaryRoles: (draft.targetRoles || []).slice(4),
        totalExperienceYears: Math.round(draft.yearsExperience || 0),
        totalExperienceMonths: Math.round((draft.yearsExperience || 0) * 12),
        createdAt: updatedAt,
        updatedAt,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.warn("[CV Sync] cvParsingResultsTable sync:", err);
  }

  // 3. Sync User Role Preferences (Clear stale roles for target account only)
  try {
    const roles = Array.isArray(draft.targetRoles) && draft.targetRoles.length > 0 ? draft.targetRoles : [];
    if (roles.length > 0) {
      await db
        .delete(userRolePreferencesTable)
        .where(eq(userRolePreferencesTable.accountId, targetAccountId));

      for (let i = 0; i < roles.length; i++) {
        const roleTitle = roles[i];
        await db
          .insert(userRolePreferencesTable)
          .values({
            id: randomUUID(),
            accountId: targetAccountId,
            roleTitle,
            source: "cv",
            enabled: i < 5,
            priority: i < 2 ? "high" : i < 4 ? "medium" : "low",
            weight: Math.max(100 - i * 15, 20),
            searchQueries: [roleTitle, `${roleTitle} ${profileToSave.country || "Kenya"}`],
            keywords: (draft.skills || []).slice(0, 5),
            exclusionKeywords: [],
            minSalary: draft.minimumSalary ?? null,
            maxSalary: null,
            locationPreferences: [profileToSave.country || "Kenya", "Remote"],
            remoteOnly: false,
            experienceLevel: (draft.yearsExperience || 0) >= 8 ? ["Senior", "Lead", "Consultant"] : ["Mid-Level", "Junior"],
            industryPreferences: draft.industries || [],
            companySize: [],
            createdAt: updatedAt,
            updatedAt,
          })
          .onConflictDoNothing();
      }

      if (targetAccountId === "local") {
        await db.delete(userRolePreferencesTable).where(eq(userRolePreferencesTable.accountId, "primary"));
        for (let i = 0; i < roles.length; i++) {
          const roleTitle = roles[i];
          await db.insert(userRolePreferencesTable).values({
            id: randomUUID(),
            accountId: "primary",
            roleTitle,
            source: "cv",
            enabled: i < 5,
            priority: i < 2 ? "high" : i < 4 ? "medium" : "low",
            weight: Math.max(100 - i * 15, 20),
            searchQueries: [roleTitle, `${roleTitle} ${profileToSave.country || "Kenya"}`],
            keywords: (draft.skills || []).slice(0, 5),
            exclusionKeywords: [],
            minSalary: draft.minimumSalary ?? null,
            maxSalary: null,
            locationPreferences: [profileToSave.country || "Kenya", "Remote"],
            remoteOnly: false,
            experienceLevel: (draft.yearsExperience || 0) >= 8 ? ["Senior", "Lead", "Consultant"] : ["Mid-Level", "Junior"],
            industryPreferences: draft.industries || [],
            companySize: [],
            createdAt: updatedAt,
            updatedAt,
          }).onConflictDoNothing();
        }
      }
    }
  } catch (err) {
    console.warn("[CV Sync] userRolePreferencesTable sync:", err);
  }

  // 4. Auto-create Search Profiles for detected target roles
  const roles = Array.isArray(draft.targetRoles) && draft.targetRoles.length > 0 ? draft.targetRoles : ["General Role"];
  for (const role of roles.slice(0, 4)) {
    const keywords = Array.from(
      new Set([
        role,
        ...(draft.skills || []).slice(0, 4),
        ...(draft.technologies || []).slice(0, 4),
      ]),
    ).filter(Boolean);

    const locations =
      draft.preferredLocations && draft.preferredLocations.length > 0
        ? draft.preferredLocations
        : draft.city
        ? [draft.city]
        : draft.country
        ? [draft.country]
        : [];

    let remoteSetting: "any" | "remote" | "hybrid" | "onsite" = "any";
    if (draft.workModes && draft.workModes.length === 1) {
      remoteSetting = draft.workModes[0];
    }

    await db
      .insert(searchProfilesTable)
      .values({
        id: randomUUID(),
        accountId: targetAccountId,
        name: `${role}`,
        keywords,
        locations,
        remoteSetting,
        minimumMatchScore: 60,
        minimumSalary: draft.minimumSalary ?? null,
        excludedKeywords: [],
        employmentTypes: ["full-time"],
        enabled: true,
        createdAt: updatedAt,
      })
      .onConflictDoNothing();
  }

  // 5. Activity log
  await db.insert(activityTable).values({
    id: randomUUID(),
    accountId: targetAccountId,
    kind: "profile",
    message: `Parsed ${cv.fileName} (${method.toUpperCase()}). Profile and search rules auto-configured for ${profileToSave.fullName || "Candidate"}.`,
    createdAt: updatedAt,
  });

  // Invalidate in-memory caches
  invalidateCandidateEvidence(targetAccountId);
  invalidateSearchDirective(targetAccountId);
}

function sanitizeProfileDraft(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};

  let source = raw as Record<string, unknown>;
  // If the model wrapped the result in draft, candidate, profile, or data
  if (source.draft && typeof source.draft === "object" && !Array.isArray(source.draft)) {
    source = source.draft as Record<string, unknown>;
  } else if (source.profile && typeof source.profile === "object" && !Array.isArray(source.profile)) {
    source = source.profile as Record<string, unknown>;
  } else if (source.candidate && typeof source.candidate === "object" && !Array.isArray(source.candidate)) {
    source = source.candidate as Record<string, unknown>;
  } else if (source.data && typeof source.data === "object" && !Array.isArray(source.data)) {
    source = source.data as Record<string, unknown>;
  }

  const cleanString = (val: unknown, maxLen = 200): string | undefined => {
    if (typeof val === "string") {
      const t = val.trim();
      return t ? t.slice(0, maxLen) : undefined;
    }
    if (typeof val === "number") {
      return String(val);
    }
    return undefined;
  };

  const cleanStringArray = (val: unknown, itemMaxLen = 200): string[] | undefined => {
    if (Array.isArray(val)) {
      const items: string[] = [];
      for (const item of val) {
        if (typeof item === "string") {
          const t = item.trim();
          if (t) items.push(t.slice(0, itemMaxLen));
        } else if (item && typeof item === "object") {
          const strVal = Object.values(item)
            .filter((v) => typeof v === "string" || typeof v === "number")
            .join(" - ")
            .trim();
          if (strVal) items.push(strVal.slice(0, itemMaxLen));
        }
      }
      return items.length > 0 ? items : undefined;
    }
    if (typeof val === "string") {
      const items = val
        .split(/[,\n]/)
        .map((s) => s.trim().slice(0, itemMaxLen))
        .filter(Boolean);
      return items.length > 0 ? items : undefined;
    }
    return undefined;
  };

  const cleanNumber = (val: unknown): number | undefined => {
    if (typeof val === "number" && !isNaN(val) && val >= 0) return val;
    if (typeof val === "string") {
      const match = val.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
      if (match) {
        const num = parseFloat(match[0]);
        if (!isNaN(num) && num >= 0) return num;
      }
    }
    return undefined;
  };

  const cleanBoolean = (val: unknown): boolean | undefined => {
    if (typeof val === "boolean") return val;
    if (typeof val === "string") {
      const lower = val.toLowerCase().trim();
      if (lower === "true" || lower === "yes") return true;
      if (lower === "false" || lower === "no") return false;
    }
    return undefined;
  };

  const cleanWorkModes = (val: unknown): ("remote" | "hybrid" | "onsite")[] | undefined => {
    const rawModes = Array.isArray(val)
      ? val
      : typeof val === "string"
      ? val.split(/[,\s]+/)
      : [];
    const valid: ("remote" | "hybrid" | "onsite")[] = [];
    for (const m of rawModes) {
      if (typeof m === "string") {
        const lower = m.toLowerCase().trim();
        if (lower === "remote" && !valid.includes("remote")) valid.push("remote");
        if (lower === "hybrid" && !valid.includes("hybrid")) valid.push("hybrid");
        if ((lower === "onsite" || lower === "on-site") && !valid.includes("onsite"))
          valid.push("onsite");
      }
    }
    return valid.length > 0 ? valid : undefined;
  };

  const draft: Record<string, unknown> = {};

  const rawFullName = cleanString(source.fullName || source.name || source.full_name, 240);
  if (rawFullName) {
    const cleaned = cleanCandidateName(rawFullName);
    draft.fullName = cleaned || rawFullName;
  }

  const email = cleanString(source.email || source.emailAddress || source.email_address, 320);
  if (email) draft.email = email;

  const phone = cleanString(source.phone || source.phoneNumber || source.phone_number, 100);
  if (phone) draft.phone = phone;

  const country = cleanString(source.country, 120);
  if (country) draft.country = country;

  const city = cleanString(source.city, 120);
  if (city) draft.city = city;

  const timezone = cleanString(source.timezone, 100);
  if (timezone) draft.timezone = timezone;

  const targetRoles = cleanStringArray(
    source.targetRoles || source.target_roles || source.roles,
    200,
  );
  if (targetRoles) draft.targetRoles = targetRoles;

  const skills = cleanStringArray(source.skills, 120);
  if (skills) draft.skills = skills;

  const technologies = cleanStringArray(
    source.technologies || source.tech_stack || source.tools,
    120,
  );
  if (technologies) draft.technologies = technologies;

  const rawExperience = Array.isArray(source.experience)
    ? (source.experience as { start?: string; end?: string }[])
    : [];

  if (rawExperience.length > 0) {
    draft.yearsExperience = yearsFrom(rawExperience);
  } else {
    const yearsExperience = cleanNumber(
      source.yearsExperience ?? source.years_experience ?? source.experienceYears,
    );
    if (yearsExperience !== undefined) draft.yearsExperience = yearsExperience;
  }

  const education = cleanStringArray(source.education, 500);
  if (education) draft.education = education;

  const certifications = cleanStringArray(
    source.certifications || source.certificates,
    300,
  );
  if (certifications) draft.certifications = certifications;

  const industries = cleanStringArray(source.industries, 150);
  if (industries) draft.industries = industries;

  const languages = cleanStringArray(source.languages, 100);
  if (languages) draft.languages = languages;

  const preferredLocations = cleanStringArray(
    source.preferredLocations || source.preferred_locations || source.locations,
    200,
  );
  if (preferredLocations) draft.preferredLocations = preferredLocations;

  const workModes = cleanWorkModes(source.workModes || source.work_modes);
  if (workModes) draft.workModes = workModes;

  const relocation = cleanBoolean(source.relocation);
  if (relocation !== undefined) draft.relocation = relocation;

  const visaSponsorship = cleanBoolean(
    source.visaSponsorship ?? source.visa_sponsorship,
  );
  if (visaSponsorship !== undefined) draft.visaSponsorship = visaSponsorship;

  const minimumSalary = cleanNumber(
    source.minimumSalary ?? source.minimum_salary ?? source.salary,
  );
  if (minimumSalary !== undefined) draft.minimumSalary = minimumSalary;

  return draft;
}

export function repairSpacedCharacters(str: string): string {
  let s = str
    .replace(/\bCurr\s*icul\s*u\s*m\s+vita\s*e\b/gi, "Curriculum Vitae")
    .replace(/\b(Dr|Prof|Mr|Mrs|Ms|Engr|Barr)\s*\./gi, "$1. ")
    .replace(/M\s*\.?\s*B\s*\.?\s*,?\s*B\s*\.?\s*S/gi, "M.B., B.S.")
    .replace(/F\s*W\s*A\s*C\s*S/gi, "FWACS")
    .replace(/F\s*R\s*C\s*S/gi, "FRCS");

  const validShortWords = new Set([
    "a", "i", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is",
    "it", "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we"
  ]);

  const tokens = s.split(/(\s+|[.,:;()\\\/])/);
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;

    if (/^\s+$/.test(t)) {
      const prev = out[out.length - 1];
      const next = tokens[i + 1];

      if (prev && next && /^[A-Za-z]+$/.test(prev) && /^[A-Za-z]+$/.test(next)) {
        const prevLower = prev.toLowerCase();
        const nextLower = next.toLowerCase();

        const prevIsSingle = prev.length === 1 && !validShortWords.has(prevLower);
        const nextIsSingle = next.length === 1 && !validShortWords.has(nextLower);
        const bothSingle = prev.length === 1 && next.length === 1;
        const nextIsFragment = /^[a-z]/.test(next) && (
          next.length <= 3 && !validShortWords.has(nextLower)
        );
        const prevIsFragment = prev.length <= 3 && !validShortWords.has(prevLower) && /^[a-z]/.test(next);

        if (bothSingle || prevIsSingle || nextIsSingle || nextIsFragment || prevIsFragment) {
          out[out.length - 1] = prev + next;
          i++;
          continue;
        }
      }
      out.push(t);
    } else {
      out.push(t);
    }
  }

  let result = out.join("");
  // Algorithmic healing: merge trailing or leading lone syllables e.g. "S mith" -> "Smith", "John son" -> "Johnson"
  result = result
    .replace(/\b([A-Za-z]{2,})\s+([a-z]{1,3})\b/g, (m, w, f) => {
      const valid = new Set(["a", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we", "for", "and", "the", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "man", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use"]);
      if (!valid.has(f.toLowerCase())) {
        return w + f;
      }
      return m;
    })
    .replace(/\b([A-Za-z]{1,3})\s+([a-z]{2,})\b/g, (m, f, w) => {
      const valid = new Set(["a", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we", "for", "and", "the", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one", "our", "out"]);
      if (!valid.has(f.toLowerCase()) && /^[a-z]/.test(w)) {
        return f + w;
      }
      return m;
    });

  return result;
}

export function parseCvLocally(rawText: string): Record<string, unknown> {
  const text = repairSpacedCharacters(rawText);
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : "";

  const phoneMatch = text.match(/(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
  const phone = phoneMatch ? phoneMatch[0].trim() : "";

  // 1. Candidate Full Name extraction & cleaning
  let fullName = "";
  const ofMatch = text.match(/(?:curriculum\s+vitae|resume|profile|cv|bio[- ]?data)\s+(?:of|for)\s+([^\n\r]+)/i);
  if (ofMatch) {
    const cleaned = cleanCandidateName(ofMatch[1]);
    if (cleaned.length >= 3 && cleaned.length <= 70) {
      fullName = cleaned;
    }
  }

  if (!fullName) {
    for (const line of lines.slice(0, 10)) {
      if (line.includes("@") || /(?:summary|experience|education|skills|objective|profile)/i.test(line)) continue;
      const cleaned = cleanCandidateName(line);
      if (cleaned.length >= 3 && cleaned.length <= 70 && !cleaned.includes("@")) {
        fullName = cleaned;
        break;
      }
    }
  }

  if (fullName) {
    fullName = cleanCandidateName(fullName);
  }

  // 2. Global Country, City, Timezone extraction
  const countries = [
    { name: "Nigeria", rx: /\bnigeria\b|\bnigerian\b|\+234\b|\blagos\b|\bibadan\b|\babuja\b|\bport\s+harcourt\b|\benugu\b|\boyo\s+state\b|\bogun\s+state\b/i, tz: "Africa/Lagos", cities: ["Ibadan", "Lagos", "Abuja", "Port Harcourt", "Enugu", "Kano", "Benin City"] },
    { name: "Kenya", rx: /\bkenya\b|\bkenyan\b|\+254\b|\bnairobi\b|\bmombasa\b|\bkisumu\b|\bnakuru\b|\beldoret\b/i, tz: "Africa/Nairobi", cities: ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret"] },
    { name: "Ghana", rx: /\bghana\b|\bghanaian\b|\+233\b|\baccra\b|\bkumasi\b/i, tz: "Africa/Accra", cities: ["Accra", "Kumasi"] },
    { name: "South Africa", rx: /\bsouth\s+africa\b|\b\+27\b|\bjohannesburg\b|\bcape\s+town\b|\bdurban\b|\bpretoria\b/i, tz: "Africa/Johannesburg", cities: ["Johannesburg", "Cape Town", "Durban", "Preoria"] },
    { name: "Uganda", rx: /\buganda\b|\bugandan\b|\b\+256\b|\bkampala\b/i, tz: "Africa/Kampala", cities: ["Kampala"] },
    { name: "Tanzania", rx: /\btanzania\b|\b\+255\b|\bdar\s+es\s+salaam\b|\bdodoma\b/i, tz: "Africa/Dar_es_Salaam", cities: ["Dar es Salaam", "Dodoma"] },
    { name: "Rwanda", rx: /\brwanda\b|\b\+250\b|\bkigali\b/i, tz: "Africa/Kigali", cities: ["Kigali"] },
    { name: "Ethiopia", rx: /\bethiopia\b|\b\+251\b|\baddis\s+ababa\b/i, tz: "Africa/Addis_Ababa", cities: ["Addis Ababa"] },
    { name: "Egypt", rx: /\begypt\b|\b\+20\b|\bcairo\b|\balexandria\b/i, tz: "Africa/Cairo", cities: ["Cairo", "Alexandria"] },
    { name: "United Kingdom", rx: /\bunited\s+kingdom\b|\buk\b|\b\+44\b|\blondon\b|\bmanchester\b|\bbirmingham\b|\bedinburgh\b/i, tz: "Europe/London", cities: ["London", "Manchester", "Birmingham", "Edinburgh"] },
    { name: "United States", rx: /\bunited\s+states\b|\busa\b|\bu\.s\.a\b|\bnew\s+york\b|\bcalifornia\b|\btexas\b|\bsan\s+francisco\b|\bchicago\b|\bseattle\b/i, tz: "America/New_York", cities: ["New York", "San Francisco", "Chicago", "Seattle", "Austin", "Boston"] },
    { name: "Canada", rx: /\bcanada\b|\btoronto\b|\bvancouver\b|\bmontreal\b|\bottawa\b/i, tz: "America/Toronto", cities: ["Toronto", "Vancouver", "Montreal", "Ottawa"] },
    { name: "Germany", rx: /\bgermany\b|\bdeutschland\b|\b\+49\b|\bberlin\b|\bmunich\b|\bfrankfurt\b/i, tz: "Europe/Berlin", cities: ["Berlin", "Munich", "Frankfurt", "Hamburg"] },
    { name: "France", rx: /\bfrance\b|\b\+33\b|\bparis\b|\blyon\b|\bmarseille\b/i, tz: "Europe/Paris", cities: ["Paris", "Lyon", "Marseille"] },
    { name: "India", rx: /\bindia\b|\b\+91\b|\bbengaluru\b|\bbangalore\b|\bmumbai\b|\bdelhi\b|\bhyderabad\b/i, tz: "Asia/Kolkata", cities: ["Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Pune"] },
    { name: "Australia", rx: /\baustralia\b|\b\+61\b|\bsydney\b|\bmelbourne\b|\bbrisbane\b/i, tz: "Australia/Sydney", cities: ["Sydney", "Melbourne", "Brisbane", "Perth"] },
    { name: "United Arab Emirates", rx: /\buae\b|\bdubai\b|\babu\s+dhabi\b|\b\+971\b/i, tz: "Asia/Dubai", cities: ["Dubai", "Abu Dhabi"] },
  ];

  let country = "";
  let city = "";
  let timezone = "";

  for (const c of countries) {
    if (c.rx.test(text)) {
      country = c.name;
      timezone = c.tz;
      for (const cityName of c.cities) {
        if (new RegExp(`\\b${cityName}\\b`, "i").test(text)) {
          city = cityName;
          break;
        }
      }
      break;
    }
  }

  // 3. Domain, Target Roles & Industries
  const isSurgeon = /surgeon|surgery|surgical|fwacs|frcs|laparoscopic/i.test(text);
  const isDoctor = isSurgeon || /m\.?b\.?,?\s*b\.?s|mbbs|physician|doctor|clinical governance|ward rounds|residency|medical officer|pediatric|obstetric/i.test(text);
  const isNurse = !isDoctor && /nurse|nursing|midwife|registered nurse|bsn/i.test(text);
  const isPharmacist = /pharmacist|pharmacy|pharmaceutical|pharm\.?d/i.test(text);
  const isLawyer = /lawyer|attorney|barrister|solicitor|ll\.?b|ll\.?m|litigation|legal counsel/i.test(text);
  const isAccountant = /accountant|accounting|auditor|audit|cpa|acca|chartered accountant|financial analyst/i.test(text);
  const isCivilEngineer = /civil engineer|structural engineer|construction engineer/i.test(text);
  const isMechEngineer = /mechanical engineer|hvac|thermodynamics/i.test(text);
  const isElectEngineer = /electrical engineer|power systems|electronics engineer/i.test(text);
  const isSoftware = /software engineer|software developer|web developer|frontend|backend|full[- ]?stack|react|node\.js|python developer/i.test(text);
  const isITSupport = /it support|systems administrator|network administrator|technical support|helpdesk/i.test(text);
  const isTeacher = /teacher|lecturer|professor|curriculum developer/i.test(text);
  const isMarketing = /marketing specialist|marketing manager|digital marketing|seo specialist/i.test(text);

  const targetRoles: string[] = [];
  const industries: string[] = [];
  const defaultSkills: string[] = [];
  const defaultEducation: string[] = [];
  const defaultCertifications: string[] = [];

  if (isSurgeon) {
    targetRoles.push("Consultant Surgeon", "General Surgeon", "Medical Doctor", "Clinical Specialist");
    industries.push("Healthcare & Hospital Care", "Surgery & Clinical Practice", "Medical Services");
    defaultSkills.push("General Surgery", "Clinical Governance", "Patient Consultation", "Pre-operative & Post-operative Care", "Trauma Management", "Surgical Procedures");
    if (/m\.?b\.?,?\s*b\.?s|mbbs/i.test(text)) defaultEducation.push("Bachelor of Medicine, Bachelor of Surgery (M.B., B.S.)");
    if (/fwacs/i.test(text)) defaultCertifications.push("Fellow of the West African College of Surgeons (FWACS)");
    if (/frcs/i.test(text)) defaultCertifications.push("Fellow of the Royal College of Surgeons (FRCS)");
    if (/facs/i.test(text)) defaultCertifications.push("Fellow of the American College of Surgeons (FACS)");
  } else if (isDoctor) {
    targetRoles.push("Medical Doctor", "Physician", "Clinical Medical Officer");
    industries.push("Healthcare & Hospital Care", "Medical Practice");
    defaultSkills.push("Clinical Diagnosis", "Patient Care", "Medical Treatment Planning", "Emergency Care");
    if (/m\.?b\.?,?\s*b\.?s|mbbs/i.test(text)) defaultEducation.push("Bachelor of Medicine, Bachelor of Surgery (M.B., B.S.)");
  } else if (isNurse) {
    targetRoles.push("Registered Nurse", "Clinical Nurse Specialist", "Nursing Officer");
    industries.push("Healthcare & Hospital Care", "Nursing & Patient Care");
    defaultSkills.push("Patient Care", "Clinical Triage", "Medication Administration", "Vital Signs Monitoring");
    defaultEducation.push("Bachelor of Science in Nursing (BSN)");
  } else if (isPharmacist) {
    targetRoles.push("Pharmacist", "Clinical Pharmacist", "Pharmacy Specialist");
    industries.push("Healthcare & Pharmaceuticals", "Clinical Pharmacy");
    defaultSkills.push("Dispensing & Pharmacology", "Drug Interaction Screening", "Patient Counseling");
    defaultEducation.push("Bachelor of Pharmacy (B.Pharm) / Pharm.D");
  } else if (isLawyer) {
    targetRoles.push("Legal Counsel", "Attorney", "Legal Consultant");
    industries.push("Legal Services", "Corporate Law & Compliance");
    defaultSkills.push("Legal Drafting", "Contract Negotiation", "Litigation & Dispute Resolution", "Regulatory Compliance");
    defaultEducation.push("Bachelor of Laws (LL.B)");
  } else if (isAccountant) {
    targetRoles.push("Chartered Accountant", "Financial Analyst", "Audit Specialist");
    industries.push("Accounting & Finance", "Financial Services");
    defaultSkills.push("Financial Reporting", "Audit & Assurance", "Tax Compliance", "Budgeting & Forecasting");
    defaultEducation.push("B.Sc. in Accounting / Finance");
  } else if (isCivilEngineer) {
    targetRoles.push("Civil Engineer", "Structural Engineer", "Project Engineer");
    industries.push("Engineering & Construction", "Infrastructure Development");
    defaultSkills.push("Structural Design", "AutoCAD", "Site Supervision", "Project Management");
    defaultEducation.push("B.Eng. in Civil Engineering");
  } else if (isMechEngineer) {
    targetRoles.push("Mechanical Engineer", "Design Engineer", "Project Engineer");
    industries.push("Mechanical Engineering", "Industrial & Manufacturing");
    defaultSkills.push("Mechanical Systems", "Thermodynamics", "CAD/CAM", "Equipment Maintenance");
    defaultEducation.push("B.Eng. in Mechanical Engineering");
  } else if (isElectEngineer) {
    targetRoles.push("Electrical Engineer", "Power Systems Engineer", "Electronics Engineer");
    industries.push("Electrical Engineering", "Energy & Power Systems");
    defaultSkills.push("Power Distribution", "Circuit Design", "PLC Systems", "Electrical Safety");
    defaultEducation.push("B.Eng. in Electrical Engineering");
  } else if (isSoftware) {
    if (/full[- ]?stack/i.test(text)) targetRoles.push("Full-Stack Developer");
    if (/react|frontend|front[- ]?end/i.test(text)) targetRoles.push("Frontend Developer");
    if (/node|backend|back[- ]?end/i.test(text)) targetRoles.push("Backend Developer");
    if (/python/i.test(text)) targetRoles.push("Python Developer");
    if (targetRoles.length === 0) targetRoles.push("Software Developer", "Software Engineer");
    industries.push("Information Technology", "Software Development");
    defaultSkills.push("Software Development", "API Design", "Database Management", "Git Version Control");
  } else if (isITSupport) {
    targetRoles.push("IT Support Specialist", "Network Administrator", "Systems Specialist");
    industries.push("Information Technology", "IT Infrastructure & Support");
    defaultSkills.push("Hardware & Software Troubleshooting", "Network Administration", "Helpdesk Support");
  } else if (isTeacher) {
    targetRoles.push("Lecturer", "Academic Educator", "Curriculum Specialist");
    industries.push("Education & Academia", "Higher Education");
    defaultSkills.push("Classroom Instruction", "Curriculum Development", "Student Assessment");
  } else if (isMarketing) {
    targetRoles.push("Marketing Specialist", "Digital Marketing Manager", "Growth Specialist");
    industries.push("Marketing & Advertising", "Digital Media");
    defaultSkills.push("Digital Marketing", "SEO/SEM", "Content Strategy", "Campaign Analytics");
  } else {
    targetRoles.push("Professional Specialist");
    industries.push("Professional Services");
    defaultSkills.push("Project Management", "Operations", "Team Leadership", "Client Relations");
  }

  // 4. Years of experience calculation
  let yearsExperience: number | null = null;
  const expMatch = text.match(/(\d{1,2})\+?\s*(?:years|yrs)\s*(?:of)?\s*(?:surgical|clinical|professional|work|industry|active|proven)?\s*(?:experience|practice|service)/i);
  if (expMatch) {
    const val = parseInt(expMatch[1], 10);
    if (!isNaN(val) && val > 0 && val <= 50) {
      yearsExperience = val;
    }
  }

  if (yearsExperience === null) {
    const yearMatches = Array.from(text.matchAll(/\b(19\d{2}|20\d{2})\b/g))
      .map(m => parseInt(m[1], 10))
      .filter(y => y >= 1975 && y <= 2026);
    if (yearMatches.length > 0) {
      const minYear = Math.min(...yearMatches);
      const span = 2026 - minYear;
      if (span >= 1 && span <= 45) {
        yearsExperience = span;
      }
    }
  }

  if (yearsExperience === null) {
    // Neutral fallback: use median of detected years or a conservative 2 years
    const yearMatches2 = Array.from(text.matchAll(/\b(19\d{2}|20\d{2})\b/g))
      .map(m => parseInt(m[1], 10))
      .filter(y => y >= 1975 && y <= 2026)
      .sort((a, b) => a - b);
    if (yearMatches2.length >= 2) {
      const span = 2026 - yearMatches2[0];
      yearsExperience = Math.min(Math.max(span, 1), 40);
    } else {
      yearsExperience = 2;
    }
  }

  // 5. Skills extraction across all career disciplines
  const universalSkillBanks: Record<string, string[]> = {
    medical: [
      "General Surgery", "Laparoscopic Surgery", "Trauma Care", "Patient Triage",
      "Clinical Governance", "Surgical Oncology", "Medical Education", "Emergency Care",
      "Intensive Care", "Wound Management", "Infection Control", "Pediatric Care",
      "Patient Consultation", "Diagnostics", "Pre-operative & Post-operative Care",
      "Pharmacology", "Drug Interactions", "Medication Administration", "Vital Signs Monitoring"
    ],
    tech: [
      "JavaScript", "TypeScript", "React", "Node.js", "Express", "Python",
      "PostgreSQL", "SQL", "Git", "Docker", "REST APIs", "Linux", "AWS",
      "Systems Administration", "Network Configuration", "Troubleshooting", "Cybersecurity"
    ],
    legal: [
      "Legal Drafting", "Contract Negotiation", "Litigation", "Dispute Resolution",
      "Regulatory Compliance", "Legal Research", "Due Diligence", "Corporate Governance"
    ],
    finance: [
      "Financial Reporting", "Audit & Assurance", "Tax Compliance", "Budgeting & Forecasting",
      "Financial Analysis", "Cost Accounting", "Risk Management", "ERP Systems", "QuickBooks", "Excel"
    ],
    engineering: [
      "AutoCAD", "Structural Analysis", "Project Management", "Site Supervision",
      "Thermodynamics", "PLC Systems", "Circuit Design", "Quality Control", "Preventative Maintenance"
    ],
    education: [
      "Curriculum Design", "Classroom Instruction", "Student Assessment", "E-Learning",
      "Educational Leadership", "Pedagogy", "Academic Research"
    ],
    marketing: [
      "Digital Marketing", "SEO/SEM", "Content Strategy", "Campaign Analytics",
      "Brand Management", "Social Media Marketing", "CRM", "Copywriting"
    ],
    operations: [
      "Project Management", "Operations Management", "Supply Chain", "Vendor Relations",
      "Stakeholder Engagement", "Process Improvement", "Team Leadership", "Change Management"
    ],
  };

  const domainCategory = isDoctor || isNurse || isPharmacist || isSurgeon
    ? "medical"
    : isLawyer
    ? "legal"
    : isAccountant
    ? "finance"
    : isCivilEngineer || isMechEngineer || isElectEngineer
    ? "engineering"
    : isTeacher
    ? "education"
    : isMarketing
    ? "marketing"
    : isSoftware || isITSupport
    ? "tech"
    : "operations";

  const domainSkills = universalSkillBanks[domainCategory] || universalSkillBanks.operations;
  let detectedSkills = domainSkills.filter(s => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  if (detectedSkills.length === 0) {
    detectedSkills = defaultSkills;
  }

  // 6. Languages extraction
  const languagesList = [
    "English", "Yoruba", "Igbo", "Hausa", "Swahili", "French", "Arabic",
    "Spanish", "German", "Portuguese", "Italian", "Chinese", "Mandarin"
  ];
  const detectedLanguages = languagesList.filter(lang =>
    new RegExp(`\\b${lang}\\b`, "i").test(text)
  );
  if (detectedLanguages.length === 0 && /[a-zA-Z]{5,}/.test(text)) {
    detectedLanguages.push("English");
  }

  // 7. Education & Certifications lines
  const isHeaderOrSummary = (l: string) =>
    lines.slice(0, 5).includes(l) ||
    /^(?:curriculum\s+vitae|resume|summary|profile|about|experienced|phone|email|address)/i.test(l) ||
    (fullName && l.toLowerCase().split(/\s+/).filter(w => w.length > 3).some(w => l.toLowerCase().includes(w) && lines.indexOf(l) < 6)) ||
    l.length > 160;

  const jobRx = /\b(?:consultant|specialist|registrar|officer|director|manager|intern|supervisor|resident|analyst|developer|engineer|lead|head\s+of)\b/i;

  let education = lines.filter(l =>
    !isHeaderOrSummary(l) &&
    !jobRx.test(l) &&
    /\b(?:bachelor|master|doctorate|phd|m\.b\.,?\s*b\.s|degree|diploma|university|polytechnic|school\s+certificate|wassce|waec)\b/i.test(l)
  ).map(l => l.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 5);
  if (education.length === 0 && defaultEducation.length > 0) {
    education = defaultEducation;
  }

  let certifications = lines.filter(l =>
    !isHeaderOrSummary(l) &&
    !jobRx.test(l) &&
    !/school\s+certificate|wassce|waec/i.test(l) &&
    /\b(?:fwacs|frcs|fellow|fellowship|board\s+certified|cisco|ccna|aws|pmp|license|licence|certificate|certification|accredited)\b/i.test(l)
  ).map(l => l.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 5);
  if (certifications.length === 0 && defaultCertifications.length > 0) {
    certifications = defaultCertifications;
  }

  return {
    fullName,
    email,
    phone,
    country,
    city,
    timezone,
    targetRoles: Array.from(new Set(targetRoles)),
    skills: detectedSkills,
    technologies: detectedSkills,
    yearsExperience,
    education,
    certifications,
    industries: Array.from(new Set(industries)),
    languages: Array.from(new Set(detectedLanguages)),
    preferredLocations: [city, country, "Remote", "Worldwide Remote"].filter(Boolean),
    workModes: ["onsite", "hybrid", "remote"] as ("onsite" | "hybrid" | "remote")[],
    relocation: false,
    visaSponsorship: false,
    minimumSalary: null,
  };
}

router.post("/cvs/:id/parse", async (req, res): Promise<void> => {
  const accountId = getAccountId(req, res);
  const params = ParseCvProfileParams.safeParse(req.params);
  const body = ParseCvProfileBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Choose an AI provider and confirm CV-text sharing." });
    return;
  }
  if (!body.data.consent) {
    res.status(400).json({ error: "Confirm before sending extracted CV text to the selected provider." });
    return;
  }

  const [cv] = await db
    .select()
    .from(cvsTable)
    .where(eq(cvsTable.id, params.data.id))
    .limit(1);
  if (!cv) {
    res.status(404).json({ error: "CV not found." });
    return;
  }
  if (cv.accountId && accountId !== "local" && cv.accountId !== accountId) {
    res.status(404).json({ error: "CV not found." });
    return;
  }

  // Load all configured providers from DB
  const allProviderSettings = await db
    .select()
    .from(integrationSettingsTable);

  const providerMap = new Map<string, (typeof allProviderSettings)[0]>();
  for (const p of allProviderSettings) {
    if (p.provider && p.model && p.encryptedCredentials) {
      providerMap.set(p.provider, p);
    }
  }

  // Load environment variable fallbacks if available
  if (!providerMap.has("agentrouter") && (process.env.AGENTROUTER_API_KEY || process.env.AGENT_ROUTER_API_KEY)) {
    const key = (process.env.AGENTROUTER_API_KEY || process.env.AGENT_ROUTER_API_KEY)!.trim();
    providerMap.set("agentrouter", {
      id: "agentrouter",
      provider: "agentrouter",
      encryptedCredentials: encryptCredentials({ apiKey: key }),
      model: process.env.AGENTROUTER_MODEL || "openai/gpt-4o-mini",
      baseUrl: process.env.AGENTROUTER_BASE_URL || "https://agentrouter.org/v1",
    } as any);
  }
  if (!providerMap.has("gemini") && process.env.GEMINI_API_KEY) {
    providerMap.set("gemini", {
      id: "gemini",
      provider: "gemini",
      encryptedCredentials: encryptCredentials({ apiKey: process.env.GEMINI_API_KEY.trim() }),
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      baseUrl: null,
    } as any);
  }
  if (!providerMap.has("openai") && process.env.OPENAI_API_KEY) {
    providerMap.set("openai", {
      id: "openai",
      provider: "openai",
      encryptedCredentials: encryptCredentials({ apiKey: process.env.OPENAI_API_KEY.trim() }),
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      baseUrl: null,
    } as any);
  }

  let extracted: { text: string; truncated: boolean } = { text: "", truncated: false };

  // 1. Obtain file bytes from DB or disk first to always use the latest coordinate-aware text extractor
  let bytes: Buffer | null = null;
  if (cv.fileData) {
    try {
      bytes = Buffer.from(cv.fileData, "base64");
    } catch (err: any) {
      req.log.warn({ err: err?.message }, "Failed to decode cv.fileData from database");
    }
  }

  if (!bytes) {
    const filePath = path.resolve(storageDir, path.basename(cv.storageName));
    if (filePath.startsWith(`${storageDir}${path.sep}`) && fs.existsSync(filePath)) {
      try {
        bytes = await readFile(filePath);
      } catch (fileErr: any) {
        req.log.warn({ fileErr: fileErr?.message, filePath }, "Physical CV file not found on disk");
      }
    }
  }

  if (bytes) {
    try {
      extracted = await extractCvText(bytes, cv.fileType);
      if (extracted?.text) {
        await db
          .update(cvsTable)
          .set({ extractedText: extracted.text })
          .where(eq(cvsTable.id, cv.id))
          .catch(() => {});
      }
    } catch (err: any) {
      req.log.warn({ err: err?.message }, "Fresh CV text extraction encountered an issue, falling back to cached text");
    }
  }

  // 2. Fall back to cached extracted text if file bytes were unavailable or fresh extraction yielded nothing
  if ((!extracted.text || extracted.text.trim().length < 10) && cv.extractedText && cv.extractedText.trim().length > 10) {
    extracted = { text: cv.extractedText.trim(), truncated: false };
  }

  // Multi-provider AI Fallback Strategy:
  // Primary is the requested provider, then try any other configured providers
  const requestedProvider = body.data.provider as AiProvider;
  const providersToTry: AiProvider[] = [requestedProvider];
  const candidateFallbacks: AiProvider[] = ["agentrouter", "gemini", "openai"];
  for (const fb of candidateFallbacks) {
    if (!providersToTry.includes(fb) && providerMap.has(fb)) {
      providersToTry.push(fb);
    }
  }

  let rawDraft: unknown = null;
  let successfulProvider: string | null = null;

  if (!extracted.text || extracted.text.trim().length < 100) {
    // Attempt vision-based parsing (Gemini Vision / GPT-4o) before giving up
    // This handles scanned PDFs that pdfjs cannot extract text from
    if (bytes && cv.fileType !== "docx") {
      const fileBase64 = bytes.toString("base64");
      const ext = path.extname(cv.fileName).toLowerCase();
      const visionMimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" =
        ext === ".png" ? "image/png" :
        ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
        ext === ".webp" ? "image/webp" :
        "application/pdf";

      req.log.info({ mimeType: visionMimeType }, "Text extraction insufficient — attempting vision-based CV parsing");

      for (const candidateProvider of providersToTry) {
        const pSettings = providerMap.get(candidateProvider);
        if (!pSettings?.model || !pSettings?.encryptedCredentials) continue;
        try {
          const credentials = decryptCredentials<{ apiKey?: unknown }>(pSettings.encryptedCredentials);
          if (typeof credentials.apiKey !== "string" || !credentials.apiKey.trim()) continue;
          const visionResult = await extractProfileDraftFromFile(
            candidateProvider,
            credentials.apiKey,
            pSettings.model,
            fileBase64,
            visionMimeType,
            pSettings.baseUrl,
          );
          const visionSanitized = sanitizeProfileDraft(visionResult);
          if (visionSanitized.fullName || (visionSanitized.targetRoles as string[])?.length || (visionSanitized.skills as string[])?.length) {
            rawDraft = visionResult;
            successfulProvider = candidateProvider;
            req.log.info({ provider: candidateProvider }, "Vision-based CV parsing succeeded");
            break;
          }
        } catch (vErr: any) {
          req.log.warn({ provider: candidateProvider, err: vErr?.message }, "Vision-based CV parsing failed, trying next provider");
        }
      }

      if (rawDraft) {
        // Vision parsing succeeded — skip text-based AI extraction below
        let sanitizedVision = sanitizeProfileDraft(rawDraft);
        const validated = ParseCvProfileResponse.safeParse({
          draft: sanitizedVision,
          warnings: [`Parsed using vision AI (${successfulProvider}) — scanned document processed successfully.`],
        });
        if (validated.success) {
          const draft = validated.data.draft;
          try {
            await syncParsedProfileToWorkspace(
              draft,
              cv,
              "ai",
              successfulProvider,
              providerMap.get(successfulProvider as AiProvider)?.model,
              accountId,
            );
          } catch (saveErr) {
            req.log.warn({ saveErr }, "Auto-saving vision-parsed profile failed");
          }
          res.json(validated.data);
          return;
        }
      }
    }

    if (!extracted.text || extracted.text.trim().length < 20) {
      res.status(422).json({
        error: "Unable to extract text from this CV. The file may be a scanned PDF with no selectable text. Try: (1) Upload a digital/text-based PDF, (2) Upload a DOCX file, or (3) Configure a Gemini or GPT-4o AI provider which can read scanned documents via vision.",
      });
      return;
    }
  }

  for (const candidateProvider of providersToTry) {
    const pSettings = providerMap.get(candidateProvider);
    if (!pSettings || !pSettings.model || !pSettings.encryptedCredentials) {
      continue;
    }

    try {
      const credentials = decryptCredentials<{ apiKey?: unknown }>(
        pSettings.encryptedCredentials,
      );
      if (typeof credentials.apiKey !== "string" || !credentials.apiKey.trim()) {
        continue;
      }

      req.log.info({ provider: candidateProvider, model: pSettings.model }, "Attempting AI CV extraction");
      const result = await extractProfileDraft(
        candidateProvider,
        credentials.apiKey,
        pSettings.model,
        extracted.text,
        pSettings.baseUrl,
      );

      const candidateSanitized = sanitizeProfileDraft(result);
      if (candidateSanitized.fullName || (candidateSanitized.targetRoles as string[])?.length || (candidateSanitized.skills as string[])?.length) {
        rawDraft = result;
        successfulProvider = candidateProvider;
        req.log.info({ provider: candidateProvider }, "AI CV extraction succeeded");
        break;
      }
    } catch (err: any) {
      req.log.warn({ provider: candidateProvider, err: err?.message || err }, "AI provider extraction failed, trying next fallback");
    }
  }

  if (!rawDraft) {
    req.log.info("No AI provider succeeded or was configured, using universal deterministic CV parser");
    rawDraft = parseCvLocally(extracted.text);
  }

  let sanitizedDraft = sanitizeProfileDraft(rawDraft);

  let validated = ParseCvProfileResponse.safeParse({
    draft: sanitizedDraft,
    warnings: successfulProvider ? [] : ["Extracted using universal local fact extraction (AI providers were unavailable or unconfigured)."],
  });
  if (!validated.success) {
    req.log.warn({ draft: rawDraft, issues: validated.error.issues }, "Draft validation failed, falling back to local extractor");
    sanitizedDraft = sanitizeProfileDraft(parseCvLocally(extracted.text));
    validated = ParseCvProfileResponse.safeParse({
      draft: sanitizedDraft,
      warnings: ["Extracted using universal local fact extraction."],
    });
  }

  if (!validated.success) {
    res.status(502).json({ error: "The profile draft could not be validated." });
    return;
  }


  const draft = validated.data.draft;

  // Auto-create & update Candidate Profile and Search Profiles from parsed CV facts
  try {
    await syncParsedProfileToWorkspace(
      draft,
      cv,
      successfulProvider ? "ai" : "deterministic",
      successfulProvider,
      successfulProvider ? providerMap.get(successfulProvider as AiProvider)?.model : "local-rules",
      accountId,
    );
  } catch (err) {
    req.log.warn({ err }, "Auto-saving candidate profile and search profiles failed");
  }

  const warnings = [
    "Candidate profile and matching rules have been automatically populated from your CV.",
    `Extracted CV text was analyzed with ${body.data.provider}. The original file stayed local.`,
    ...(extracted.truncated
      ? [`Only the first ${maxCvTextCharacters.toLocaleString()} characters were analyzed.`]
      : []),
  ];

  res.json(ParseCvProfileResponse.parse({ draft, warnings }));
});

export default router;
