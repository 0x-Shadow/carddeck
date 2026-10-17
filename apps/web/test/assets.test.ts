// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { freshDb, seedUser, seedTheme, seedDeck, useSession, jsonRequest } from "./helpers/route";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { eq } from "drizzle-orm";

// A tiny 1x1 PNG (valid bytes; the route only sniffs the declared MIME type).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let tmpDir: string;
let prevDataDir: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "assets-test-"));
  prevDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function uploadRequest(url: string, filename: string, type: string, bytes: Buffer): Request {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)], { type }), filename);
  return new Request(url, { method: "POST", body: form });
}

describe("asset storage", () => {
  it("stores an uploaded PNG and serves it back to the owner", async () => {
    freshDb();
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);

    const { POST } = await import("@/app/api/deck/[id]/assets/route");
    const res = await POST(
      uploadRequest(`http://t/api/deck/${deckId}/assets`, "dot.png", "image/png", PNG),
      { params: Promise.resolve({ id: deckId }) },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { asset: { id: string; url: string } };
    expect(body.asset.id).toBeTruthy();
    expect(body.asset.url).toBe(`/api/deck/${deckId}/assets/${body.asset.id}`);

    const { GET } = await import("@/app/api/deck/[id]/assets/[assetId]/route");
    const got = await GET(
      new Request(`http://t${body.asset.url}`),
      { params: Promise.resolve({ id: deckId, assetId: body.asset.id }) },
    );
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("serves assets for public decks without a session", async () => {
    freshDb();
    const owner = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(owner.id, themeId);
    useSession(owner.id);
    const { POST } = await import("@/app/api/deck/[id]/assets/route");
    const res = await POST(
      uploadRequest(`http://t/api/deck/${deckId}/assets`, "dot.png", "image/png", PNG),
      { params: Promise.resolve({ id: deckId }) },
    );
    const { asset } = (await res.json()) as { asset: { id: string } };

    // Now make the deck public (through the app's own share route) and drop
    // the session (a signed-out reader).
    const { PATCH } = await import("@/app/api/deck/[id]/share/route");
    const share = await PATCH(
      jsonRequest(`http://t/api/deck/${deckId}/share`, "PATCH", { isPublic: true }),
      { params: Promise.resolve({ id: deckId }) },
    );
    expect(share.status).toBe(200);
    useSession(null);

    const { GET } = await import("@/app/api/deck/[id]/assets/[assetId]/route");
    const got = await GET(
      new Request(`http://t/api/deck/${deckId}/assets/${asset.id}`),
      { params: Promise.resolve({ id: deckId, assetId: asset.id }) },
    );
    expect(got.status).toBe(200);
  });

  it("rejects unauthenticated uploads and non-owned decks", async () => {
    freshDb();
    const owner = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(owner.id, themeId);

    useSession(null);
    const mod = await import("@/app/api/deck/[id]/assets/route");
    const anon = await mod.POST(
      uploadRequest(`http://t/api/deck/${deckId}/assets`, "dot.png", "image/png", PNG),
      { params: Promise.resolve({ id: deckId }) },
    );
    expect(anon.status).toBe(401);

    const stranger = await seedUser();
    useSession(stranger.id);
    const res = await mod.POST(
      uploadRequest(`http://t/api/deck/${deckId}/assets`, "dot.png", "image/png", PNG),
      { params: Promise.resolve({ id: deckId }) },
    );
    expect(res.status).toBe(404);
  });

  it("rejects non-image MIME types and oversize uploads", async () => {
    freshDb();
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);
    const { POST } = await import("@/app/api/deck/[id]/assets/route");
    const p = { params: Promise.resolve({ id: deckId }) };

    const svg = await POST(
      uploadRequest(`http://t/a`, "x.svg", "image/svg+xml", Buffer.from("<svg/>")),
      p,
    );
    expect(svg.status).toBe(400);

    const huge = await POST(
      uploadRequest(`http://t/a`, "big.png", "image/png", Buffer.alloc(11 * 1024 * 1024)),
      p,
    );
    expect(huge.status).toBe(413);
  });

  it("returns 404 for traversal-shaped and unknown asset ids without leaking files", async () => {
    freshDb();
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);
    const { GET } = await import("@/app/api/deck/[id]/assets/[assetId]/route");

    for (const assetId of ["..", "../..", "..%2f..", randomUUID()]) {
      const got = await GET(
        new Request(`http://t/api/deck/${deckId}/assets/${assetId}`),
        { params: Promise.resolve({ id: deckId, assetId }) },
      );
      expect(got.status).toBe(404);
    }
  });

  it("rejects an asset id that belongs to a different deck (traversal of deck scope)", async () => {
    freshDb();
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckA = await seedDeck(user.id, themeId, "A");
    const deckB = await seedDeck(user.id, themeId, "B");
    useSession(user.id);
    const { POST } = await import("@/app/api/deck/[id]/assets/route");
    const res = await POST(
      uploadRequest(`http://t/a`, "dot.png", "image/png", PNG),
      { params: Promise.resolve({ id: deckA }) },
    );
    const { asset } = (await res.json()) as { asset: { id: string } };

    const { GET } = await import("@/app/api/deck/[id]/assets/[assetId]/route");
    const got = await GET(
      new Request(`http://t/b`),
      { params: Promise.resolve({ id: deckB, assetId: asset.id }) },
    );
    expect(got.status).toBe(404);
  });

  it("cascades deck deletion to asset rows", async () => {
    freshDb();
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    useSession(user.id);
    const { POST } = await import("@/app/api/deck/[id]/assets/route");
    const res = await POST(
      uploadRequest(`http://t/a`, "dot.png", "image/png", PNG),
      { params: Promise.resolve({ id: deckId }) },
    );
    const { asset } = (await res.json()) as { asset: { id: string } };

    const db = getDb();
    await db.delete(t.deck).where(eq(t.deck.id, deckId));
    const row = await db.query.asset.findFirst({
      where: (a, { eq }) => eq(a.id, asset.id),
    });
    expect(row).toBeUndefined();
  });
});
