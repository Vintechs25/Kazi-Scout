import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
 * Retrieves the active master CV, verifies disk file presence,
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

  const filePath = findCvFilePath(masterCv.storageName);
  if (!filePath) {
    return {
      loaded: false,
      cvRecord: masterCv,
      filePath: null,
      text: "",
      charCount: 0,
      fingerprint: `missing-file:${masterCv.id}`,
      error: `Physical CV file '${masterCv.storageName}' could not be located in storage/cvs.`,
      diagnostic: {
        cvId: masterCv.id,
        fileName: masterCv.fileName,
        fileSize: masterCv.sizeBytes,
        resolvedPath: null,
        extractedSnippet: "",
      },
    };
  }

  try {
    const bytes = await readFile(filePath);
    const extracted = await extractCvText(bytes, masterCv.fileType as "pdf" | "docx");
    const rawText = (extracted.text || "").trim();

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
          fileSize: bytes.length,
          resolvedPath: filePath,
          extractedSnippet: rawText,
        },
      };
    }

    const fingerprint = createHash("sha256").update(bytes).digest("hex");

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
        fileSize: bytes.length,
        resolvedPath: filePath,
        extractedSnippet: rawText.slice(0, 300).replace(/\s+/g, " "),
      },
    };
  } catch (err: any) {
    return {
      loaded: false,
      cvRecord: masterCv,
      filePath,
      text: "",
      charCount: 0,
      fingerprint: `error:${masterCv.id}`,
      error: `Failed to extract text from CV file: ${err.message}`,
      diagnostic: {
        cvId: masterCv.id,
        fileName: masterCv.fileName,
        fileSize: masterCv.sizeBytes,
        resolvedPath: filePath,
        extractedSnippet: "",
      },
    };
  }
}
