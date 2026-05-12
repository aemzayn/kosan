/**
 * Copy-paste schema snippets for the tenants table in popular Drizzle dialects.
 *
 * You only need one of these — pick the one that matches your master database.
 */

export const TENANT_DRIZZLE_SCHEMA_PG = `
import { pgTable, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id:        text('id').primaryKey(),
  slug:      text('slug').notNull().unique(),
  host:      text('host').notNull(),
  port:      integer('port').notNull(),
  dbName:    text('db_name').notNull(),
  user:      text('user').notNull(),
  password:  text('password').notNull(),
  status:    text('status', { enum: ['active', 'suspended', 'deleted'] })
               .notNull()
               .default('active'),
  meta:      jsonb('meta'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
`.trim();

export const TENANT_DRIZZLE_SCHEMA_SQLITE = `
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const tenants = sqliteTable('tenants', {
  id:        text('id').primaryKey(),
  slug:      text('slug').notNull().unique(),
  host:      text('host').notNull(),
  port:      integer('port').notNull(),
  dbName:    text('db_name').notNull(),
  user:      text('user').notNull(),
  password:  text('password').notNull(),
  status:    text('status', { enum: ['active', 'suspended', 'deleted'] })
               .notNull()
               .default('active'),
  meta:      text('meta', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
`.trim();

export const TENANT_DRIZZLE_SCHEMA_MYSQL = `
import { mysqlTable, varchar, int, timestamp, json } from 'drizzle-orm/mysql-core';

export const tenants = mysqlTable('tenants', {
  id:        varchar('id', { length: 36 }).primaryKey(),
  slug:      varchar('slug', { length: 255 }).notNull().unique(),
  host:      varchar('host', { length: 255 }).notNull(),
  port:      int('port').notNull(),
  dbName:    varchar('db_name', { length: 255 }).notNull(),
  user:      varchar('user', { length: 255 }).notNull(),
  password:  varchar('password', { length: 255 }).notNull(),
  status:    varchar('status', { length: 20 }).notNull().default('active'),
  meta:      json('meta'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
`.trim();
