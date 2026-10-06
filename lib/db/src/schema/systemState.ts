import { createInsertSchema } from "drizzle-zod";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const systemStateTable = sqliteTable("system_state", {
  id: text("id").primaryKey().$defaultFn(() => "agent"),
  agentState: text("agent_state", { enum: ["STOPPED", "STARTING", "RUNNING", "PAUSED", "ERROR"] }).notNull().default("STOPPED"),
  agentMessage: text("agent_message").notNull().default("Agent is stopped. No automated actions are running."),
  applicationMode: text("application_mode", { enum: ["manual", "approval", "automatic"] }).notNull().default("approval"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const insertSystemStateSchema = createInsertSchema(systemStateTable);
export type InsertSystemState = typeof systemStateTable.$inferInsert;
export type SystemState = typeof systemStateTable.$inferSelect;
