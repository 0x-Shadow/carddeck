import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq, asc } from "drizzle-orm";
import { resolveOwnedDeck } from "@/lib/deck-access";
import { rowToTheme } from "@/lib/themes-presets";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/deck/[id] -> 200 { deck, cards, theme }
 *
 * `theme` is the decoded deck theme (preset or custom) so the editor, present
 * mode, reader, and exporters all skin from one source instead of re-deriving
 * it client-side.
 */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const owned = await resolveOwnedDeck(id);
  if (owned.res) return owned.res;

  const db = getDb();
  const [cards, themeRow] = await Promise.all([
    db.query.card.findMany({
      where: (c, { eq }) => eq(c.deckId, id),
      orderBy: (c, { asc }) => asc(c.position),
    }),
    db.query.theme.findFirst({ where: (th, { eq }) => eq(th.id, owned.deck.themeId) }),
  ]);
  return NextResponse.json(
    { deck: owned.deck, cards, theme: rowToTheme(themeRow) },
    { status: 200 },
  );
}

/** Deck lifecycle states the API will accept (mirrors the stage machine). */
const DECK_STATUSES = new Set(["draft", "outline", "generating", "ready", "error"]);

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

  const db = getDb();
  const patch: Partial<typeof t.deck.$inferInsert> = { updatedAt: Date.now() };
  if (typeof body?.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body?.themeId === "string") {
    // An unknown theme id would silently unstyle the deck and its public
    // reader (deckCssVars falls back to nothing) — accept only real themes.
    const themeRow = await db.query.theme.findFirst({
      where: (th, { eq }) => eq(th.id, body.themeId as string),
    });
    if (!themeRow) return NextResponse.json({ error: "unknown themeId" }, { status: 400 });
    patch.themeId = body.themeId;
  }
  if (typeof body?.status === "string") {
    // Status is normally the worker's to move; a whitelist keeps hand-rolled
    // PATCHes out of states the stage machine never produces.
    if (!DECK_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "unknown status" }, { status: 400 });
    }
    patch.status = body.status;
  }

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
