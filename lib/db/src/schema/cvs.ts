import { createInsertSchema } from "drizzle-zod";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const cvsTable = sqliteTable("cvs", {
  id: text("id").primaryKey(),
  accountId: text("account_id"),
  fileName: text("file_name").notNull(),
  storageName: text("storage_name").notNull().unique(),
  fileType: text("file_type", { enum: ["pdf", "docx"] }).notNull(),
  category: text("category").notNull().default("cv"),
  title: text("title"),
  sizeBytes: integer("size_bytes").notNull(),
  isMaster: integer("is_master", { mode: "boolean" }).notNull().default(false),
  uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull(),
});

export const insertCvSchema = createInsertSchema(cvsTable);
export type InsertCv = typeof cvsTable.$inferInsert;
export type CvRecord = typeof cvsTable.$inferSelect;
