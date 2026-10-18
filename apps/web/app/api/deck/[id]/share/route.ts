import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { resolveOwnedDeck } from "@/lib/deck-access";
import { randomBytes } from "node:crypto";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/deck/[id]/share { isPublic } -> 200 { isPublic, shareSlug }
 *
 * Toggling on mints a share slug if the deck doesn't have one yet; toggling off
 * keeps the existing slug so re-sharing the same deck keeps a stable URL.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const owned = await resolveOwnedDeck(id);
  if (owned.res) return owned.res;

  const body = (await req.json().catch(() => null)) as { isPublic?: boolean } | null;
  if (typeof body?.isPublic !== "boolean") {
    return NextResponse.json({ error: "isPublic must be a boolean" }, { status: 400 });
  }

  const db = getDb();
  const shareSlug = owned.deck.shareSlug ?? randomBytes(8).toString("hex");

  const [deck] = await db
    .update(t.deck)
    .set({ isPublic: body.isPublic ? 1 : 0, shareSlug, updatedAt: Date.now() })
    .where(eq(t.deck.id, id))
    .returning();

  return NextResponse.json(
    { isPublic: deck.isPublic === 1, shareSlug: deck.shareSlug },
    { status: 200 },
  );
}
