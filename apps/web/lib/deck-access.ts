import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { requireUser } from "@/lib/guard";

/**
 * Resolve a deck the current user owns.
 *
 * Returns either `{ deck }` on success, or `{ res }` with a ready-to-return
 * NextResponse (401 when unauthenticated, 404 when the deck is missing or owned
 * by someone else). Handlers early-return `res` so every owner-gated route gets
 * identical auth + ownership semantics.
 */
export async function resolveOwnedDeck(deckId: string): Promise<
  | { deck: typeof t.deck.$inferSelect; res?: undefined }
  | { deck?: undefined; res: NextResponse }
> {
  const auth = await requireUser();
  if (auth.res) return { res: auth.res };

  const db = getDb();
  const deck = await db.query.deck.findFirst({
    where: (d, { and, eq }) => and(eq(d.id, deckId), eq(d.userId, auth.user.id)),
  });
  if (!deck) {
    return { res: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  return { deck };
}

export { t, eq, and };
