import { describe, it, expect, beforeEach } from "vitest";
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
import { applyRevision } from "@/lib/revise";
import { StubProvider, type AIProvider, type ReviseRequest } from "@carddeck/ai";
import type { Block } from "@carddeck/core";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Seed a deck with one ready card carrying known blocks. */
async function seedCard(deckId: string, blocks: Block[]): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(t.card)
    .values({
      deckId,
      position: 0,
      title: "Cover",
      intent: "cover",
      blocks: JSON.stringify(blocks),
      status: "ready",
    })
    .returning({ id: t.card.id });
  return row.id;
}

async function chatMessages(deckId: string) {
  return getDb().query.chatMessage.findMany({
    where: (m, { eq }) => eq(m.deckId, deckId),
    orderBy: (m, { asc }) => asc(m.createdAt),
  });
}

describe("POST /api/deck/[id]/chat", () => {
  beforeEach(() => freshDb());

  it("requires a session (401)", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(null);

    const { POST } = await import("@/app/api/deck/[id]/chat/route");
    const res = await POST(
      jsonRequest("http://t/x", "POST", { cardId: "c", instruction: "punch it up" }),
      params(deckId),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a missing cardId (v1 requires a target card)", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);

    const { POST } = await import("@/app/api/deck/[id]/chat/route");
    const res = await readJson(
      await POST(
        jsonRequest("http://t/x", "POST", { instruction: "punch it up" }),
        params(deckId),
      ),
    );
    expect(res.status).toBe(400);
    expect(await chatMessages(deckId)).toHaveLength(0);
  });

  it("rejects an empty instruction", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    const cardId = await seedCard(deckId, [{ type: "paragraph", text: ["hi"] }]);
    useSession(user.id);

    const { POST } = await import("@/app/api/deck/[id]/chat/route");
    const res = await POST(
      jsonRequest("http://t/x", "POST", { cardId, instruction: "   " }),
      params(deckId),
    );
    expect(res.status).toBe(400);
  });

  it("404s when the card belongs to a different deck", async () => {
    const me = await seedUser();
    const themeId = await seedTheme();
    const myDeck = await seedDeck(me.id, themeId);
    const theirDeck = await seedDeck(me.id, themeId);
    const foreignCard = await seedCard(theirDeck, [{ type: "paragraph", text: ["x"] }]);
    useSession(me.id);

    const { POST } = await import("@/app/api/deck/[id]/chat/route");
    const res = await POST(
      jsonRequest("http://t/x", "POST", { cardId: foreignCard, instruction: "rewrite" }),
      params(myDeck),
    );
    expect(res.status).toBe(404);
    expect(await chatMessages(myDeck)).toHaveLength(0);
  });

  it("applies the revision, returns {blocks, note}, and logs both messages", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    const cardId = await seedCard(deckId, [{ type: "paragraph", text: ["before"] }]);
    useSession(user.id);

    const { POST } = await import("@/app/api/deck/[id]/chat/route");
    const res = await readJson(
      await POST(
        jsonRequest("http://t/x", "POST", { cardId, instruction: "make it punchier" }),
        params(deckId),
      ),
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.blocks)).toBe(true);
    // StubProvider echoes the blocks and describes what it applied.
    expect(res.body.blocks).toEqual([{ type: "paragraph", text: ["before"] }]);
    expect(res.body.note).toContain("make it punchier");

    // Exactly one user row + one assistant row, both tied to the card.
    const messages = await chatMessages(deckId);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("make it punchier");
    expect(messages[0].cardId).toBe(cardId);
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe(res.body.note);

    // The card keeps its blocks in sync with what the provider returned.
    const card = await getDb().query.card.findFirst({
      where: (c, { eq }) => eq(c.id, cardId),
    });
    expect(JSON.parse(card!.blocks)).toEqual(res.body.blocks);
  });
});

describe("applyRevision", () => {
  beforeEach(() => freshDb());

  it("writes the provider's new blocks to the card and persists the exchange", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    const cardId = await seedCard(deckId, [{ type: "paragraph", text: ["old"] }]);

    // A provider that genuinely rewrites, so the test proves blocks are
    // replaced rather than merely echoed (the stub can't show that).
    const rewriting: AIProvider = {
      name: "rewriting",
      generateOutline: async () => [],
      generateCard: async () => [],
      revise: async (req: ReviseRequest): Promise<{ blocks: Block[]; note: string }> => {
        expect(req.cardTitle).toBe("Cover");
        expect(req.blocks).toEqual([{ type: "paragraph", text: ["old"] }]);
        return {
          blocks: [
            { type: "heading", level: 1, text: ["New"] },
            { type: "paragraph", text: [req.instruction] },
          ],
          note: "Rewrote it.",
        };
      },
    };

    const result = await applyRevision({
      deckId,
      cardId,
      instruction: "add a headline",
      provider: rewriting,
    });

    expect(result.note).toBe("Rewrote it.");
    expect(result.blocks).toHaveLength(2);

    const card = await getDb().query.card.findFirst({
      where: (c, { eq }) => eq(c.id, cardId),
    });
    expect(JSON.parse(card!.blocks)).toEqual(result.blocks);
    // Revision is a content change, not a regeneration: the card stays ready.
    expect(card!.status).toBe("ready");

    const messages = await chatMessages(deckId);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("throws when the card is missing, leaving the deck untouched", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);

    await expect(
      applyRevision({
        deckId,
        cardId: "nope",
        instruction: "rewrite",
        provider: new StubProvider(),
      }),
    ).rejects.toThrow(/no longer exists/);
    expect(await chatMessages(deckId)).toHaveLength(0);
  });
});
