import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  DeleteCvParams,
  ListCvsResponse,
  UploadCvResponse,
} from "@workspace/api-zod";
import { cvsTable, db } from "@workspace/db";

const router: IRouter = Router();
const projectRoot = path.resolve(process.cwd(), "../..");
const storageDir = path.resolve(projectRoot, process.env.CV_STORAGE_PATH ?? "storage/cvs");
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
    if (extension !== ".pdf" && extension !== ".docx") {
      callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
      return;
    }
    callback(null, true);
  },
});

router.get("/cvs", async (_req, res): Promise<void> => {
  const records = await db.select().from(cvsTable).orderBy(desc(cvsTable.uploadedAt));
  res.json(
    ListCvsResponse.parse(
      records.map((record) => ({
        id: record.id,
        fileName: record.fileName,
        fileType: record.fileType,
        sizeBytes: record.sizeBytes,
        isMaster: record.isMaster,
        uploadedAt: record.uploadedAt.toISOString(),
      })),
    ),
  );
});

router.post("/cvs", upload.single("file"), async (req, res): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Choose a PDF or DOCX file to upload." });
    return;
  }
  const fileType = path.extname(file.originalname).toLowerCase().slice(1);
  const bytes = await readFile(file.path);
  const validSignature =
    (fileType === "pdf" && bytes.subarray(0, 5).toString("ascii") === "%PDF-") ||
    (fileType === "docx" &&
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04 &&
      bytes.includes(Buffer.from("[Content_Types].xml")) &&
      bytes.includes(Buffer.from("word/document.xml")));
  if (!validSignature) {
    await unlink(file.path);
    res.status(400).json({ error: "The file content does not match its PDF or DOCX extension." });
    return;
  }

  const [existingMaster] = await db
    .select({ id: cvsTable.id })
    .from(cvsTable)
    .where(eq(cvsTable.isMaster, true))
    .limit(1);
  const requestedMaster = req.body?.isMaster === "true" || req.body?.isMaster === "1";
  const isMaster = requestedMaster || !existingMaster;
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
      fileType: fileType as "pdf" | "docx",
      sizeBytes: file.size,
      isMaster,
      uploadedAt: new Date(),
    })
    .returning();

  res.status(201).json(
    UploadCvResponse.parse({
      id: record.id,
      fileName: record.fileName,
      fileType: record.fileType,
      sizeBytes: record.sizeBytes,
      isMaster: record.isMaster,
      uploadedAt: record.uploadedAt.toISOString(),
    }),
  );
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

export default router;
