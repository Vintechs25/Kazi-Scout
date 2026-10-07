import { createInsertSchema } from "drizzle-zod";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const integrationSettingsTable = sqliteTable("integration_settings", {
  provider: text("provider", { enum: ["openai", "gemini", "gmail"] }).primaryKey(),
  encryptedCredentials: text("encrypted_credentials").notNull(),
  model: text("model"),
  clientId: text("client_id"),
  status: text("status", { enum: ["CONFIGURED", "CONNECTED", "ERROR"] })
    .notNull()
    .default("CONFIGURED"),
  connectedEmail: text("connected_email"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  testedAt: integer("tested_at", { mode: "timestamp" }),
});

export const insertIntegrationSettingsSchema = createInsertSchema(integrationSettingsTable);
export type InsertIntegrationSettings = typeof integrationSettingsTable.$inferInsert;
export type IntegrationSettings = typeof integrationSettingsTable.$inferSelect;
