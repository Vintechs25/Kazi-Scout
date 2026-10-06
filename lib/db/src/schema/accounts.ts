import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";

export const accountsTable = sqliteTable("accounts", {
  id: text("id").primaryKey().$defaultFn(() => "local"),
  passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const insertAccountSchema = createInsertSchema(accountsTable).omit({ createdAt: true });
export type InsertAccount = typeof accountsTable.$inferInsert;
export type Account = typeof accountsTable.$inferSelect;
