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

export function repairSpacedCharacters(str: string): string {
  let res = str.replace(/\b([A-Za-z])\s+([A-Za-z])(?:\s+([A-Za-z]))+\b/g, (match) =>
    match.replace(/\s+/g, "")
  );
  res = res.replace(/\bCurr\s+icul\s+u\s+m\b/gi, "Curriculum");
  res = res.replace(/\bvita\s+e\b/gi, "vitae");
  res = res.replace(/\bDr\s*\.\s*/gi, "Dr. ");
  return res;
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
  for (const line of lines.slice(0, 8)) {
    let cleaned = line
      .replace(/^(?:curriculum\s+vitae|resume|bio[- ]?data|profile|cv)\s*(?:of|for|:)?\s*/i, "")
      .replace(/^(?:dr|prof|engr|barr|mr|mrs|ms|miss)\.?\s+/i, (match) => match.trim() + " ")
      .trim();

    cleaned = cleaned
      .replace(/\s*[\\\/].*$/, "")
      .replace(/\s*\(?(?:M\.?B\.?,?\s*B\.?S\.?|F\.?W\.?A\.?C\.?S\.?|F\.?R\.?C\.?S\.?|Ph\.?D\.?|M\.?Sc\.?|B\.?Sc\.?|LL\.?B\.?|CPA|ACA)[^)]*\)?/gi, "")
      .replace(/,\s*(?:No\.?\s*\d+|Plot\s+\d+|Street|Road|Estate|Avenue|Close).*$/i, "")
      .replace(/^[,\s.-]+|[,\s.-]+$/g, "")
      .trim();

    if (cleaned.length >= 3 && cleaned.length <= 60 && !cleaned.includes("@") && !/^https?:\/\//i.test(cleaned)) {
      if (!/^(?:curriculum|resume|experience|education|skills|summary|profile|contact)/i.test(cleaned)) {
        fullName = cleaned;
        break;
      }
    }
  }

  if (fullName) {
    fullName = fullName.split(/\s+/).map(word => {
      if (/^[A-Z]{3,}$/.test(word) && !/^(?:USA|UK|UAE|II|III|IV)$/.test(word)) {
        return word.charAt(0) + word.slice(1).toLowerCase();
      }
      return word;
    }).join(" ");
  }

  // 2. Global Country, City, Timezone extraction
  const countries = [
    { name: "Nigeria", rx: /\bnigeria\b|\bnigerian\b|\+234\b|\blagos\b|\bibadan\b|\babuja\b|\bport\s+harcourt\b|\benugu\b|\boyo\s+state\b|\bogun\s+state\b/i, tz: "Africa/Lagos", cities: ["Ibadan", "Lagos", "Abuja", "Port Harcourt", "Enugu", "Kano", "Benin City"] },
    { name: "Kenya", rx: /\bkenya\b|\bkenyan\b|\+254\b|\bnairobi\b|\bmombasa\b|\bkisumu\b|\bnakuru\b|\beldoret\b/i, tz: "Africa/Nairobi", cities: ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret"] },
    { name: "Ghana", rx: /\bghana\b|\bghanaian\b|\+233\b|\baccra\b|\bkumasi\b/i, tz: "Africa/Accra", cities: ["Accra", "Kumasi"] },
    { name: "South Africa", rx: /\bsouth\s+africa\b|\b\+27\b|\bjohannesburg\b|\bcape\s+town\b|\bdurban\b|\bpretoria\b/i, tz: "Africa/Johannesburg", cities: ["Johannesburg", "Cape Town", "Durban", "Pretoria"] },
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
  const isDoctor = isSurgeon || /m\.?b\.?,?\s*b\.?s|physician|doctor of medicine|clinical governance|ward rounds|residency|medical officer|pediatric|obstetric|gynecol/i.test(text);
  const isNurse = !isDoctor && /nurse|nursing|midwife|registered nurse|bsn|clinical nurse/i.test(text);
  const isPharmacist = /pharmacist|pharmacy|pharmaceutical|pharm\.?d/i.test(text);
  const isLawyer = /lawyer|attorney|barrister|solicitor|ll\.?b|ll\.?m|litigation|legal counsel/i.test(text);
  const isAccountant = /accountant|accounting|auditor|audit|cpa|acca|chartered accountant|financial analyst/i.test(text);
  const isCivilEngineer = /civil engineer|structural engineer|construction engineer/i.test(text);
  const isMechEngineer = /mechanical engineer|hvac|thermodynamics/i.test(text);
  const isElectEngineer = /electrical engineer|power systems|electronics engineer/i.test(text);
  const isSoftware = /software engineer|software developer|web developer|frontend|backend|full[- ]?stack|react|node\.js|python developer|mobile developer/i.test(text);
  const isITSupport = /it support|systems administrator|network administrator|technical support|helpdesk/i.test(text);
  const isTeacher = /teacher|lecturer|professor|curriculum developer|secondary school teacher/i.test(text);
  const isMarketing = /marketing specialist|marketing manager|digital marketing|seo specialist/i.test(text);

  const targetRoles: string[] = [];
  const industries: string[] = [];

  if (isSurgeon) {
    targetRoles.push("Consultant Surgeon", "General Surgeon", "Medical Doctor", "Clinical Specialist");
    industries.push("Healthcare & Hospital Care", "Surgery & Clinical Practice", "Medical Services");
  } else if (isDoctor) {
    targetRoles.push("Medical Doctor", "Physician", "Clinical Medical Officer");
    industries.push("Healthcare & Hospital Care", "Medical Practice");
  } else if (isNurse) {
    targetRoles.push("Registered Nurse", "Clinical Nurse Specialist", "Nursing Officer");
    industries.push("Healthcare & Hospital Care", "Nursing & Patient Care");
  } else if (isPharmacist) {
    targetRoles.push("Pharmacist", "Clinical Pharmacist", "Pharmacy Specialist");
    industries.push("Healthcare & Pharmaceuticals", "Clinical Pharmacy");
  } else if (isLawyer) {
    targetRoles.push("Legal Counsel", "Attorney", "Legal Consultant");
    industries.push("Legal Services", "Corporate Law & Compliance");
  } else if (isAccountant) {
    targetRoles.push("Chartered Accountant", "Financial Analyst", "Audit Specialist");
    industries.push("Accounting & Finance", "Financial Services");
  } else if (isCivilEngineer) {
    targetRoles.push("Civil Engineer", "Structural Engineer", "Project Engineer");
    industries.push("Engineering & Construction", "Infrastructure Development");
  } else if (isMechEngineer) {
    targetRoles.push("Mechanical Engineer", "Design Engineer", "Project Engineer");
    industries.push("Mechanical Engineering", "Industrial & Manufacturing");
  } else if (isElectEngineer) {
    targetRoles.push("Electrical Engineer", "Power Systems Engineer", "Electronics Engineer");
    industries.push("Electrical Engineering", "Energy & Power Systems");
  } else if (isSoftware) {
    if (/full[- ]?stack/i.test(text)) targetRoles.push("Full-Stack Developer");
    if (/react|frontend|front[- ]?end/i.test(text)) targetRoles.push("Frontend Developer");
    if (/node|backend|back[- ]?end/i.test(text)) targetRoles.push("Backend Developer");
    if (/python/i.test(text)) targetRoles.push("Python Developer");
    if (targetRoles.length === 0) targetRoles.push("Software Developer", "Software Engineer");
    industries.push("Information Technology", "Software Development");
  } else if (isITSupport) {
    targetRoles.push("IT Support Specialist", "Network Administrator", "Systems Specialist");
    industries.push("Information Technology", "IT Infrastructure & Support");
  } else if (isTeacher) {
    targetRoles.push("Lecturer", "Academic Educator", "Curriculum Specialist");
    industries.push("Education & Academia", "Higher Education");
  } else if (isMarketing) {
    targetRoles.push("Marketing Specialist", "Digital Marketing Manager", "Growth Specialist");
    industries.push("Marketing & Advertising", "Digital Media");
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

  // 5. Skills extraction
  const medicalSkills = [
    "General Surgery", "Laparoscopic Surgery", "Trauma Care", "Patient Triage",
    "Clinical Governance", "Surgical Oncology", "Medical Education", "Emergency Care",
    "Intensive Care", "Wound Management", "Infection Control", "Pediatric Care",
    "Patient Consultation", "Diagnostics", "Electronic Health Records"
  ];
  const techSkills = [
    "JavaScript", "TypeScript", "React", "Node.js", "Express", "Python",
    "PostgreSQL", "SQL", "Git", "Docker", "REST APIs", "Linux", "AWS"
  ];
  const generalSkills = [
    "Project Management", "Team Leadership", "Operations", "Client Communication",
    "Data Analysis", "Strategic Planning", "Quality Assurance"
  ];

  const pool = isDoctor || isNurse || isPharmacist ? medicalSkills : isSoftware || isITSupport ? techSkills : generalSkills;
  const detectedSkills = pool.filter(s => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));

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

  const education = lines.filter(l =>
    !isHeaderOrSummary(l) &&
    !jobRx.test(l) &&
    /\b(?:bachelor|master|doctorate|phd|m\.b\.,?\s*b\.s|degree|diploma|university|polytechnic|school\s+certificate|wassce|waec)\b/i.test(l)
  ).map(l => l.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 5);

  const certifications = lines.filter(l =>
    !isHeaderOrSummary(l) &&
    !jobRx.test(l) &&
    !/school\s+certificate|wassce|waec/i.test(l) &&
    /\b(?:fwacs|frcs|fellow|fellowship|board\s+certified|cisco|ccna|aws|pmp|license|licence|certificate|certification|accredited)\b/i.test(l)
  ).map(l => l.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 5);

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

  let extracted: { text: string; truncated: boolean } = { text: "", truncated: false };

  // 1. If CV text is already extracted and stored in DB, use it directly!
  if (cv.extractedText && cv.extractedText.trim().length > 30) {
    extracted = { text: cv.extractedText.trim(), truncated: false };
  } else {
    // 2. Obtain file bytes from DB or disk
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

    if (!bytes) {
      res.status(422).json({
        error: "This document was uploaded to a temporary serverless container before persistent cloud storage was enabled. Please delete and re-upload your CV once to store it permanently in the cloud database.",
      });
      return;
    }

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
      req.log.error({ err: err?.message }, "Failed to extract CV text");
      res.status(422).json({ error: "The CV could not be read. Try another PDF or DOCX file." });
      return;
    }
  }

  if (!extracted.text) {
    res.status(422).json({
      error: "No selectable text was found. Scanned PDFs need OCR or a digital PDF/DOCX file.",
    });
    return;
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
