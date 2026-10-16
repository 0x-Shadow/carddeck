import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../drizzle/schema";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export type DB = BetterSQLite3Database<typeof schema>;

// Resolve the migrations folder relative to this module (not the CWD), so it
// works whether vitest runs from the workspace root or from apps/web.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(MODULE_DIR, "../drizzle");

/**
 * Create an isolated DB for a single test run (in-memory). Runs migrations so
 * the schema exists.
 */
export function makeTestDb(): DB {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

let singleton: DB | null = null;

/** Memoized app DB, rooted at DATA_DIR (or ./data). Creates the dir if needed. */
export function getDb(): DB {
  if (singleton) return singleton;
  const dataDir = process.env.DATA_DIR ?? "./data";
  const fs = require("node:fs") as typeof import("node:fs");
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(join(dataDir, "carddeck.sqlite"));
  singleton = drizzle(sqlite, { schema });
  migrate(singleton, { migrationsFolder: MIGRATIONS_DIR });
  return singleton;
}

/** Decode a card's JSON blocks column into Block[]. */
export function blocksCodec(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
