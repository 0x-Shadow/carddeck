import { getDb } from "./db";
import * as t from "@/drizzle/schema";
import { asc, and, eq } from "drizzle-orm";
import { rowToTheme } from "./themes-presets";

export interface PublicCard {
  id: string;
  title: string;
  blocks: string;
  position: number;
  status: string;
}

export interface PublicDeck {
  title: string;
  format: string;
  author: string | null;
  theme: ReturnType<typeof rowToTheme>;
  cards: PublicCard[];
}

/**
 * Load a deck for public consumption by share slug.
 *
 * Returns null unless the deck is both slugged *and* currently flagged public,
 * so turning sharing off revokes the link even though the slug is retained
 * (stable URLs across re-shares). Only ready cards are included — a shared
 * deck mid-generation must not leak half-built slides. The author's display
 * name only; never email or id, so a shared deck can't harvest account data.
 *
 * Shared by the public API route and the `/view/[slug]` server page so both
 * serve identical data from one implementation.
 */
export async function getPublicDeck(slug: string): Promise<PublicDeck | null> {
  const db = getDb();
  const deck = await db.query.deck.findFirst({
    where: (d, { and, eq }) => and(eq(d.shareSlug, slug), eq(d.isPublic, 1)),
  });
  if (!deck) return null;

  const [themeRow, cards, author] = await Promise.all([
    db.query.theme.findFirst({ where: (th, { eq }) => eq(th.id, deck.themeId) }),
    db.query.card.findMany({
      where: (c, { eq, and }) => and(eq(c.deckId, deck.id), eq(c.status, "ready")),
      orderBy: (c, { asc }) => asc(c.position),
    }),
    db.query.user.findFirst({
      where: (u, { eq }) => eq(u.id, deck.userId),
      columns: { name: true },
    }),
  ]);

  return {
    title: deck.title,
    format: deck.format,
    author: author?.name ?? null,
    theme: rowToTheme(themeRow),
    cards: cards.map((c) => ({
      id: c.id,
      title: c.title,
      blocks: c.blocks,
      position: c.position,
      status: c.status,
    })),
  };
}
