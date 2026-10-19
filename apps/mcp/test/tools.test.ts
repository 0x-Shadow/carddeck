import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { chromium } from "playwright";
import { isPptagentAvailable } from "@carddeck/pptx";
import { makeTestDb, setTestDb, type DB } from "../../web/lib/db";
import { runOnce } from "../../worker/src/pipeline";
import { StubProvider } from "@carddeck/ai";
import { createServer, type ServerOptions } from "../src/tools";

/**
 * Integration tests for the Carddeck MCP server.
 *
 * A real SDK `Client` talks to the real server over an in-memory transport —
 * same registration path, same tool handlers, same envelopes as an agent
 * would see. The DB is a migrated in-memory database and `DATA_DIR` points at
 * a throwaway temp dir, so asset/export writes are isolated per test.
 *
 * Generation is exercised the way the product runs it: the tool enqueues jobs
 * and the test plays the worker (claim + dispatch via `runOnce`) until the
 * tool call settles.
 */

/** 1×1 transparent PNG — real magic bytes, tiny enough to inline. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The HTML-engine export needs the vendored PPTAgent converter, its node deps,
 * and a real chromium. Probe before the tests are declared so a machine
 * without them skips instead of failing.
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

async function connect(opts?: ServerOptions): Promise<Client> {
  const server = await createServer(opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

interface Envelope {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/** Call a tool and decode its single text-content envelope. */
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError: boolean; body: Envelope }> {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as { type: string; text: string }[];
  return { isError: res.isError === true, body: JSON.parse(content[0].text) as Envelope };
}

/** Play the worker until `done` reports true, or `maxMs` elapses. */
async function pump(db: DB, done: () => boolean, maxMs = 9000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline && !done()) {
    await runOnce({ provider: new StubProvider(), db });
    await sleep(5);
  }
  return done();
}

describe("carddeck MCP server", () => {
  let db: DB;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "carddeck-mcp-"));
    process.env.DATA_DIR = dataDir;
    db = makeTestDb();
    setTestDb(db);
  });

  afterEach(() => {
    setTestDb(null);
    delete process.env.DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("lists no decks on a fresh install", async () => {
    const client = await connect();
    const { isError, body } = await call(client, "list_decks");
    expect(isError).toBe(false);
    expect(body).toEqual({ ok: true, decks: [] });
  });

  it("creates a ready deck from cards and round-trips it through get_deck", async () => {
    const client = await connect();
    const created = await call(client, "create_deck_from_cards", {
      title: "Launch Plan",
      cards: [
        { title: "Overview", content: ["We ship in Q3.", "Budget approved."] },
        { title: "Roadmap", content: ["Alpha in July."] },
      ],
      motion: "subtle",
    });
    expect(created.isError).toBe(false);
    expect(created.body.status).toBe("ready");
    const createdCards = created.body.cards as { id: string; title: string }[];
    expect(createdCards.map((c) => c.title)).toEqual(["Overview", "Roadmap"]);
    // Decks born over MCP are shared read-only: the returned url must open in
    // a browser for the human who never holds the agent account's session.
    expect(created.body.url).toMatch(/^\/view\/[0-9a-f]{16}$/);

    const got = await call(client, "get_deck", { deckId: created.body.deckId });
    const deck = got.body.deck as any;
    expect(deck.title).toBe("Launch Plan");
    expect(deck.isPublic).toBe(true);
    expect(deck.url).toBe(created.body.url);
    expect(deck.status).toBe("ready");
    expect(deck.cards).toHaveLength(2);
    // One paragraph block per content line.
    expect(deck.cards[0].blocks).toEqual([
      { type: "paragraph", text: ["We ship in Q3."] },
      { type: "paragraph", text: ["Budget approved."] },
    ]);
    // A ready deck with a preset gets its plan derived immediately.
    expect(deck.motion.preset).toBe("subtle");
    expect(deck.motion.slides).toHaveLength(2);
  });

  it("stores rich Gamma-style blocks supplied by an agent", async () => {
    const client = await connect();
    const created = await call(client, "create_deck_from_cards", {
      title: "Rich deck",
      cards: [
        {
          title: "Cover",
          blocks: [
            { type: "heading", level: 1, text: ["The future, presented"] },
            { type: "callout", tone: "info", text: ["AI-native storytelling"] },
          ],
        },
        {
          title: "Evidence",
          blocks: [
            { type: "heading", level: 2, text: ["Evidence"] },
            {
              type: "chart",
              kind: "bar",
              data: {
                labels: ["Q1", "Q2", "Q3"],
                series: [{ name: "Growth", values: [12, 48, 96] }],
              },
            },
          ],
        },
      ],
      theme: "cyberpunk",
      motion: "3d",
    });
    expect(created.isError).toBe(false);

    const got = await call(client, "get_deck", { deckId: created.body.deckId });
    const deck = got.body.deck as any;
    expect(deck.cards[0].blocks).toEqual([
      { type: "heading", level: 1, text: ["The future, presented"] },
      { type: "callout", tone: "info", text: ["AI-native storytelling"] },
    ]);
    expect(deck.cards[1].blocks[1].data.series[0].values).toEqual([12, 48, 96]);
    expect(deck.motion.preset).toBe("3d");
    expect(deck.motion.slides).toHaveLength(2);
  });

  it("generates a deck from a prompt and waits until it is ready", async () => {
    const client = await connect({ waitTimeoutMs: 9000, pollMs: 10 });
    let settled: { isError: boolean; body: Envelope } | null = null;
    const pending = call(client, "create_deck", {
      prompt: "Q3 launch plan",
      numCards: 3,
      motion: "punchy",
    }).then((r) => {
      settled = r;
    });

    const finished = await pump(db, () => settled !== null);
    await pending;
    expect(finished).toBe(true);
    const result = settled!;
    expect(result.isError).toBe(false);
    expect(result.body.status).toBe("ready");
    expect((result.body.cards as unknown[]).length).toBe(3);
    expect(result.body.url).toMatch(/^\/view\/[0-9a-f]{16}$/);

    // The worker filled the motion plan once the cards settled.
    const got = await call(client, "get_deck", { deckId: result.body.deckId });
    const deck = got.body.deck as any;
    expect(deck.motion.preset).toBe("punchy");
    expect(deck.motion.slides).toHaveLength(3);
  });

  it("returns partial state with a note when generation outlives the deadline", async () => {
    // Disable the in-process worker so the deadline genuinely expires before
    // any queued job is claimed — the external-worker contract.
    const client = await connect({ waitTimeoutMs: 80, pollMs: 5, selfDrive: false });
    const { isError, body } = await call(client, "create_deck", {
      prompt: "Brief",
      numCards: 2,
    });
    // A slow (or absent) worker is not a tool failure: the deck exists and
    // keeps generating; the note tells the agent what to do next.
    expect(isError).toBe(false);
    expect(body.ok).toBe(true);
    expect(body.status).toBe("generating");
    expect(typeof body.note).toBe("string");
    expect(body.deckId).toBeTruthy();
  });

  it("sets theme and motion and reports them via get_deck", async () => {
    const client = await connect();
    const created = await call(client, "create_deck_from_cards", {
      title: "Themed",
      cards: [{ title: "A", content: ["x"] }],
    });
    const deckId = created.body.deckId as string;

    const themed = await call(client, "set_theme", { deckId, theme: "Dark" });
    expect(themed.isError).toBe(false);
    const motion = await call(client, "set_motion", { deckId, preset: "punchy" });
    expect(motion.isError).toBe(false);

    const got = await call(client, "get_deck", { deckId });
    const deck = got.body.deck as any;
    expect(deck.theme.name).toBe("Dark");
    expect(deck.motion.preset).toBe("punchy");
    expect(deck.motion.slides).toHaveLength(1);
  });

  it("imports a local image file and appends an image block", async () => {
    const client = await connect();
    const created = await call(client, "create_deck_from_cards", {
      title: "Pics",
      cards: [{ title: "Cover", content: ["Hi"] }],
    });
    const deckId = created.body.deckId as string;

    const file = path.join(dataDir, "logo.png");
    writeFileSync(file, TINY_PNG);

    const added = await call(client, "add_image", {
      deckId,
      source: { path: file },
      caption: "Logo",
      layout: "side",
    });
    expect(added.isError).toBe(false);
    const assetUrl = added.body.url as string;
    expect(assetUrl).toMatch(new RegExp(`^/api/deck/${deckId}/assets/[0-9a-f-]+$`));

    // Bytes were copied into the data dir, sniffed as PNG.
    const files = readdirSync(path.join(dataDir, "assets", deckId));
    expect(files).toHaveLength(1);
    expect(files[0].endsWith(".png")).toBe(true);
    expect(readFileSync(path.join(dataDir, "assets", deckId, files[0])).equals(TINY_PNG)).toBe(true);

    const got = await call(client, "get_deck", { deckId });
    const blocks = (got.body.deck as any).cards[0].blocks as any[];
    expect(blocks.find((b) => b.type === "image")).toEqual({
      type: "image",
      src: assetUrl,
      caption: "Logo",
      layout: "side",
    });
  });

  it("downloads a remote image through add_image", async () => {
    const client = await connect();
    const created = await call(client, "create_deck_from_cards", {
      title: "Remote",
      cards: [{ title: "A" }],
    });
    const deckId = created.body.deckId as string;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(TINY_PNG, {
        status: 200,
        headers: { "content-type": "image/png" },
      })),
    );
    const added = await call(client, "add_image", {
      deckId,
      source: { url: "https://example.com/pic.png" },
    });
    expect(added.isError).toBe(false);
    expect(readdirSync(path.join(dataDir, "assets", deckId))).toHaveLength(1);
  });

  it("caps a chunked remote image that lies about its size", async () => {
    const client = await connect();
    const created = await call(client, "create_deck_from_cards", {
      title: "Flood",
      cards: [{ title: "A" }],
    });
    const deckId = created.body.deckId as string;

    // No Content-Length (chunked) and an endless body: the cap must cut the
    // read off mid-stream instead of buffering it.
    const chunk = new Uint8Array(1024 * 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(chunk);
          },
        }),
        { status: 200, headers: { "content-type": "image/png" } },
      )),
    );
    const added = await call(client, "add_image", {
      deckId,
      source: { url: "https://example.com/huge.png" },
    });
    expect(added.isError).toBe(true);
    expect(String(added.body.error)).toContain("image too large");
  });

  it("appends cards to an existing deck", async () => {
    const client = await connect();
    const created = await call(client, "create_deck_from_cards", {
      title: "Grow",
      cards: [{ title: "One", content: ["a"] }],
    });
    const deckId = created.body.deckId as string;

    const added = await call(client, "add_cards", {
      deckId,
      cards: [{ title: "Two", content: ["b", "c"] }, { title: "Three" }],
    });
    expect(added.isError).toBe(false);

    const got = await call(client, "get_deck", { deckId });
    const deck = got.body.deck as any;
    expect(deck.cards.map((c: any) => c.title)).toEqual(["One", "Two", "Three"]);
    expect(deck.cards[1].status).toBe("ready");
    expect(deck.cards[2].status).toBe("pending"); // content omitted: outline-only
  });

  it("re-derives the motion plan when cards are appended to a ready deck", async () => {
    const client = await connect();
    const created = await call(client, "create_deck_from_cards", {
      title: "Grow animated",
      cards: [{ title: "One", content: ["a"] }],
      motion: "subtle",
    });
    const deckId = created.body.deckId as string;

    const before = await call(client, "get_deck", { deckId });
    expect((before.body.deck as any).motion.slides).toHaveLength(1);

    const added = await call(client, "add_cards", {
      deckId,
      cards: [{ title: "Two", content: ["b"] }, { title: "Three", content: ["c"] }],
    });
    expect(added.isError).toBe(false);

    // The appended cards animate too: the stored plan never lags the cards.
    const after = await call(client, "get_deck", { deckId });
    const motion = (after.body.deck as any).motion;
    expect(motion.preset).toBe("subtle");
    expect(motion.slides).toHaveLength(3);
  });

  it("exports a deck to a .pptx file on disk", async () => {
    const client = await connect();
    const created = await call(client, "create_deck_from_cards", {
      title: "Export Me",
      cards: [
        { title: "One", content: ["hello"] },
        { title: "Two", content: ["world"] },
      ],
      motion: "cinematic",
    });
    const deckId = created.body.deckId as string;

    const out = await call(client, "export_deck", { deckId, format: "pptx" });
    expect(out.isError).toBe(false);
    const file = out.body.path as string;
    expect(path.isAbsolute(file)).toBe(true);
    expect(file.startsWith(path.join(dataDir, "exports"))).toBe(true);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file).subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it.skipIf(!pptagentAvailable)(
    "exports a deck through the PPTAgent HTML engine",
    async () => {
      const client = await connect();
      const created = await call(client, "create_deck_from_cards", {
        title: "HTML Engine",
        cards: [
          { title: "Cover", content: ["intro line"] },
          { title: "Body", content: ["middle line"] },
          { title: "Close", content: ["final line"] },
        ],
      });
      const deckId = created.body.deckId as string;

      const out = await call(client, "export_deck", {
        deckId,
        format: "pptx",
        engine: "pptagent",
      });
      expect(out.isError).toBe(false);
      expect(out.body.engine).toBe("pptagent");
      const file = out.body.path as string;
      expect(file).toContain("PPTAgent");
      expect(existsSync(file)).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
      // Native text runs prove the converter produced shapes, not a raster.
      expect(bytes.includes(Buffer.from("<a:t>Cover</a:t>"))).toBe(true);
    },
    120_000,
  );

  it("answers unknown decks and themes with an error envelope", async () => {
    const client = await connect();

    const missing = await call(client, "get_deck", { deckId: "nope" });
    expect(missing.isError).toBe(true);
    expect(missing.body.ok).toBe(false);
    expect(String(missing.body.error)).toContain("deck not found");

    const created = await call(client, "create_deck_from_cards", {
      title: "T",
      cards: [{ title: "A" }],
    });
    const badTheme = await call(client, "set_theme", {
      deckId: created.body.deckId,
      theme: "NoSuchTheme",
    });
    expect(badTheme.isError).toBe(true);
    expect(String(badTheme.body.error)).toContain("unknown theme");
  });

  it("creates an extraordinary Gamma deck with 3D motion and direct PPTX export in one call", async () => {
    // No external pump: the server's in-process worker finishes the queued
    // outline + cards jobs while the tool waits.
    const client = await connect({ waitTimeoutMs: 9000, pollMs: 10 });
    const result = await call(client, "create_gamma_deck", {
      prompt: "Next-Gen Quantum Computing",
      numCards: 3,
      theme: "cyberpunk",
      motion: "3d",
      exportFormat: "pptx",
    });
    expect(result.isError).toBe(false);
    expect(result.body.status).toBe("ready");
    expect(result.body.motion).toBe("3d");
    expect((result.body.cards as unknown[]).length).toBe(3);
    expect(result.body.exportPath).toBeDefined();

    const exportFile = result.body.exportPath as string;
    expect(existsSync(exportFile)).toBe(true);
    expect(readFileSync(exportFile).subarray(0, 2).toString("latin1")).toBe("PK");

    // Inspect the deck: verify cards contain rich blocks including images and stats
    const got = await call(client, "get_deck", { deckId: result.body.deckId });
    const deck = got.body.deck as any;
    expect(deck.motion.preset).toBe("3d");
    expect(deck.cards).toHaveLength(3);
    // Cover card carries a curated online image and rich blocks
    const coverBlocks = deck.cards[0].blocks;
    expect(coverBlocks.some((b: any) => b.type === "image" && b.src.startsWith("https://images.unsplash.com/"))).toBe(true);
  });
});
