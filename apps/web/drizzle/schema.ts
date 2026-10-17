import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { randomUUID } from "node:crypto";

/**
 * Drizzle schema for Carddeck. All timestamps are unix epoch millis. JSON
 * columns are stored as TEXT and decoded at the edge via codecs in lib/db.ts.
 * Ids default to a random UUID and timestamps to now, so inserts may omit them.
 */

const now = () => Date.now();

export type User = typeof user.$inferSelect;

export const user = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(now),
});

export const theme = sqliteTable("theme", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  isPreset: integer("is_preset").notNull().default(0),
  /** JSON string of the full Theme token object. */
  tokens: text("tokens").notNull(),
});

export const deck = sqliteTable("deck", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  title: text("title").notNull(),
  format: text("format").notNull(), // "presentation" | "document"
  themeId: text("theme_id")
    .notNull()
    .references(() => theme.id),
  status: text("status").notNull(), // "draft" | "outline" | "generating" | "ready" | "error"
  isPublic: integer("is_public").notNull().default(0),
  shareSlug: text("share_slug"),
  /** JSON MotionPlan | null — how the deck animates (web present + PPTX). */
  motion: text("motion"),
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(now),
  updatedAt: integer("updated_at")
    .notNull()
    .$defaultFn(now),
});

/**
 * An uploaded image for a deck. Bytes live on disk under
 * `DATA_DIR/assets/<deckId>/<id>.<ext>`; this row is the index + access
 * record. Deleting a deck cascades to its assets.
 */
export const asset = sqliteTable("asset", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  deckId: text("deck_id")
    .notNull()
    .references(() => deck.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  originalName: text("original_name"),
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(now),
});

export const card = sqliteTable("card", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  deckId: text("deck_id")
    .notNull()
    .references(() => deck.id),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  /** The outline's intent for this card: "cover" | "body" | "close" | free text. */
  intent: text("intent").notNull().default("body"),
  /** JSON string of Block[]. */
  blocks: text("blocks").notNull().default("[]"),
  status: text("status").notNull().default("pending"), // "pending" | "ready" | "error"
  genJobId: text("gen_job_id"),
});

export const generationJob = sqliteTable("generation_job", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  deckId: text("deck_id")
    .notNull()
    .references(() => deck.id),
  stage: text("stage").notNull(), // "outline" | "cards"
  status: text("status").notNull(), // "pending" | "running" | "done" | "error" | "cancelled"
  /** JSON string of the stage input. */
  input: text("input").notNull().default("{}"),
  /** JSON string of the stage result. */
  result: text("result"),
  error: text("error"),
  /** JSON string { done, total }. */
  progress: text("progress"),
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(now),
  updatedAt: integer("updated_at")
    .notNull()
    .$defaultFn(now),
});

export const chatMessage = sqliteTable("chat_message", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  deckId: text("deck_id")
    .notNull()
    .references(() => deck.id),
  cardId: text("card_id"),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(now),
});
