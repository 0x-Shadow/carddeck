import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
import { eq } from "drizzle-orm";
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

  it("GET /api/deck also lists only public decks owned by the MCP agent", async () => {
    freshDb();
    const me = await seedUser();
    const agent = await seedUser("mcp@carddeck.local");
    const other = await seedUser();
    const themeId = await seedTheme();
    const agentDeck = await seedDeck(agent.id, themeId, "Agent project");
    const privateAgentDeck = await seedDeck(agent.id, themeId, "Private agent project");
    await seedDeck(other.id, themeId, "Other user's project");
    const db = getDb();
    await db.update(t.deck).set({ status: "ready", isPublic: 1, shareSlug: "public-agent" }).where(eq(t.deck.id, agentDeck));
    await db.update(t.deck).set({ status: "ready" }).where(eq(t.deck.id, privateAgentDeck));
    useSession(me.id);

    const { GET } = await import("@/app/api/deck/route");
    const { status, body } = await readJson(await GET());
    expect(status).toBe(200);
    expect(body.agentDecks.map((deck: any) => deck.id)).toContain(agentDeck);
    expect(body.agentDecks.map((deck: any) => deck.id)).not.toContain(privateAgentDeck);
    expect(body.agentDecks.map((deck: any) => deck.title)).not.toContain("Other user's project");
  });

  it("POST /api/deck/[id]/duplicate makes a private editable copy with local images", async () => {
    const originalDataDir = process.env.DATA_DIR;
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "carddeck-duplicate-"));
    process.env.DATA_DIR = dataDir;
    try {
      freshDb();
      const owner = await seedUser();
      const agent = await seedUser("mcp@carddeck.local");
      const themeId = await seedTheme();
      const sourceId = await seedDeck(agent.id, themeId, "Agent deck");
      const db = getDb();
      await db.update(t.deck).set({ status: "ready", isPublic: 1, shareSlug: "shared-agent" }).where(eq(t.deck.id, sourceId));
      const assetId = randomUUID();
      const sourceAssetsDir = path.join(dataDir, "assets", sourceId);
      mkdirSync(sourceAssetsDir, { recursive: true });
      const imageBytes = Buffer.from("image bytes");
      writeFileSync(path.join(sourceAssetsDir, `${assetId}.png`), imageBytes);
      await db.insert(t.asset).values({ id: assetId, deckId: sourceId, mime: "image/png", sizeBytes: imageBytes.length });
      const sourceUrl = `/api/deck/${sourceId}/assets/${assetId}`;
      await db.insert(t.card).values({
        deckId: sourceId,
        position: 0,
        title: "Cover",
        status: "ready",
        blocks: JSON.stringify([{ type: "image", src: sourceUrl, layout: "side" }]),
      });
      useSession(owner.id);

      const { POST } = await import("@/app/api/deck/[id]/duplicate/route");
      const result = await readJson(await POST(
        jsonRequest(`http://t/api/deck/${sourceId}/duplicate`, "POST"),
        { params: Promise.resolve({ id: sourceId }) },
      ));
      expect(result.status).toBe(201);
      expect(result.body.deck.userId).toBe(owner.id);
      expect(result.body.deck.isPublic).toBe(0);
      expect(result.body.deck.title).toBe("Agent deck (Copy)");

      const copyCards = await db.query.card.findMany({
        where: (card, { eq }) => eq(card.deckId, result.body.deck.id),
      });
      const copiedBlocks = JSON.parse(copyCards[0].blocks);
      expect(copiedBlocks[0].src).toMatch(new RegExp(`^/api/deck/${result.body.deck.id}/assets/`));
      expect(copiedBlocks[0].src).not.toBe(sourceUrl);
      const copiedAssetId = copiedBlocks[0].src.split("/").at(-1);
      const copiedFile = path.join(dataDir, "assets", result.body.deck.id, `${copiedAssetId}.png`);
      expect(existsSync(copiedFile)).toBe(true);
      expect(readFileSync(copiedFile).equals(imageBytes)).toBe(true);
    } finally {
      if (originalDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = originalDataDir;
      rmSync(dataDir, { recursive: true, force: true });
    }
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

  it("PATCH /api/deck/[id] rejects an unknown themeId and status", async () => {
    freshDb();
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);
    const route = await import("@/app/api/deck/[id]/route");

    const badTheme = await readJson(
      await route.PATCH(
        jsonRequest(`http://t/api/deck/${deckId}`, "PATCH", { themeId: "does-not-exist" }),
        { params: Promise.resolve({ id: deckId }) },
      ),
    );
    expect(badTheme.status).toBe(400);

    const badStatus = await readJson(
      await route.PATCH(
        jsonRequest(`http://t/api/deck/${deckId}`, "PATCH", { status: "bogus" }),
        { params: Promise.resolve({ id: deckId }) },
      ),
    );
    expect(badStatus.status).toBe(400);

    // A real theme still applies.
    const themeB = await seedTheme("B");
    const good = await readJson(
      await route.PATCH(
        jsonRequest(`http://t/api/deck/${deckId}`, "PATCH", { themeId: themeB }),
        { params: Promise.resolve({ id: deckId }) },
      ),
    );
    expect(good.status).toBe(200);
    expect(good.body.deck.themeId).toBe(themeB);
  });

  it("PATCH card blocks applies the model schema (rejects junk, keeps valid)", async () => {
    freshDb();
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);

    const cardsRoute = await import("@/app/api/deck/[id]/cards/route");
    const created = await readJson(
      await cardsRoute.POST(
        jsonRequest(`http://t/api/deck/${deckId}/cards`, "POST", { title: "C" }),
        { params: Promise.resolve({ id: deckId }) },
      ),
    );
    const cardId = created.body.card.id as string;
    const cardRoute = await import("@/app/api/deck/[id]/cards/[cardId]/route");
    const patch = async (body: unknown) =>
      readJson(
        await cardRoute.PATCH(
          jsonRequest(`http://t/api/deck/${deckId}/cards/${cardId}`, "PATCH", body),
          { params: Promise.resolve({ id: deckId, cardId }) },
        ),
      );

    // An unknown block type is the model's contract to follow → 400 …
    expect((await patch({ blocks: [{ type: "sparkle" }] })).status).toBe(400);
    // …as is a non-array.
    expect((await patch({ blocks: "nope" })).status).toBe(400);
    // Unknown card statuses are refused too.
    expect((await patch({ status: "bogus" })).status).toBe(400);

    // Valid blocks still save — normalized through the same schema.
    const good = await patch({ blocks: [{ type: "paragraph", text: ["ok"] }] });
    expect(good.status).toBe(200);
    expect(JSON.parse(good.body.card.blocks)).toEqual([{ type: "paragraph", text: ["ok"] }]);
  });
});

describe("deck PATCH motion", () => {
  async function seedReadyDeckWithCards() {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId, "Motion");
    useSession(user.id);
    const db = getDb();
    // NB: callback-form .where() is broken on update() in this drizzle
    // version (it binds the callback object as a parameter) — always use
    // direct eq(t.x.id, …) in updates.
    await db.update(t.deck).set({ status: "ready" }).where(eq(t.deck.id, deckId));
    await db.insert(t.card).values([
      { deckId, position: 0, title: "One", blocks: JSON.stringify([{ type: "paragraph", text: ["a"] }]) },
      { deckId, position: 1, title: "Two", blocks: "[]" },
    ]);
    return deckId;
  }

  async function patchMotion(deckId: string, body: unknown) {
    const { PATCH } = await import("@/app/api/deck/[id]/route");
    return readJson(
      await PATCH(jsonRequest(`http://t/api/deck/${deckId}`, "PATCH", body), {
        params: Promise.resolve({ id: deckId }),
      }),
    );
  }

  it("motionPreset derives a full plan on a ready deck", async () => {
    const deckId = await seedReadyDeckWithCards();
    const { status, body } = await patchMotion(deckId, { motionPreset: "punchy" });
    expect(status).toBe(200);
    const motion = JSON.parse(body.deck.motion);
    expect(motion.preset).toBe("punchy");
    // One plan slide per card, with builds derived from each card's blocks.
    expect(motion.slides).toHaveLength(2);
    expect(motion.slides[0].builds.length).toBeGreaterThan(0);
  });

  it("motionPreset stores preset-only on a non-ready deck (worker fills later)", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId, "Draft");
    useSession(user.id);
    const { status, body } = await patchMotion(deckId, { motionPreset: "cinematic" });
    expect(status).toBe(200);
    const motion = JSON.parse(body.deck.motion);
    expect(motion.preset).toBe("cinematic");
    expect(motion.slides).toEqual([]);
  });

  it("rejects an unknown preset", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);
    const { status } = await patchMotion(deckId, { motionPreset: "hyperspace" });
    expect(status).toBe(400);
  });

  it("accepts a full validated motion plan", async () => {
    const deckId = await seedReadyDeckWithCards();
    const plan = {
      preset: "subtle",
      slides: [
        { transition: "fade", builds: [{ effect: "fade", delayMs: 0 }] },
        { transition: "fade", builds: [{ effect: "fade", delayMs: 300 }] },
      ],
    };
    const { status, body } = await patchMotion(deckId, { motion: plan });
    expect(status).toBe(200);
    expect(JSON.parse(body.deck.motion)).toEqual(plan);
  });

  it("rejects a full plan with unknown enums", async () => {
    const deckId = await seedReadyDeckWithCards();
    const { status } = await patchMotion(deckId, {
      motion: { preset: "subtle", slides: [{ transition: "warp", builds: [] }] },
    });
    expect(status).toBe(400);
  });

  it("preserves title patching alongside motion", async () => {
    const deckId = await seedReadyDeckWithCards();
    const { status, body } = await patchMotion(deckId, { title: "Renamed", motionPreset: "none" });
    expect(status).toBe(200);
    expect(body.deck.title).toBe("Renamed");
    expect(JSON.parse(body.deck.motion)).toEqual({ preset: "none", slides: [] });
  });
});
