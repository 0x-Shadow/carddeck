// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshDb, seedUser, seedTheme, seedDeck, useSession } from "./helpers/route";
import { saveAsset, readAssetDataUrl } from "@/lib/assets";
import { createImageResolver } from "@/lib/export-slides";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let tmpDir: string;
let prevDataDir: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "export-images-"));
  prevDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tmpDir;
  freshDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function seedAsset(deckId: string) {
  return saveAsset(deckId, new Uint8Array(PNG), "image/png", "dot.png");
}

describe("readAssetDataUrl", () => {
  it("returns a base64 data URL for an existing asset", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    const asset = await seedAsset(deckId);

    const dataUrl = await readAssetDataUrl(deckId, asset.assetId);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    const decoded = Buffer.from(dataUrl!.split(",")[1], "base64");
    expect(decoded.equals(PNG)).toBe(true);
  });

  it("returns null for unknown or cross-deck ids", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckA = await seedDeck(user.id, themeId, "A");
    const deckB = await seedDeck(user.id, themeId, "B");
    const asset = await seedAsset(deckA);

    expect(await readAssetDataUrl(deckB, asset.assetId)).toBeNull();
    expect(await readAssetDataUrl(deckA, "nope")).toBeNull();
  });
});

describe("createImageResolver", () => {
  it("resolves local asset paths to data URLs", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    const asset = await seedAsset(deckId);

    const resolve = createImageResolver(deckId);
    const got = await resolve(`/api/deck/${deckId}/assets/${asset.assetId}`);
    expect(got?.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("refuses non-http(s) schemes without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    const resolve = createImageResolver(deckId);

    for (const src of [
      "file:///etc/passwd",
      "ftp://example.com/x.png",
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
    ]) {
      expect(await resolve(src)).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches remote http(s) images into data URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: (h: string) => (h === "content-type" ? "image/png" : null) },
        arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
      })),
    );
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);

    const got = await createImageResolver(deckId)("https://example.com/pic.png");
    expect(got?.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("rejects non-image content types, oversize bodies, and failed fetches", async () => {
    const user = await seedUser();
    const themeId = await seedTheme();
    const deckId = await seedDeck(user.id, themeId);
    const resolve = createImageResolver(deckId);

    // text/html pretending to be a URL.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => "text/html" },
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );
    expect(await resolve("https://evil.example/x")).toBeNull();

    // Oversize body (over the 10MB asset cap).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => "image/png" },
        arrayBuffer: async () => new ArrayBuffer(11 * 1024 * 1024),
      })),
    );
    expect(await resolve("https://big.example/x.png")).toBeNull();

    // Network failure.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    expect(await resolve("https://down.example/x.png")).toBeNull();
  });
});
