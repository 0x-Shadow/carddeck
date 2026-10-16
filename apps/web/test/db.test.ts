import { describe, it, expect } from "vitest";
import { makeTestDb } from "../lib/db";
import * as t from "../drizzle/schema";

describe("schema", () => {
  it("round-trips a deck with cards and a theme", async () => {
    const db = makeTestDb();
    const userId = (
      await db
        .insert(t.user)
        .values({ email: "a@b.c", name: "A", passwordHash: "h" })
        .returning()
    )[0].id;
    const themeId = (
      await db
        .insert(t.theme)
        .values({ id: "midnight", name: "Midnight", isPreset: 1, tokens: JSON.stringify({}) })
        .returning()
    )[0].id;
    const deckId = (
      await db
        .insert(t.deck)
        .values({ userId, title: "T", format: "presentation", themeId, status: "draft", isPublic: 0 })
        .returning()
    )[0].id;
    await db.insert(t.card).values({
      deckId,
      position: 0,
      title: "Cover",
      blocks: JSON.stringify([{ type: "heading", level: 1, text: ["Hi"] }]),
      status: "ready",
    });
    const deck = await db.query.deck.findFirst({ where: (d, { eq }) => eq(d.id, deckId) });
    expect(deck?.title).toBe("T");
    const cards = await db.query.card.findMany({ where: (c, { eq }) => eq(c.deckId, deckId) });
    expect(JSON.parse(cards[0].blocks as unknown as string)).toHaveLength(1);
  });
});
