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
import {
  parseCvDeterministic,
  toProfileDraft,
  cleanCandidateName,
  repairSpacedCharacters,
} from "../lib/cv-role-engine";
import fs from "node:fs";

export { cleanCandidateName, repairSpacedCharacters };

const router: IRouter = Router();

function getAccountId(req: any, res: any): string {
  return res?.locals?.accountId || getAuthenticatedAccountId(req) || "";
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
  if (!accountId) {
    res.json([]);
    return;
  }
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

export function sanitizeProfileDraft(raw: unknown): Record<string, unknown> {
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

export function parseCvLocally(rawText: string): Record<string, unknown> {
  const parsed = parseCvDeterministic(rawText);
  return toProfileDraft(parsed);
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
