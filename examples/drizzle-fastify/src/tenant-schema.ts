import { pgTable, text, uuid } from "drizzle-orm/pg-core";

// Schema applied to every tenant database.
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: text("body").notNull(),
});
