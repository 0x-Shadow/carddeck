import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { resolveOwnedDeck } from "@/lib/deck-access";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/deck/[id]/theme { themeId } -> 200 { deck } */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const owned = await resolveOwnedDeck(id);
  if (owned.res) return owned.res;

  const body = (await req.json().catch(() => null)) as { themeId?: string } | null;
  if (!body?.themeId) {
    return NextResponse.json({ error: "themeId required" }, { status: 400 });
  }

  const db = getDb();
  const theme = await db.query.theme.findFirst({
    where: (th, { eq }) => eq(th.id, body.themeId!),
  });
  if (!theme) {
    return NextResponse.json({ error: "unknown theme" }, { status: 404 });
  }

  const [deck] = await db
    .update(t.deck)
    .set({ themeId: body.themeId, updatedAt: Date.now() })
    .where(eq(t.deck.id, id))
    .returning();

  return NextResponse.json({ deck }, { status: 200 });
}
