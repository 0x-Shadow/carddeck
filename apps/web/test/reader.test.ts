import { describe, it, expect, beforeEach } from "vitest";
import { freshDb, seedUser, seedDeck, jsonRequest, readJson } from "./helpers/route";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { PRESET_THEMES } from "@carddeck/core";

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

/**
 * Seed a deck with a share slug, an `isPublic` flag, and two ready cards.
 * Returns the owner's email so privacy assertions can check it never leaks.
 */
async function seedSharedDeck(opts: {
  isPublic: number;
  slug: string | null;
}): Promise<{ deckId: string; ownerEmail: string }> {
  const user = await seedUser();
  const db = getDb();
  const [theme] = await db
    .insert(t.theme)
    .values({
      name: "Reader Theme",
      isPreset: 0,
      tokens: JSON.stringify(PRESET_THEMES[0]),
    })
    .returning({ id: t.theme.id });

  const deckId = await seedDeck(user.id, theme.id, "Shared Deck");
  await db
    .update(t.deck)
    .set({ shareSlug: opts.slug, isPublic: opts.isPublic })
    .where(eq(t.deck.id, deckId));

  for (const [i, title] of ["Cover", "Body"].entries()) {
    await db.insert(t.card).values({
      deckId,
      position: i,
      title,
      intent: "body",
      blocks: JSON.stringify([{ type: "paragraph", text: [`p${i}`] }]),
      status: "ready",
    });
  }
  return { deckId, ownerEmail: user.email };
}

describe("GET /api/public/[slug]", () => {
  beforeEach(() => freshDb());

  it("returns title, theme, and cards for a public deck — no session needed", async () => {
    const { ownerEmail } = await seedSharedDeck({ isPublic: 1, slug: "pub-slug" });
    const { GET } = await import("@/app/api/public/[slug]/route");

    const res = await readJson(
      await GET(jsonRequest("http://t/api/public/pub-slug", "GET"), params("pub-slug")),
    );

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Shared Deck");
    expect(res.body.format).toBe("presentation");
    // The author is the display name only — never the email.
    expect(res.body.author).toBe("Tester");
    // Theme is decoded into a real object, ready for deckCssVars.
    expect(res.body.theme.colors.page).toBeTruthy();
    expect(res.body.theme.fonts.body).toBeTruthy();
    // Cards ordered by position, with the fields the reader needs.
    expect(res.body.cards.map((c: any) => c.title)).toEqual(["Cover", "Body"]);
    expect(JSON.parse(res.body.cards[0].blocks)).toEqual([
      { type: "paragraph", text: ["p0"] },
    ]);
    // Privacy: no owner email anywhere in the payload.
    expect(JSON.stringify(res.body)).not.toContain(ownerEmail);
  });

  it("404s a private deck and leaks no owner email", async () => {
    const { ownerEmail } = await seedSharedDeck({ isPublic: 0, slug: "secret" });
    const { GET } = await import("@/app/api/public/[slug]/route");

    const res = await readJson(
      await GET(jsonRequest("http://t/api/public/secret", "GET"), params("secret")),
    );

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(ownerEmail);
    expect(JSON.stringify(res.body)).not.toContain("Shared Deck");
  });

  it("404s an unknown slug", async () => {
    const { GET } = await import("@/app/api/public/[slug]/route");
    const res = await readJson(
      await GET(jsonRequest("http://t/api/public/nope", "GET"), params("nope")),
    );
    expect(res.status).toBe(404);
  });

  it("404s a deck whose slug exists but was never shared", async () => {
    await seedSharedDeck({ isPublic: 1, slug: "revoked" });
    const db = getDb();
    const deck = await db.query.deck.findFirst();
    await db
      .update(t.deck)
      .set({ isPublic: 0 })
      .where(eq(t.deck.id, deck!.id));

    const { GET } = await import("@/app/api/public/[slug]/route");
    const res = await readJson(
      await GET(jsonRequest("http://t/api/public/revoked", "GET"), params("revoked")),
    );
    expect(res.status).toBe(404);
  });
});
