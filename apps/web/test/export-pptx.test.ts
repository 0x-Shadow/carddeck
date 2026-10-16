import { describe, it, expect, beforeEach } from "vitest";
import {
  freshDb,
  seedUser,
  seedDeck,
  jsonRequest,
} from "./helpers/route";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { PRESET_THEMES } from "@carddeck/core";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const theme = PRESET_THEMES[0];

/** Seed a deck (public or private) with two ready cards; returns ids. */
async function seedExportDeck(opts: {
  isPublic: number;
  shareSlug: string | null;
}): Promise<{ userId: string; deckId: string; email: string }> {
  const user = await seedUser();
  const db = getDb();
  const [themeRow] = await db
    .insert(t.theme)
    .values({ name: theme.name, isPreset: 1, tokens: JSON.stringify(theme) })
    .returning({ id: t.theme.id });
  const deckId = await seedDeck(user.id, themeRow.id, "Launch Plan");
  await db
    .update(t.deck)
    .set({ shareSlug: opts.shareSlug, isPublic: opts.isPublic })
    .where(eq(t.deck.id, deckId));

  for (const [i, title] of ["Overview", "Roadmap"].entries()) {
    await db.insert(t.card).values({
      deckId,
      position: i,
      title,
      intent: "body",
      blocks: JSON.stringify([{ type: "paragraph", text: [`${title} content`] }]),
      status: "ready",
    });
  }
  return { userId: user.id, deckId, email: user.email };
}

describe("GET /api/deck/[id]/export/pptx", () => {
  beforeEach(() => freshDb());

  it("returns a valid .pptx attachment for the owner", async () => {
    const { userId, deckId } = await seedExportDeck({ isPublic: 0, shareSlug: null });
    const { useSession } = await import("./helpers/route");
    useSession(userId);

    const { GET } = await import("@/app/api/deck/[id]/export/pptx/route");
    const res = await GET(jsonRequest(`http://t/x/${deckId}`, "GET"), params(deckId));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(
      "presentationml.presentation",
    );
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("Launch-Plan.pptx");

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it("lets a share-link holder export a public deck without signing in", async () => {
    const { deckId } = await seedExportDeck({ isPublic: 1, shareSlug: "pub" });
    const { useSession } = await import("./helpers/route");
    useSession(null);

    const { GET } = await import("@/app/api/deck/[id]/export/pptx/route");
    const res = await GET(jsonRequest(`http://t/x/${deckId}`, "GET"), params(deckId));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString("latin1")).toBe(
      "PK",
    );
  });

  it("404s a private deck for a non-owner", async () => {
    const { deckId } = await seedExportDeck({ isPublic: 0, shareSlug: "priv" });
    const stranger = await seedUser("stranger@t.io");
    const { useSession } = await import("./helpers/route");
    useSession(stranger.id);

    const { GET } = await import("@/app/api/deck/[id]/export/pptx/route");
    const res = await GET(jsonRequest(`http://t/x/${deckId}`, "GET"), params(deckId));
    expect(res.status).toBe(404);
  });

  it("401s a private deck for an anonymous caller", async () => {
    const { deckId } = await seedExportDeck({ isPublic: 0, shareSlug: "priv2" });
    const { useSession } = await import("./helpers/route");
    useSession(null);

    const { GET } = await import("@/app/api/deck/[id]/export/pptx/route");
    const res = await GET(jsonRequest(`http://t/x/${deckId}`, "GET"), params(deckId));
    expect(res.status).toBe(401);
  });

  it("404s a missing deck", async () => {
    const { GET } = await import("@/app/api/deck/[id]/export/pptx/route");
    const res = await GET(jsonRequest("http://t/x/nope", "GET"), params("nope"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/deck/[id]/export/potx", () => {
  beforeEach(() => freshDb());

  it("returns a valid .potx template attachment for the owner", async () => {
    const { userId, deckId } = await seedExportDeck({ isPublic: 0, shareSlug: null });
    const { useSession } = await import("./helpers/route");
    useSession(userId);

    const { GET } = await import("@/app/api/deck/[id]/export/potx/route");
    const res = await GET(jsonRequest(`http://t/x/${deckId}`, "GET"), params(deckId));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("presentationml.template");
    expect(res.headers.get("content-disposition")).toContain("Launch-Plan.potx");

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
