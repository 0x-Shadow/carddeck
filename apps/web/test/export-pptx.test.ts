import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import JSZip from "jszip";
import { chromium } from "playwright";
import { isPptagentAvailable } from "@carddeck/pptx";
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

/**
 * The HTML-engine export needs the vendored PPTAgent converter, its node deps,
 * and a real chromium. Probe all three before the tests are declared so a
 * machine without them skips instead of failing.
 */
const pptagentAvailable =
  isPptagentAvailable() &&
  (await (async () => {
    try {
      const browser = await chromium.launch();
      await browser.close();
      return true;
    } catch {
      return false;
    }
  })());

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

describe("GET /api/deck/[id]/export/pptx with the PPTAgent engine", () => {
  beforeEach(() => freshDb());

  it.skipIf(!pptagentAvailable)(
    "converts the designed HTML slides into native PowerPoint shapes",
    async () => {
      const { userId, deckId } = await seedExportDeck({ isPublic: 0, shareSlug: null });
      const { useSession } = await import("./helpers/route");
      useSession(userId);

      const { GET } = await import("@/app/api/deck/[id]/export/pptx/route");
      const res = await GET(
        jsonRequest(`http://t/x/${deckId}?engine=pptagent`, "GET"),
        params(deckId),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("x-carddeck-engine")).toBe("pptagent");
      expect(res.headers.get("content-disposition")).toContain("Launch-Plan-PPTAgent.pptx");

      const buf = Buffer.from(await res.arrayBuffer());
      const zip = await JSZip.loadAsync(buf);
      const slides = Object.keys(zip.files).filter((name) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(name),
      );
      expect(slides).toHaveLength(2);
      const slide1 = (await zip.file("ppt/slides/slide1.xml")!.async("string")) as string;
      expect(slide1).toContain("<a:t>Overview content</a:t>");
    },
    120_000,
  );

  it("falls back to the native engine for an unknown engine value", async () => {
    const { userId, deckId } = await seedExportDeck({ isPublic: 0, shareSlug: null });
    const { useSession } = await import("./helpers/route");
    useSession(userId);

    const { GET } = await import("@/app/api/deck/[id]/export/pptx/route");
    const res = await GET(
      jsonRequest(`http://t/x/${deckId}?engine=bogus`, "GET"),
      params(deckId),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-carddeck-engine")).toBe("native");
  });
});

describe("GET /api/deck/[id]/export/pptx motion", () => {
  beforeEach(() => freshDb());
  afterEach(() => vi.unstubAllEnvs());

  /** Seed motion onto the deck row and return slide1.xml of the export. */
  async function exportSlide1Xml(deckId: string, userId: string, motion: unknown) {
    const db = getDb();
    // Direct eq() — callback-form .where() is broken on update() here.
    await db
      .update(t.deck)
      .set({ motion: JSON.stringify(motion) })
      .where(eq(t.deck.id, deckId));

    const { useSession } = await import("./helpers/route");
    useSession(userId);
    const { GET } = await import("@/app/api/deck/[id]/export/pptx/route");
    const res = await GET(jsonRequest(`http://t/x/${deckId}`, "GET"), params(deckId));
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    return (await zip.file("ppt/slides/slide1.xml")!.async("string")) as string;
  }

  it("carries the deck's motion plan into the file", async () => {
    const { userId, deckId } = await seedExportDeck({ isPublic: 0, shareSlug: null });
    const s1 = await exportSlide1Xml(deckId, userId, {
      preset: "punchy",
      slides: [
        { transition: "push", builds: [{ effect: "wipeUp", delayMs: 200 }] },
        { transition: "fade", builds: [{ effect: "fade", delayMs: 0 }] },
      ],
    });
    expect(s1).toContain("<p:transition");
    expect(s1).toContain("<p:push");
    expect(s1).toContain("<p:timing>");
    expect(s1).toContain('filter="wipe(down)"');
  });

  it("skips animation entirely when CARDDECK_MOTION=off", async () => {
    const { userId, deckId } = await seedExportDeck({ isPublic: 0, shareSlug: null });
    vi.stubEnv("CARDDECK_MOTION", "off");
    const s1 = await exportSlide1Xml(deckId, userId, {
      preset: "punchy",
      slides: [
        { transition: "push", builds: [{ effect: "fade", delayMs: 0 }] },
        { transition: "fade", builds: [] },
      ],
    });
    expect(s1).not.toContain("<p:timing>");
    expect(s1).not.toContain("<p:transition");
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
