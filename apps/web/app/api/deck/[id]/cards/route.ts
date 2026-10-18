import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { resolveOwnedDeck } from "@/lib/deck-access";

type Params = { params: Promise<{ id: string }> };

/** POST /api/deck/[id]/cards { title, position? } -> 201 { card } */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const owned = await resolveOwnedDeck(id);
  if (owned.res) return owned.res;

  const body = (await req.json().catch(() => null)) as {
    title?: string;
    position?: number;
  } | null;
  const title = body?.title?.trim() || "Untitled card";

  const db = getDb();
  const existing = await db.query.card.findMany({
    where: (c, { eq }) => eq(c.deckId, id),
    orderBy: (c, { asc }) => asc(c.position),
  });

  const position =
    typeof body?.position === "number" && body.position >= 0
      ? Math.min(body.position, existing.length)
      : existing.length;

  const [card] = await db
    .insert(t.card)
    .values({ deckId: id, title, position, blocks: "[]", status: "pending" })
    .returning();

  return NextResponse.json({ card }, { status: 201 });
}
