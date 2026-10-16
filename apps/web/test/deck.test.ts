import { describe, it, expect } from "vitest";
import {
  freshDb,
  seedUser,
  seedTheme,
  seedDeck,
  useSession,
  jsonRequest,
  readJson,
} from "./helpers/route";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";

// The handlers read cookies() at call time, so we import them dynamically after
// seeding + installing the session mock in each test.

describe("deck + card REST", () => {
  it("POST /api/deck requires auth (401 without session)", async () => {
    freshDb();
    useSession(null);
    const { POST } = await import("@/app/api/deck/route");
    const res = await POST(jsonRequest("http://t/api/deck", "POST", { title: "X" }));
    expect(res.status).toBe(401);
  });

  it("POST /api/deck creates a deck with the requested title + theme", async () => {
    freshDb();
    const user = await seedUser();
    const themeId = await seedTheme();
    useSession(user.id);
    const { POST } = await import("@/app/api/deck/route");
    const res = await POST(
      jsonRequest("http://t/api/deck", "POST", { title: "My Deck", themeId, format: "presentation" }),
    );
    const { status, body } = await readJson(res);
    expect(status).toBe(201);
    expect(body.deck.title).toBe("My Deck");
    expect(body.deck.themeId).toBe(themeId);
  });

  it("GET /api/deck lists only the current user's decks", async () => {
    freshDb();
    const me = await seedUser();
    const other = await seedUser();
    const themeId = await seedTheme();
    const mineId = await seedDeck(me.id, themeId, "Mine");
    await seedDeck(other.id, themeId, "Theirs");
    useSession(me.id);
    const { GET } = await import("@/app/api/deck/route");
    const { status, body } = await readJson(await GET());
    expect(status).toBe(200);
    const titles = body.decks.map((d: any) => d.title);
    expect(titles).toContain("Mine");
    expect(titles).not.toContain("Theirs");
  });

  it("GET /api/deck/[id] 404s for a deck the user does not own", async () => {
    freshDb();
    const me = await seedUser();
    const other = await seedUser();
    const themeId = await seedTheme();
    const otherDeck = await seedDeck(other.id, themeId, "Theirs");
    useSession(me.id);
    const { GET } = await import("@/app/api/deck/[id]/route");
    const { status } = await readJson(await GET(jsonRequest(`http://t/api/deck/${otherDeck}`, "GET"), { params: Promise.resolve({ id: otherDeck }) }));
    expect(status).toBe(404);
  });

  it("POST /api/deck/[id]/cards adds a card at a position and PATCH reorders", async () => {
    freshDb();
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);

    const cards = await import("@/app/api/deck/[id]/cards/route");
    const add1 = await readJson(
      await cards.POST(
        jsonRequest(`http://t/api/deck/${deckId}/cards`, "POST", { title: "C1", position: 0 }),
        { params: Promise.resolve({ id: deckId }) },
      ),
    );
    expect(add1.status).toBe(201);
    const c1 = add1.body.card.id;

    const add2 = await readJson(
      await cards.POST(
        jsonRequest(`http://t/api/deck/${deckId}/cards`, "POST", { title: "C2", position: 1 }),
        { params: Promise.resolve({ id: deckId }) },
      ),
    );
    const c2 = add2.body.card.id;

    // Reorder: swap so C2 is first.
    const reorderRoute = await import("@/app/api/deck/[id]/cards/reorder/route");
    const reorder = await readJson(
      await reorderRoute.POST(
        jsonRequest(`http://t/api/deck/${deckId}/cards/reorder`, "POST", { order: [c2, c1] }),
        { params: Promise.resolve({ id: deckId }) },
      ),
    );
    expect(reorder.status).toBe(200);
    const positions = reorder.body.cards.map((c: any) => ({ id: c.id, position: c.position }));
    expect(positions.find((c: any) => c.id === c2).position).toBe(0);
    expect(positions.find((c: any) => c.id === c1).position).toBe(1);
  });

  it("PATCH /api/deck/[id]/theme switches the deck theme", async () => {
    freshDb();
    const user = await seedUser();
    const themeA = await seedTheme("A");
    const themeB = await seedTheme("B");
    const deckId = await seedDeck(user.id, themeA);
    useSession(user.id);
    const themeRoute = await import("@/app/api/deck/[id]/theme/route");
    const { status, body } = await readJson(
      await themeRoute.PATCH(
        jsonRequest(`http://t/api/deck/${deckId}/theme`, "PATCH", { themeId: themeB }),
        { params: Promise.resolve({ id: deckId }) },
      ),
    );
    expect(status).toBe(200);
    expect(body.deck.themeId).toBe(themeB);
  });

  it("PATCH /api/deck/[id]/share returns a stable shareSlug", async () => {
    freshDb();
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);
    const share = await import("@/app/api/deck/[id]/share/route");
    const on = await readJson(
      await share.PATCH(
        jsonRequest(`http://t/api/deck/${deckId}/share`, "PATCH", { isPublic: true }),
        { params: Promise.resolve({ id: deckId }) },
      ),
    );
    expect(on.status).toBe(200);
    expect(typeof on.body.shareSlug).toBe("string");
    const firstSlug = on.body.shareSlug;

    // Toggling off then on again keeps the same slug (stable).
    await share.PATCH(
      jsonRequest(`http://t/api/deck/${deckId}/share`, "PATCH", { isPublic: false }),
      { params: Promise.resolve({ id: deckId }) },
    );
    const again = await readJson(
      await share.PATCH(
        jsonRequest(`http://t/api/deck/${deckId}/share`, "PATCH", { isPublic: true }),
        { params: Promise.resolve({ id: deckId }) },
      ),
    );
    expect(again.body.shareSlug).toBe(firstSlug);
  });

  it("DELETE /api/deck/[id]/cards/[cardId] removes a card", async () => {
    freshDb();
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);

    const cards = await import("@/app/api/deck/[id]/cards/route");
    const created = await readJson(
      await cards.POST(
        jsonRequest(`http://t/api/deck/${deckId}/cards`, "POST", { title: "Gone", position: 0 }),
        { params: Promise.resolve({ id: deckId }) },
      ),
    );
    const cardId = created.body.card.id;

    const cardRoute = await import("@/app/api/deck/[id]/cards/[cardId]/route");
    const del = await readJson(
      await cardRoute.DELETE(jsonRequest(`http://t/x`, "DELETE"), {
        params: Promise.resolve({ id: deckId, cardId }),
      }),
    );
    expect(del.status).toBe(204);

    const remaining = await getDb().query.card.findMany({
      where: (c, { eq }) => eq(c.deckId, deckId),
    });
    expect(remaining).toHaveLength(0);
  });
});
