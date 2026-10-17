import { describe, it, expect, beforeEach } from "vitest";
import {
  freshDb,
  seedUser,
  seedDeck,
  useSession,
  jsonRequest,
} from "./helpers/route";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { PRESET_THEMES } from "@carddeck/core";
import { chromium } from "playwright";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const theme = PRESET_THEMES[0];

/**
 * The PDF export needs a real headless chromium. Probe it *before* the tests
 * are declared (top-level await — a `beforeAll` would run too late for
 * `skipIf`); if the browser is missing, skip the rendering tests with a clear
 * message instead of failing. The access-control tests below never launch a
 * browser and always run.
 */
const browserAvailable = await (async () => {
  try {
    const browser = await chromium.launch();
    await browser.close();
    return true;
  } catch (err) {
    const line = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.warn(
      `[export-pdf] PDF rendering tests skipped: chromium unavailable (${line}). ` +
        `Run 'npx playwright install chromium' to enable them.`,
    );
    return false;
  }
})();

/** Seed a deck (public or private) with two ready cards; returns ids. */
async function seedPdfDeck(opts: {
  isPublic: number;
  shareSlug: string | null;
}): Promise<{ userId: string; deckId: string }> {
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
  return { userId: user.id, deckId };
}

describe("GET /api/deck/[id]/export/pdf", () => {
  beforeEach(() => freshDb());

  it.skipIf(!browserAvailable)(
    "returns a %PDF attachment for the owner",
    async () => {
      const { userId, deckId } = await seedPdfDeck({
        isPublic: 0,
        shareSlug: null,
      });
      useSession(userId);

      const { GET } = await import("@/app/api/deck/[id]/export/pdf/route");
      const res = await GET(
        jsonRequest(`http://t/x/${deckId}`, "GET"),
        params(deckId),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/pdf");
      expect(res.headers.get("content-disposition")).toContain("attachment");
      expect(res.headers.get("content-disposition")).toContain("Launch-Plan.pdf");

      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(buf.byteLength).toBeGreaterThan(1000);
    },
  );

  it.skipIf(!browserAvailable)(
    "lets a share-link holder export a public deck without signing in",
    async () => {
      const { deckId } = await seedPdfDeck({ isPublic: 1, shareSlug: "pub" });
      useSession(null);

      const { GET } = await import("@/app/api/deck/[id]/export/pdf/route");
      const res = await GET(
        jsonRequest(`http://t/x/${deckId}`, "GET"),
        params(deckId),
      );
      expect(res.status).toBe(200);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    },
  );

  it("404s a private deck for a non-owner", async () => {
    const { deckId } = await seedPdfDeck({ isPublic: 0, shareSlug: "priv" });
    const stranger = await seedUser("stranger@t.io");
    useSession(stranger.id);

    const { GET } = await import("@/app/api/deck/[id]/export/pdf/route");
    const res = await GET(
      jsonRequest(`http://t/x/${deckId}`, "GET"),
      params(deckId),
    );
    expect(res.status).toBe(404);
  });

  it("401s a private deck for an anonymous caller", async () => {
    const { deckId } = await seedPdfDeck({ isPublic: 0, shareSlug: "priv2" });
    useSession(null);

    const { GET } = await import("@/app/api/deck/[id]/export/pdf/route");
    const res = await GET(
      jsonRequest(`http://t/x/${deckId}`, "GET"),
      params(deckId),
    );
    expect(res.status).toBe(401);
  });

  it("404s a missing deck", async () => {
    const { GET } = await import("@/app/api/deck/[id]/export/pdf/route");
    const res = await GET(
      jsonRequest("http://t/x/nope", "GET"),
      params("nope"),
    );
    expect(res.status).toBe(404);
  });
});
