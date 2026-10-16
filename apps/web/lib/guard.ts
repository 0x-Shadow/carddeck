import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "./db";
import * as schema from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE, verifySessionToken } from "./auth";
import type { User } from "../drizzle/schema";

/**
 * Read the session cookie and resolve the current user, or null. Used by every
 * owner-gated route.
 */
export async function getSession(): Promise<{ userId: string } | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return verifySessionToken(raw);
}

/** The shape returned by `currentUser` (a user row or null). */
type CurrentUser = User | null;

/** Resolve the full user row for the current session, or null. */
export async function currentUser(): Promise<CurrentUser> {
  const session = await getSession();
  if (!session) return null;
  const db = getDb();
  const user = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, session.userId),
  });
  return user ?? null;
}

/** Result of `requireUser`: either an authenticated user or a 401 response. */
type RequireUserResult =
  | { user: User; res?: undefined }
  | { user?: undefined; res: NextResponse };

/**
 * Guard helper for owner-gated handlers. Returns the user on success, else a
 * 401 NextResponse the caller should return early.
 */
export async function requireUser(): Promise<RequireUserResult> {
  const user = await currentUser();
  if (!user) {
    return { res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { user };
}

export { schema as t, eq };
