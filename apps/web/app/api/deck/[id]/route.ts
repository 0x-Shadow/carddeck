import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq, asc } from "drizzle-orm";
import { resolveOwnedDeck } from "@/lib/deck-access";

type Params = { params: Promise<{ id: string }> };

/** GET /api/deck/[id] -> 200 { deck, cards } */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const owned = await resolveOwnedDeck(id);
  if (owned.res) return owned.res;

  const db = getDb();
  const cards = await db.query.card.findMany({
    where: (c, { eq }) => eq(c.deckId, id),
    orderBy: (c, { asc }) => asc(c.position),
  });
  return NextResponse.json({ deck: owned.deck, cards }, { status: 200 });
}

/** PATCH /api/deck/[id] { title?, themeId?, status? } -> 200 { deck } */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const owned = await resolveOwnedDeck(id);
  if (owned.res) return owned.res;

  const body = (await req.json().catch(() => null)) as {
    title?: string;
    themeId?: string;
    status?: string;
  } | null;

  const patch: Partial<typeof t.deck.$inferInsert> = { updatedAt: Date.now() };
  if (typeof body?.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body?.themeId === "string") patch.themeId = body.themeId;
  if (typeof body?.status === "string") patch.status = body.status;

  const db = getDb();
  const [deck] = await db.update(t.deck).set(patch).where(eq(t.deck.id, id)).returning();
  return NextResponse.json({ deck }, { status: 200 });
}

/** DELETE /api/deck/[id] -> 204 */
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const owned = await resolveOwnedDeck(id);
  if (owned.res) return owned.res;

  const db = getDb();
  // Remove cards first (no cascade configured), then the deck.
  await db.delete(t.card).where(eq(t.card.deckId, id));
  await db.delete(t.generationJob).where(eq(t.generationJob.deckId, id));
  await db.delete(t.chatMessage).where(eq(t.chatMessage.deckId, id));
  await db.delete(t.deck).where(eq(t.deck.id, id));
  return new NextResponse(null, { status: 204 });
}
