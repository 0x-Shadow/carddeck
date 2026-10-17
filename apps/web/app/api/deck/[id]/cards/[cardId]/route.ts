import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { resolveOwnedDeck } from "@/lib/deck-access";
import { validateBlocks } from "@carddeck/ai";

type Params = { params: Promise<{ id: string; cardId: string }> };

/** Card lifecycle states the API will accept (mirrors the pipeline's). */
const CARD_STATUSES = new Set(["pending", "ready", "error"]);

/**
 * Load a card only if it belongs to a deck the current user owns.
 * Returns either the card, or a ready NextResponse (401/404).
 */
async function resolveOwnedCard(deckId: string, cardId: string): Promise<
  | { card: typeof t.card.$inferSelect; res?: undefined }
  | { card?: undefined; res: NextResponse }
> {
  const owned = await resolveOwnedDeck(deckId);
  if (owned.res) return { res: owned.res };

  const db = getDb();
  const card = await db.query.card.findFirst({
    where: (c, { and, eq }) => and(eq(c.id, cardId), eq(c.deckId, deckId)),
  });
  if (!card) {
    return { res: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  return { card };
}

/** PATCH /api/deck/[id]/cards/[cardId] { title?, blocks?, status? } -> 200 { card } */
export async function PATCH(req: Request, { params }: Params) {
  const { id, cardId } = await params;
  const owned = await resolveOwnedCard(id, cardId);
  if (owned.res) return owned.res;

  const body = (await req.json().catch(() => null)) as {
    title?: string;
    blocks?: unknown;
    status?: string;
  } | null;

  const patch: Partial<typeof t.card.$inferInsert> = {};
  if (typeof body?.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (body?.blocks !== undefined) {
    // Blocks render on the public reader too: apply the same schema the model
    // output must satisfy (coercing salvageable payloads, rejecting the rest)
    // so a hand-crafted PATCH can never white-screen viewers.
    try {
      patch.blocks = JSON.stringify(validateBlocks(body.blocks));
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "invalid blocks" },
        { status: 400 },
      );
    }
  }
  if (typeof body?.status === "string") {
    if (!CARD_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "unknown status" }, { status: 400 });
    }
    patch.status = body.status;
  }

  const db = getDb();
  const [card] = await db.update(t.card).set(patch).where(eq(t.card.id, cardId)).returning();
  return NextResponse.json({ card }, { status: 200 });
}

/** DELETE /api/deck/[id]/cards/[cardId] -> 204 */
export async function DELETE(_req: Request, { params }: Params) {
  const { id, cardId } = await params;
  const owned = await resolveOwnedCard(id, cardId);
  if (owned.res) return owned.res;

  const db = getDb();
  await db.delete(t.card).where(and(eq(t.card.id, cardId), eq(t.card.deckId, id)));
  return new NextResponse(null, { status: 204 });
}
