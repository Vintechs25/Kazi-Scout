import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { Router, type IRouter } from "express";
import { desc, eq, inArray } from "drizzle-orm";
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
  cvsTable,
  db,
  integrationSettingsTable,
  searchProfilesTable,
} from "@workspace/db";
import { decryptCredentials } from "../lib/credential-encryption";
import {
  extractCvText,
  maxCvTextCharacters,
} from "../lib/cv-text-extraction";
import {
  extractProfileDraft,
  yearsFrom,
  type AiProvider,
} from "../lib/provider-services";

import fs from "node:fs";

const router: IRouter = Router();

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

router.get("/cvs", async (_req, res): Promise<void> => {
  const records = await db.select().from(cvsTable).orderBy(desc(cvsTable.uploadedAt));
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
  const { id } = req.params;
  const [record] = await db.select().from(cvsTable).where(eq(cvsTable.id, id)).limit(1);
  if (!record) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const filePath = path.resolve(storageDir, record.storageName);
  res.download(filePath, record.fileName);
});

router.put("/cvs/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { category, title, isMaster } = req.body;

  const [existing] = await db.select().from(cvsTable).where(eq(cvsTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const updates: any = {};
  if (category !== undefined) updates.category = category;
  if (title !== undefined) updates.title = title;
  if (isMaster === true) {
    await db.update(cvsTable).set({ isMaster: false });
    updates.isMaster = true;
  } else if (isMaster === false) {
    updates.isMaster = false;
  }

  await db.update(cvsTable).set(updates).where(eq(cvsTable.id, id));
  res.json({ success: true, message: "Document updated." });
});

router.post("/cvs", upload.single("file"), async (req, res): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Choose a PDF, DOCX, or Image file to upload." });
    return;
  }
  const ext = path.extname(file.originalname).toLowerCase();
  const fileType = ext === ".docx" ? "docx" : "pdf";
  const category = req.body?.category || (ext === ".jpg" || ext === ".png" ? "national_id" : "cv");
  const title = req.body?.title || path.basename(file.originalname, ext);

  const [existingMaster] = await db
    .select({ id: cvsTable.id })
    .from(cvsTable)
    .where(eq(cvsTable.isMaster, true))
    .limit(1);
  const requestedMaster = req.body?.isMaster === "true" || req.body?.isMaster === "1";
  const isMaster = category === "cv" && (requestedMaster || !existingMaster);
  if (isMaster) {
    await db.update(cvsTable).set({ isMaster: false });
  }

  const safeName = path
    .basename(file.originalname)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 240);
  const [record] = await db
    .insert(cvsTable)
    .values({
      id: randomUUID(),
      fileName: safeName,
      storageName: path.basename(file.filename),
      fileType: fileType as any,
      category,
      title,
      sizeBytes: file.size,
      isMaster,
      uploadedAt: new Date(),
    })
    .returning();

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
  res.status(204).end();
});

router.post("/cvs/bulk", async (req, res): Promise<void> => {
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

  try {
    if (action === "delete") {
      const records = await db.select().from(cvsTable).where(inArray(cvsTable.id, validIds));
      for (const record of records) {
        const filePath = path.resolve(storageDir, record.storageName);
        if (filePath.startsWith(`${storageDir}${path.sep}`)) {
          await unlink(filePath).catch(() => {});
        }
      }
      await db.delete(cvsTable).where(inArray(cvsTable.id, validIds));
      res.json({ success: true, count: validIds.length, action: "delete" });
    } else if (action === "category") {
      const validCategories = ["cv", "cover_letter", "certificate", "recommendation", "portfolio", "other"];
      if (!category || !validCategories.includes(category)) {
        res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(", ")}` });
        return;
      }
      await db.update(cvsTable)
        .set({ category: category as any })
        .where(inArray(cvsTable.id, validIds));
      res.json({ success: true, count: validIds.length, action: "category", category });
    } else {
      res.status(400).json({ error: "Invalid action. Supported: delete, category" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Bulk CV operation failed" });
  }
});

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

  const fullName = cleanString(source.fullName || source.name || source.full_name, 240);
  if (fullName) draft.fullName = fullName;

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

function parseCvLocally(text: string): Record<string, unknown> {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : "";

  const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{3,4}/);
  const phone = phoneMatch ? phoneMatch[0] : "";

  let fullName = lines[0] || "";
  if (fullName.length > 50 || fullName.includes("@") || fullName.includes("http")) {
    const candidateName = lines.find(l => l.length > 3 && l.length < 45 && !l.includes("@") && !l.includes("http") && !l.includes("CV") && !/developer|engineer|summary|skills/i.test(l));
    if (candidateName) fullName = candidateName;
  }

  const hasKenya = /nairobi|mombasa|kisumu|kenya|\+254/i.test(text);
  const country = hasKenya ? "Kenya" : "Kenya";
  const city = /nairobi/i.test(text) ? "Nairobi" : (hasKenya ? "Nairobi" : "");

  const knownTech = [
    "JavaScript", "TypeScript", "React", "React.js", "Vite", "Node.js", "Express", "Python",
    "PostgreSQL", "Supabase", "SQL", "Tailwind CSS", "HTML5", "CSS3", "Git", "GitHub",
    "REST APIs", "Postman", "Linux", "Windows", "Cisco Packet Tracer", "LAN/Wi-Fi", "Docker", "Shell scripting",
  ];
  const detectedTech = knownTech.filter(tech => new RegExp(`\\b${tech.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));

  const targetRoles: string[] = [];
  if (/full[- ]?stack/i.test(text)) targetRoles.push("Full-Stack Developer");
  if (/react|frontend|front[- ]?end/i.test(text)) targetRoles.push("Frontend Developer", "React Developer");
  if (/node|backend|back[- ]?end/i.test(text)) targetRoles.push("Node.js Developer", "Backend Developer");
  if (/python|automation/i.test(text)) targetRoles.push("Python Automation Developer");
  if (/it support|networking|systems|troubleshoot/i.test(text)) targetRoles.push("IT Support Specialist", "Technical Support Specialist");
  if (targetRoles.length === 0) targetRoles.push("Software Developer", "Web Developer");

  let yearsExperience = 1.5;
  if (/diploma.*2025|graduat.*2025/i.test(text)) {
    yearsExperience = 1.0;
  }

  return {
    fullName,
    email,
    phone,
    country,
    city,
    timezone: hasKenya ? "Africa/Nairobi" : "UTC+3",
    targetRoles: Array.from(new Set(targetRoles)),
    skills: detectedTech,
    technologies: detectedTech,
    yearsExperience,
    education: lines.filter(l => /diploma|degree|bachelor|university|high school/i.test(l)).slice(0, 4),
    certifications: lines.filter(l => /certificate|academy|cisco|comptia|aws|ccna/i.test(l)).slice(0, 4),
    industries: ["Software", "Web Development", "IT Services"],
    languages: ["English", "Swahili"],
    preferredLocations: [city, country, "Remote", "Worldwide Remote"].filter(Boolean),
    workModes: ["remote", "hybrid", "onsite"],
    relocation: false,
    visaSponsorship: false,
    minimumSalary: null,
  };
}

router.post("/cvs/:id/parse", async (req, res): Promise<void> => {
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

  const [providerSettings] = await db
    .select()
    .from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.provider, body.data.provider))
    .limit(1);
  if (!providerSettings?.model) {
    res.status(409).json({ error: "Configure this AI provider before parsing a CV." });
    return;
  }

  let apiKey: string;
  try {
    const credentials = decryptCredentials<{ apiKey?: unknown }>(
      providerSettings.encryptedCredentials,
    );
    if (typeof credentials.apiKey !== "string") {
      throw new Error("Saved credentials are incomplete.");
    }
    apiKey = credentials.apiKey;
  } catch {
    res.status(409).json({ error: "Saved credentials could not be opened. Enter the API key again." });
    return;
  }

  const filePath = path.resolve(storageDir, path.basename(cv.storageName));
  if (!filePath.startsWith(`${storageDir}${path.sep}`)) {
    res.status(404).json({ error: "CV file not found." });
    return;
  }

  let extracted: { text: string; truncated: boolean };
  try {
    const bytes = await readFile(filePath);
    extracted = await extractCvText(bytes, cv.fileType);
  } catch {
    res.status(422).json({ error: "The CV could not be read. Try another PDF or DOCX file." });
    return;
  }
  if (!extracted.text) {
    res.status(422).json({
      error: "No selectable text was found. Scanned PDFs need OCR before they can be parsed.",
    });
    return;
  }

  let rawDraft: unknown;
  try {
    rawDraft = await extractProfileDraft(
      body.data.provider as AiProvider,
      apiKey,
      providerSettings.model,
      extracted.text,
      providerSettings.baseUrl,
    );
  } catch (err) {
    req.log.warn({ provider: body.data.provider, err }, "AI provider extraction failed, falling back to precision local parser");
    rawDraft = parseCvLocally(extracted.text);
  }

  let sanitizedDraft = sanitizeProfileDraft(rawDraft);

  let validated = ParseCvProfileResponse.safeParse({
    draft: sanitizedDraft,
    warnings: [],
  });
  if (!validated.success) {
    req.log.warn({ draft: rawDraft, issues: validated.error.issues }, "Draft validation failed, falling back to local extractor");
    sanitizedDraft = sanitizeProfileDraft(parseCvLocally(extracted.text));
    validated = ParseCvProfileResponse.safeParse({
      draft: sanitizedDraft,
      warnings: [],
    });
  }

  if (!validated.success) {
    res.status(502).json({ error: "The profile draft could not be validated." });
    return;
  }

  const draft = validated.data.draft;

  // Auto-create & update Candidate Profile and Search Profiles from parsed CV facts
  const updatedAt = new Date();
  try {
    const profileToSave = {
      id: "primary",
      fullName: draft.fullName || "",
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

    await db
      .insert(candidateProfilesTable)
      .values(profileToSave)
      .onConflictDoUpdate({
        target: candidateProfilesTable.id,
        set: profileToSave,
      });

    // Auto-create Search Profiles for detected target roles
    const roles =
      Array.isArray(draft.targetRoles) && draft.targetRoles.length > 0
        ? draft.targetRoles
        : ["General Role"];

    for (const role of roles.slice(0, 3)) {
      const profileName = `${role}`;
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
          : [];

      let remoteSetting: "any" | "remote" | "hybrid" | "onsite" = "any";
      if (draft.workModes && draft.workModes.length === 1) {
        remoteSetting = draft.workModes[0];
      }

      await db
        .insert(searchProfilesTable)
        .values({
          id: randomUUID(),
          name: profileName,
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

    await db.insert(activityTable).values({
      id: randomUUID(),
      kind: "profile",
      message: `Parsed ${cv.fileName}. Profile and search rules auto-configured.`,
      createdAt: updatedAt,
    });
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
