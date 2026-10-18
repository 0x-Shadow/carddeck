import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq, asc } from "drizzle-orm";
import { resolveOwnedDeck } from "@/lib/deck-access";

type Params = { params: Promise<{ id: string }> };

/** POST /api/deck/[id]/cards/reorder { order: string[] } -> 200 { cards } */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const owned = await resolveOwnedDeck(id);
  if (owned.res) return owned.res;

  const body = (await req.json().catch(() => null)) as { order?: string[] } | null;
  if (!Array.isArray(body?.order)) {
    return NextResponse.json({ error: "order array required" }, { status: 400 });
  }

  const db = getDb();
  const cards = await db.query.card.findMany({
    where: (c, { eq }) => eq(c.deckId, id),
  });
  const byId = new Map(cards.map((c) => [c.id, c]));

  // Only accept ids that belong to this deck; ignore anything else.
  const ordered = body.order.filter((cid) => byId.has(cid));
  // Any cards not mentioned in `order` keep their relative order at the end.
  const missing = cards.filter((c) => !ordered.includes(c.id)).map((c) => c.id);
  const finalOrder = [...ordered, ...missing];

  for (const [position, cid] of finalOrder.entries()) {
    await db.update(t.card).set({ position }).where(eq(t.card.id, cid));
  }

  const updated = await db.query.card.findMany({
    where: (c, { eq }) => eq(c.deckId, id),
    orderBy: (c, { asc }) => asc(c.position),
  });
  return NextResponse.json({ cards: updated }, { status: 200 });
}
