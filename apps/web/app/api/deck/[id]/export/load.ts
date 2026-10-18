import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { resolveOwnedDeck } from "@/lib/deck-access";
import { loadSlideInputs, type ExportDeckData } from "@/lib/export-slides";

export type ExportableDeck = ExportDeckData;

/**
 * Load a deck for export.
 *
 * Export is allowed when the deck is public (share link holders can download
 * it) OR the caller owns it. Private decks require an authenticated owner, so
 * a non-owner gets the same 404 as a missing deck — existence stays hidden.
 * Only ready cards export; a deck still generating must not leak half-built
 * slides. The deck data itself comes from the shared loader (`lib/
 * export-slides.ts`), so the HTTP routes and the MCP agent cannot drift.
 */
export async function loadExportableDeck(
  id: string,
): Promise<
  | { data: ExportableDeck; res?: undefined }
  | { data?: undefined; res: NextResponse }
> {
  const db = getDb();
  const deck = await db.query.deck.findFirst({ where: (d, { eq }) => eq(d.id, id) });
  if (!deck) {
    return { res: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }

  if (deck.isPublic !== 1) {
    const owned = await resolveOwnedDeck(id);
    if (owned.res) return { res: owned.res };
  }

  const data = await loadSlideInputs(id);
  if (!data) {
    return { res: NextResponse.json({ error: "not found" }, { status: 404 }) };
  }
  return { data };
}

/** Filesystem/content-type-safe download name. */
export function exportFilename(title: string, ext: string): string {
  const clean = title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
  return `${clean || "deck"}.${ext}`;
}
