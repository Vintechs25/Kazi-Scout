import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { db, cvsTable, type CvRecord } from "@workspace/db";
import { eq } from "drizzle-orm";
import { extractCvText } from "./cv-text-extraction";

export interface MasterCvDossier {
  loaded: boolean;
  cvRecord: CvRecord | null;
  filePath: string | null;
  text: string;
  charCount: number;
  fingerprint: string;
  error?: string;
  diagnostic: {
    cvId: string | null;
    fileName: string | null;
    fileSize: number;
    resolvedPath: string | null;
    extractedSnippet: string;
  };
}

/**
 * Resolves the candidate CV storage directory across workspace root and package cwd
 */
export function getCvStorageCandidateDirs(): string[] {
  const custom = process.env.CV_STORAGE_PATH;
  if (custom) {
    if (path.isAbsolute(custom)) return [custom];
    return [
      path.resolve(process.cwd(), custom),
      path.resolve(process.cwd(), "..", custom),
      path.resolve(process.cwd(), "../..", custom),
    ];
  }
  if (process.env.VERCEL) {
    return ["/tmp/cvs"];
  }
  return [
    path.resolve(process.cwd(), "storage/cvs"),
    path.resolve(process.cwd(), "../storage/cvs"),
    path.resolve(process.cwd(), "../../storage/cvs"),
  ];
}

/**
 * Locates the physical file for a given storage name on disk
 */
export function findCvFilePath(storageName: string): string | null {
  const candidates = getCvStorageCandidateDirs();
  for (const dir of candidates) {
    const full = path.resolve(dir, path.basename(storageName));
    if (existsSync(full)) {
      return full;
    }
  }
  return null;
}

/**
 * Retrieves the active master CV, verifies disk file or cloud DB presence,
 * extracts text, and computes a cryptographic SHA-256 fingerprint.
 */
export async function getVerifiedMasterCv(): Promise<MasterCvDossier> {
  const [masterCv] = await db
    .select()
    .from(cvsTable)
    .where(eq(cvsTable.isMaster, true))
    .limit(1);

  if (!masterCv) {
    return {
      loaded: false,
      cvRecord: null,
      filePath: null,
      text: "",
      charCount: 0,
      fingerprint: "no-master-cv",
      error: "No CV is marked as master in the Document Vault.",
      diagnostic: {
        cvId: null,
        fileName: null,
        fileSize: 0,
        resolvedPath: null,
        extractedSnippet: "",
      },
    };
  }

  let bytes: Buffer | null = null;
  let filePath = findCvFilePath(masterCv.storageName);

  if (filePath && existsSync(filePath)) {
    try {
      bytes = await readFile(filePath);
    } catch {
      bytes = null;
    }
  }

  // If missing on disk (e.g. serverless cold start), rehydrate from DB fileData
  if (!bytes && masterCv.fileData) {
    try {
      bytes = Buffer.from(masterCv.fileData, "base64");
      const candidateDirs = getCvStorageCandidateDirs();
      const cacheDir = candidateDirs[0];
      if (cacheDir) {
        await mkdir(cacheDir, { recursive: true }).catch(() => {});
        const cachePath = path.resolve(cacheDir, path.basename(masterCv.storageName));
        await writeFile(cachePath, bytes).catch(() => {});
        filePath = cachePath;
      }
    } catch {
      bytes = null;
    }
  }

  // Use previously extracted text from DB if available
  let rawText = (masterCv.extractedText || "").trim();
  if (!rawText && bytes) {
    try {
      const extracted = await extractCvText(bytes, masterCv.fileType as "pdf" | "docx");
      rawText = (extracted.text || "").trim();
      if (rawText) {
        await db.update(cvsTable).set({ extractedText: rawText }).where(eq(cvsTable.id, masterCv.id)).catch(() => {});
      }
    } catch (err: any) {
      console.warn("[CvStorage] Text extraction error:", err?.message);
    }
  }

  if (!bytes && !rawText) {
    return {
      loaded: false,
      cvRecord: masterCv,
      filePath: null,
      text: "",
      charCount: 0,
      fingerprint: `missing-file:${masterCv.id}`,
      error: `Physical CV file '${masterCv.storageName}' could not be located in storage/cvs or cloud database.`,
      diagnostic: {
        cvId: masterCv.id,
        fileName: masterCv.fileName,
        fileSize: masterCv.sizeBytes,
        resolvedPath: null,
        extractedSnippet: "",
      },
    };
  }

  if (rawText.length < 50) {
    return {
      loaded: false,
      cvRecord: masterCv,
      filePath,
      text: "",
      charCount: rawText.length,
      fingerprint: `empty-text:${masterCv.id}`,
      error: "Extracted CV text is empty or too short (< 50 characters).",
      diagnostic: {
        cvId: masterCv.id,
        fileName: masterCv.fileName,
        fileSize: bytes ? bytes.length : masterCv.sizeBytes,
        resolvedPath: filePath,
        extractedSnippet: rawText,
      },
    };
  }

  const fingerprint = bytes
    ? createHash("sha256").update(bytes).digest("hex")
    : createHash("sha256").update(rawText).digest("hex");

  return {
    loaded: true,
    cvRecord: masterCv,
    filePath,
    text: rawText,
    charCount: rawText.length,
    fingerprint,
    diagnostic: {
      cvId: masterCv.id,
      fileName: masterCv.fileName,
      fileSize: bytes ? bytes.length : masterCv.sizeBytes,
      resolvedPath: filePath,
      extractedSnippet: rawText.slice(0, 300).replace(/\s+/g, " "),
    },
  };
}
