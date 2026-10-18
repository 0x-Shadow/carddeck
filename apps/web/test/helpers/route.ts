import { vi } from "vitest";
import { randomUUID } from "node:crypto";
import { makeTestDb, setTestDb, getDb, type DB } from "@/lib/db";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import * as t from "@/drizzle/schema";

/**
 * Test harness for Next.js route handlers.
 *
 * A shared cookie jar is created with `vi.hoisted` so the `next/headers` mock
 * factory below can close over it (vitest moves mock factories to module scope,
 * so a plain local would be out of reach). Each test calls `freshDb()` to get a
 * clean in-memory database wired into `getDb()`, then `useSession(userId)` to
 * authenticate. Route modules are imported dynamically AFTER those calls so the
 * mock is registered before any handler reads `cookies()`.
 */

const jar = vi.hoisted(
  () => new Map<string, { name: string; value: string }>(),
);

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => jar.get(name),
    set: (name: string, value: string) => jar.set(name, { name, value }),
  }),
}));

export interface TestUser {
  id: string;
  email: string;
}

/** Install a clean in-memory DB as the app DB. Call once at the start of a test. */
export function freshDb(): DB {
  const db = makeTestDb();
  setTestDb(db);
  jar.clear();
  return db;
}

/**
 * Point the mocked cookie jar at a signed session for `userId` (or clear it
 * when null), so `requireUser()` sees the caller as authenticated.
 */
export function useSession(userId: string | null): void {
  jar.clear();
  if (userId) jar.set(SESSION_COOKIE, { name: SESSION_COOKIE, value: createSessionToken(userId) });
}

/** Seed a user directly (bypassing the register route) and return their row. */
export async function seedUser(email = `u-${randomUUID()}@t.io`): Promise<TestUser> {
  const db = getDb();
  const [row] = await db
    .insert(t.user)
    .values({ email, name: "Tester", passwordHash: "x" })
    .returning({ id: t.user.id, email: t.user.email });
  return row;
}

/** Seed a theme row on the current DB and return its id. */
export async function seedTheme(name = "Midnight"): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(t.theme)
    .values({ name, isPreset: 1, tokens: "{}" })
    .returning({ id: t.theme.id });
  return row.id;
}

/** Seed a deck owned by `userId` on the current DB and return its id. */
export async function seedDeck(
  userId: string,
  themeId: string,
  title = "Deck",
): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(t.deck)
    .values({ userId, title, format: "presentation", themeId, status: "draft" })
    .returning({ id: t.deck.id });
  return row.id;
}

/** Build a JSON Request for a route handler. */
export function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Extract the JSON body + status from a route handler Response. */
export async function readJson(res: Response): Promise<{ status: number; body: any }> {
  return { status: res.status, body: await res.json().catch(() => null) };
}
