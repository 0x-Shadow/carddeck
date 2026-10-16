import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../drizzle/schema";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import fs from "node:fs";

export type DB = BetterSQLite3Database<typeof schema>;

// Resolve the migrations folder relative to this module (not the CWD), so it
// works whether vitest runs from the workspace root or from apps/web.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(MODULE_DIR, "../drizzle");

// apps/web/lib -> repo root. Everything that resolves a path does it against
// this, never process.cwd(): `next dev` runs with CWD=apps/web while the
// worker runs with CWD=apps/worker, and both must open the SAME SQLite file.
export const REPO_ROOT = resolve(MODULE_DIR, "../../..");

/**
 * Resolve the data directory from the environment.
 *
 * Relative `DATA_DIR` values are anchored to the repo root so every process in
 * the monorepo (web, worker, e2e) agrees on one location no matter where it was
 * launched from. An absolute value is used verbatim.
 */
export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot: string = REPO_ROOT,
): string {
  const raw = env.DATA_DIR;
  if (!raw) return join(repoRoot, "data");
  return resolve(repoRoot, raw);
}

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
let override: DB | null = null;

/**
 * Point `getDb()` at a specific DB. Tests use this to isolate each suite on an
 * in-memory database. Pass null to clear the override.
 */
export function setTestDb(db: DB | null): void {
  override = db;
}

/** Memoized app DB, rooted at DATA_DIR (repo-root anchored). Creates the dir if needed. */
export function getDb(): DB {
  if (override) return override;
  if (singleton) return singleton;
  const dataDir = resolveDataDir();
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
