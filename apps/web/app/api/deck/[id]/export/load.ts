import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { and, asc, eq } from "drizzle-orm";
import { resolveOwnedDeck } from "@/lib/deck-access";
import { rowToTheme } from "@/lib/themes-presets";
import { PRESET_THEMES, type Block, type Theme } from "@carddeck/core";

export interface ExportableDeck {
  id: string;
  title: string;
  /** "presentation" | "document" — selects the PDF page geometry. */
  format: string;
  theme: Theme;
  cards: Array<{ id: string; title: string; blocks: Block[]; position: number }>;
}

/**
 * Load a deck for export.
 *
 * Export is allowed when the deck is public (share link holders can download
 * it) OR the caller owns it. Private decks require an authenticated owner, so
 * a non-owner gets the same 404 as a missing deck — existence stays hidden.
 * Only ready cards export; a deck still generating must not leak half-built
 * slides.
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

  const [cards, themeRow] = await Promise.all([
    db.query.card.findMany({
      where: (c, { and, eq }) => and(eq(c.deckId, id), eq(c.status, "ready")),
      orderBy: (c, { asc }) => asc(c.position),
    }),
    db.query.theme.findFirst({ where: (th, { eq }) => eq(th.id, deck.themeId) }),
  ]);

  return {
    data: {
      id: deck.id,
      title: deck.title,
      format: deck.format,
      theme: rowToTheme(themeRow) ?? PRESET_THEMES[0],
      cards: cards.map((c) => ({
        id: c.id,
        title: c.title,
        blocks: parseBlocks(c.blocks),
        position: c.position,
      })),
    },
  };
}

/** Filesystem/content-type-safe download name. */
export function exportFilename(title: string, ext: string): string {
  const clean = title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
  return `${clean || "deck"}.${ext}`;
}

/** Parse a card's stored blocks JSON; tolerate null/corrupt rows. */
function parseBlocks(raw: string): Block[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Block[]) : [];
  } catch {
    return [];
  }
}
