import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Schema for the master database — holds one row per tenant.
// Mirrors the TENANT_DRIZZLE_SCHEMA_PG template from @kosan/drizzle.
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  dbName: text("db_name").notNull(),
  user: text("user").notNull(),
  password: text("password").notNull(),
  status: text("status", { enum: ["active", "suspended", "deleted"] })
    .notNull()
    .default("active"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
