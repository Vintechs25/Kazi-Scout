import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";

export const activityTable = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    message: text("message").notNull(),
    kind: text("kind").notNull(),
    accountId: text("account_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("activity_created_at_idx").on(table.createdAt),
    index("activity_account_id_idx").on(table.accountId),
  ],
);

export const insertActivitySchema = createInsertSchema(activityTable);
export type InsertActivity = typeof activityTable.$inferInsert;
export type Activity = typeof activityTable.$inferSelect;
