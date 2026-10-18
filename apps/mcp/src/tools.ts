import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { desc, eq, inArray, count } from "drizzle-orm";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildPptxBuffer,
  buildThemePotxBuffer,
  collectSlideImages,
  renderPrintHtml,
  renderSlidesHtml,
  type PrintFormat,
} from "@carddeck/pptx";
import {
  parseMotionPlan,
  planMotionForDeck,
  type Block,
  type MotionPreset,
  type SlideMotion,
} from "@carddeck/core";
import { getDb, resolveDataDir } from "../../web/lib/db";
import * as t from "../../web/drizzle/schema";
import { enqueueJob } from "../../web/lib/queue";
import {
  assetPublicUrl,
  isAcceptedImageMime,
  MAX_ASSET_BYTES,
  saveAsset,
} from "../../web/lib/assets";
import {
  createImageResolver,
  exportFilename,
  loadSlideInputs,
  motionForExport,
} from "../../web/lib/export-slides";
import { seedPresetThemes } from "../../web/lib/themes-presets";
import { ensureAgentUser } from "./agent-user";
import { DEFAULT_WAIT_TIMEOUT_MS, waitForDeckStatus, type WaitOptions } from "./wait";

/**
 * The Carddeck MCP tool surface.
 *
 * A stdio Model Context Protocol server that lets an agent (OpenCode, Claude
 * Code, Codex, …) build and export real Carddeck presentations: it shares the
 * app database and data directory, so decks created here open in the web
 * editor and export with the same renderers. There is no HTTP hop and no
 * session: a local stdio server is exactly as trusted as the worker process.
 *
 * Every tool answers with one text content item carrying a JSON envelope:
 * `{ ok: true, … }` on success, `{ ok: false, error }` — plus `isError: true`
 * — on failure. Handlers never throw across the protocol boundary.
 */

// ── shared constants ────────────────────────────────────────────────────────

const FORMATS = ["presentation", "document"] as const;
const MOTION_PRESETS = ["none", "subtle", "punchy", "cinematic"] as const;
const LAYOUTS = ["full", "side", "behind"] as const;
const EXPORT_FORMATS = ["pptx", "pdf", "potx"] as const;
const MAX_CARDS = 30;
const MAX_PROMPT_CHARS = 4000;
const MAX_TONE_CHARS = 200;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const firstLine = (err: unknown): string =>
  err instanceof Error ? err.message.split("\n")[0] : String(err);

// ── envelopes ───────────────────────────────────────────────────────────────

type Envelope = { ok: boolean } & Record<string, unknown>;

function envOk(data: Record<string, unknown>): Envelope {
  return { ...data, ok: true };
}

function envFail(error: string, extra: Record<string, unknown> = {}): Envelope {
  return { ...extra, ok: false, error };
}

interface ToolResponse {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function toResponse(env: Envelope): ToolResponse {
  const text = JSON.stringify(env);
  return env.ok
    ? { content: [{ type: "text", text }] }
    : { content: [{ type: "text", text }], isError: true };
}

/** Wrap a handler so expectations become envelopes and thrown errors a fail. */
function guarded<A extends Record<string, unknown>>(fn: (args: A) => Promise<Envelope>) {
  return async (args: A): Promise<ToolResponse> => {
    try {
      return toResponse(await fn(args));
    } catch (err) {
      return toResponse(envFail(err instanceof Error ? err.message : String(err)));
    }
  };
}

// ── small helpers over the shared web libs ──────────────────────────────────

async function requireDeck(deckId: string) {
  const deck = await getDb().query.deck.findFirst({
    where: (d, { eq }) => eq(d.id, deckId),
  });
  if (!deck) throw new Error(`deck not found: ${deckId}`);
  return deck;
}

async function cardsOf(deckId: string) {
  return getDb().query.card.findMany({
    where: (c, { eq }) => eq(c.deckId, deckId),
    orderBy: (c, { asc }) => asc(c.position),
  });
}

/** Parse a card's stored blocks JSON; tolerate null/corrupt rows. */
function parseBlocks(raw: string): Block[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Block[]) : [];
  } catch {
    return [];
  }
}

/** One paragraph block per content line. */
function contentBlocks(content?: readonly string[]): Block[] {
  return (content ?? []).map((line) => ({ type: "paragraph", text: [line] }));
}

/**
 * Read-only share link for a deck, or null when it is private.
 *
 * MCP decks are owned by a headless account, so the owner-only editor path
 * would 404 for the human; `/view/<slug>` is the one URL that opens for them.
 */
function urlForDeck(deck: { isPublic: number; shareSlug: string | null }): string | null {
  return deck.isPublic === 1 && deck.shareSlug ? `/view/${deck.shareSlug}` : null;
}

/**
 * Decks created over MCP are born shared read-only: the agent account cannot
 * log a browser in, so an unshared deck would be reachable only through
 * `export_deck` files. 64 bits of slug entropy; there is deliberately no
 * MCP tool to unpublish (the web share toggle is owner-gated, and the human
 * is not the agent user).
 */
function shareFields(): { isPublic: number; shareSlug: string } {
  return { isPublic: 1, shareSlug: randomBytes(8).toString("hex") };
}

/** Resolve a theme by id or by name (preset names seeded on first use). */
async function resolveThemeId(nameOrId?: string): Promise<string> {
  await seedPresetThemes();
  const db = getDb();
  if (nameOrId) {
    const byId = await db.query.theme.findFirst({
      where: (th, { eq }) => eq(th.id, nameOrId),
    });
    if (byId) return byId.id;
    const byName = await db.query.theme.findFirst({
      where: (th, { eq }) => eq(th.name, nameOrId),
    });
    if (byName) return byName.id;
    throw new Error(`unknown theme: ${nameOrId}`);
  }
  const preset = await db.query.theme.findFirst({
    where: (th, { eq }) => eq(th.isPreset, 1),
  });
  if (!preset) throw new Error("no preset themes available");
  return preset.id;
}

/** Sniff an image's real type from its magic bytes (raster formats only). */
function sniffImageMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return "image/gif";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Fall back to the file extension when magic bytes say nothing. */
function mimeFromExtension(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return null;
}

// ── schemas ─────────────────────────────────────────────────────────────────

const cardInput = z.object({
  title: z.string().min(1).describe("Card title"),
  content: z
    .array(z.string())
    .optional()
    .describe("Content lines; each becomes a paragraph block (omit for an empty outline card)"),
});

const motionField = z.enum(MOTION_PRESETS).optional().describe("Animation preset");

const createDeckSchema = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT_CHARS).describe("What the presentation is about"),
  numCards: z.number().int().min(1).max(MAX_CARDS).optional().describe("Number of cards (default 8)"),
  format: z.enum(FORMATS).optional().describe("Slide format (default presentation)"),
  tone: z.string().max(MAX_TONE_CHARS).optional().describe("Writing tone, e.g. 'confident, concise'"),
  theme: z.string().optional().describe("Theme preset name or id (default: first preset)"),
  motion: motionField,
});

const createDeckFromCardsSchema = z.object({
  title: z.string().min(1).describe("Deck title"),
  cards: z.array(cardInput).min(1).describe("Cards in slide order"),
  theme: z.string().optional().describe("Theme preset name or id"),
  motion: motionField,
});

const addCardsSchema = z.object({
  deckId: z.string().describe("Deck id"),
  cards: z.array(cardInput).min(1).describe("Cards to append, in order"),
});

const deckIdSchema = z.object({ deckId: z.string().describe("Deck id") });

const setThemeSchema = z.object({
  deckId: z.string().describe("Deck id"),
  theme: z.string().describe("Theme preset name (e.g. 'Light', 'Dark', 'Midnight') or theme id"),
});

const setMotionSchema = z.object({
  deckId: z.string().describe("Deck id"),
  preset: z.enum(MOTION_PRESETS).describe("Animation preset"),
});

const addImageSchema = z.object({
  deckId: z.string().describe("Deck id"),
  source: z
    .union([z.object({ url: z.string() }), z.object({ path: z.string() })])
    .describe("Where the image comes from: an http(s) URL or a local file path"),
  cardId: z.string().optional().describe("Target card (default: first card)"),
  caption: z.string().optional().describe("Image caption"),
  layout: z.enum(LAYOUTS).optional().describe("Image layout (default full)"),
});

const exportDeckSchema = z.object({
  deckId: z.string().describe("Deck id"),
  format: z.enum(EXPORT_FORMATS).describe("Export format: pptx, pdf, or potx"),
  outDir: z.string().optional().describe("Output directory (default: <DATA_DIR>/exports)"),
});

// ── server ──────────────────────────────────────────────────────────────────

export interface ServerOptions {
  /** Override the generation wait deadline (tests inject short ones). */
  waitTimeoutMs?: number;
  /** Override the poll interval while waiting on the DB. */
  pollMs?: number;
}

/**
 * Build the MCP server with every tool registered and the agent account
 * provisioned. Callers connect it to a transport (stdio in production,
 * in-memory pairs in tests).
 */
export async function createServer(opts: ServerOptions = {}): Promise<McpServer> {
  const waits: WaitOptions = { timeoutMs: opts.waitTimeoutMs, pollMs: opts.pollMs };
  const server = new McpServer({ name: "carddeck", version: "0.1.0" });

  server.registerTool(
    "create_deck",
    {
      title: "Create deck",
      description:
        "Generate a complete presentation from a prompt: outline, content, theme, and animation. Requires the Carddeck worker process; waits for generation and returns the deck id, its read-only share link, and card titles.",
      inputSchema: createDeckSchema.shape,
    },
    guarded(async (args: z.infer<typeof createDeckSchema>) => {
      const userId = await ensureAgentUser();
      const themeId = await resolveThemeId(args.theme);
      const format = args.format ?? "presentation";
      const numCards = args.numCards ?? 8;
      const db = getDb();

      const [deck] = await db
        .insert(t.deck)
        .values({
          userId,
          title: args.prompt.trim().slice(0, 100),
          format,
          themeId,
          // The whole pipeline is enqueued now: generating from the first
          // moment (mirrors the HTTP routes' flip before the first poll).
          status: "generating",
          ...shareFields(),
          motion:
            args.motion === undefined ? null : JSON.stringify({ preset: args.motion, slides: [] }),
        })
        .returning();

      await enqueueJob(deck.id, "outline", {
        prompt: args.prompt.trim(),
        numCards,
        ...(args.tone ? { tone: args.tone } : {}),
        format,
      });
      // `claimNextJob` orders by `created_at` milliseconds. Both stages are
      // enqueued up front so a worker that starts later still finishes the
      // whole deck; back-to-back inserts can share a millisecond, so yield a
      // tick to make the outline job strictly older — it must be claimed
      // first, or cards would generate from an empty skeleton.
      await sleep(5);
      await enqueueJob(deck.id, "cards", { format });

      const settled = await waitForDeckStatus(deck.id, ["ready", "error"], waits);
      const cards = await cardsOf(deck.id);
      const cardList = cards.map((c) => ({ id: c.id, title: c.title }));

      if (!settled) {
        const current = await requireDeck(deck.id);
        return envOk({
          deckId: deck.id,
          url: urlForDeck(current),
          status: current.status,
          cards: cardList,
          note: "generation is still running; make sure the Carddeck worker is up (`npm run dev` or `npm run start -w apps/worker`), then call get_deck again",
        });
      }
      if (settled.status === "error") {
        const failed = await db.query.generationJob.findFirst({
          where: (j, { and, eq }) => and(eq(j.deckId, deck.id), eq(j.status, "error")),
          orderBy: (j, { desc }) => desc(j.updatedAt),
        });
        return envFail(failed?.error ? `generation failed: ${failed.error}` : "generation failed", {
          deckId: deck.id,
          url: urlForDeck(deck),
          status: "error",
        });
      }

      return envOk({
        deckId: deck.id,
        url: urlForDeck(deck),
        status: "ready",
        cards: cardList,
      });
    }),
  );

  server.registerTool(
    "create_deck_from_cards",
    {
      title: "Create deck from cards",
      description:
        "Create a ready-to-present deck from card content you provide — no AI generation, no waiting. Each content line becomes a paragraph block. Returns the deck id and its read-only share link.",
      inputSchema: createDeckFromCardsSchema.shape,
    },
    guarded(async (args: z.infer<typeof createDeckFromCardsSchema>) => {
      const userId = await ensureAgentUser();
      const themeId = await resolveThemeId(args.theme);
      const db = getDb();

      const [deck] = await db
        .insert(t.deck)
        .values({
          userId,
          title: args.title.trim(),
          format: "presentation",
          themeId,
          status: "ready",
          ...shareFields(),
        })
        .returning();

      const inserted = await db
        .insert(t.card)
        .values(
          args.cards.map((card, i) => ({
            deckId: deck.id,
            position: i,
            title: card.title,
            intent: i === 0 ? "cover" : i === args.cards.length - 1 ? "close" : "body",
            blocks: JSON.stringify(contentBlocks(card.content)),
            status: "ready",
          })),
        )
        .returning({ id: t.card.id, title: t.card.title, blocks: t.card.blocks });

      if (args.motion !== undefined) {
        // The deck is ready now, so the plan is derivable immediately (the
        // same deterministic expansion the worker and the deck PATCH use).
        const slides =
          args.motion === "none"
            ? []
            : planMotionForDeck(
                args.motion,
                inserted.map((c) => ({ blocks: c.blocks })),
                deck.id,
              ).slides;
        await db
          .update(t.deck)
          .set({ motion: JSON.stringify({ preset: args.motion, slides }), updatedAt: Date.now() })
          .where(eq(t.deck.id, deck.id));
      }

      return envOk({
        deckId: deck.id,
        url: urlForDeck(deck),
        status: "ready",
        cards: inserted.map((c) => ({ id: c.id, title: c.title })),
      });
    }),
  );

  server.registerTool(
    "add_cards",
    {
      title: "Add cards",
      description:
        "Append cards to an existing deck. Cards with content are ready immediately; cards without content are added as empty outline cards.",
      inputSchema: addCardsSchema.shape,
    },
    guarded(async (args: z.infer<typeof addCardsSchema>) => {
      const deck = await requireDeck(args.deckId);
      const db = getDb();
      const existing = await cardsOf(deck.id);
      const nextPosition =
        existing.length === 0 ? 0 : Math.max(...existing.map((c) => c.position)) + 1;

      const inserted = await db
        .insert(t.card)
        .values(
          args.cards.map((card, i) => ({
            deckId: deck.id,
            position: nextPosition + i,
            title: card.title,
            intent: "body",
            blocks: JSON.stringify(contentBlocks(card.content)),
            status: card.content?.length ? "ready" : "pending",
          })),
        )
        .returning({ id: t.card.id, title: t.card.title, status: t.card.status });

      await db.update(t.deck).set({ updatedAt: Date.now() }).where(eq(t.deck.id, deck.id));

      const pending = inserted.filter((c) => c.status === "pending").length;
      return envOk({
        deckId: deck.id,
        url: urlForDeck(deck),
        added: inserted,
        ...(pending > 0
          ? {
              note: `${pending} card(s) have no content yet — they render no blocks until generated or edited in the web editor`,
            }
          : {}),
      });
    }),
  );

  server.registerTool(
    "get_deck",
    {
      title: "Get deck",
      description: "Fetch a deck: title, status, theme, motion plan, and cards with parsed blocks.",
      inputSchema: deckIdSchema.shape,
    },
    guarded(async (args: z.infer<typeof deckIdSchema>) => {
      const deck = await requireDeck(args.deckId);
      const db = getDb();
      const [cards, themeRow] = await Promise.all([
        cardsOf(deck.id),
        db.query.theme.findFirst({ where: (th, { eq }) => eq(th.id, deck.themeId) }),
      ]);
      return envOk({
        deck: {
          deckId: deck.id,
          title: deck.title,
          format: deck.format,
          status: deck.status,
          url: urlForDeck(deck),
          isPublic: deck.isPublic === 1,
          shareSlug: deck.shareSlug,
          theme: themeRow ? { id: themeRow.id, name: themeRow.name } : null,
          motion: parseMotionPlan(deck.motion),
          cards: cards.map((c) => ({
            id: c.id,
            title: c.title,
            status: c.status,
            blocks: parseBlocks(c.blocks),
          })),
        },
      });
    }),
  );

  server.registerTool(
    "list_decks",
    {
      title: "List decks",
      description: "List the decks owned by the Carddeck agent user, newest first.",
      inputSchema: {},
    },
    guarded(async () => {
      const userId = await ensureAgentUser();
      const db = getDb();
      const decks = await db.query.deck.findMany({
        where: (d, { eq }) => eq(d.userId, userId),
        orderBy: (d, { desc }) => desc(d.updatedAt),
      });
      const ids = decks.map((d) => d.id);
      const counts = new Map<string, number>();
      if (ids.length > 0) {
        const rows = await db
          .select({ deckId: t.card.deckId, n: count() })
          .from(t.card)
          .where(inArray(t.card.deckId, ids))
          .groupBy(t.card.deckId);
        for (const row of rows) counts.set(row.deckId, Number(row.n));
      }
      return envOk({
        decks: decks.map((d) => ({
          deckId: d.id,
          title: d.title,
          status: d.status,
          cardCount: counts.get(d.id) ?? 0,
          updatedAt: d.updatedAt,
        })),
      });
    }),
  );

  server.registerTool(
    "set_theme",
    {
      title: "Set theme",
      description: "Set the deck's theme by preset name (e.g. 'Light', 'Dark', 'Midnight') or by id.",
      inputSchema: setThemeSchema.shape,
    },
    guarded(async (args: z.infer<typeof setThemeSchema>) => {
      const deck = await requireDeck(args.deckId);
      const themeId = await resolveThemeId(args.theme);
      const db = getDb();
      await db
        .update(t.deck)
        .set({ themeId, updatedAt: Date.now() })
        .where(eq(t.deck.id, deck.id));
      const row = await db.query.theme.findFirst({ where: (th, { eq }) => eq(th.id, themeId) });
      return envOk({ deckId: deck.id, theme: { id: themeId, name: row?.name ?? args.theme } });
    }),
  );

  server.registerTool(
    "set_motion",
    {
      title: "Set motion",
      description:
        "Set the deck's animation preset (none, subtle, punchy, cinematic). The plan is derived server-side and drives both the web present mode and the animations inside the exported .pptx.",
      inputSchema: setMotionSchema.shape,
    },
    guarded(async (args: z.infer<typeof setMotionSchema>) => {
      const deck = await requireDeck(args.deckId);
      let slides: SlideMotion[] = [];
      if (args.preset !== "none" && deck.status === "ready") {
        // A ready deck animates the moment the preset lands (mirrors the deck
        // PATCH route). A deck still generating keeps an empty plan; the
        // worker fills the slides once its cards settle.
        const cards = await cardsOf(deck.id);
        slides = planMotionForDeck(
          args.preset,
          cards.map((c) => ({ blocks: c.blocks })),
          deck.id,
        ).slides;
      }
      const db = getDb();
      await db
        .update(t.deck)
        .set({ motion: JSON.stringify({ preset: args.preset, slides }), updatedAt: Date.now() })
        .where(eq(t.deck.id, deck.id));
      return envOk({ deckId: deck.id, preset: args.preset, slides: slides.length });
    }),
  );

  server.registerTool(
    "add_image",
    {
      title: "Add image",
      description:
        "Attach an image to a card, from a local file path or an http(s) URL. The image is copied into Carddeck's data directory (max 10MB; png/jpeg/webp/gif) and becomes part of the deck and its exports.",
      inputSchema: addImageSchema.shape,
    },
    guarded(async (args: z.infer<typeof addImageSchema>) => {
      const deck = await requireDeck(args.deckId);
      const cards = await cardsOf(deck.id);
      const target = args.cardId ? cards.find((c) => c.id === args.cardId) : cards[0];
      if (!target) {
        throw new Error(
          args.cardId
            ? `card not found in deck: ${args.cardId}`
            : `deck ${deck.id} has no cards to add an image to`,
        );
      }

      let bytes: Uint8Array;
      let mime: string;
      let originalName: string | undefined;

      if ("url" in args.source) {
        if (!/^https?:\/\//i.test(args.source.url)) {
          throw new Error("source.url must be an http(s) URL");
        }
        const url = args.source.url;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(5000),
          redirect: "follow",
        }).catch(() => {
          throw new Error(`could not download image: ${url}`);
        });
        if (!res.ok) throw new Error(`could not download image (HTTP ${res.status})`);
        const header = (res.headers.get("content-type") ?? "").split(";")[0].trim();
        if (!isAcceptedImageMime(header)) {
          throw new Error(`unsupported image type: ${header || "unknown"}`);
        }
        bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error("image too large (max 10MB)");
        mime = header;
        originalName = path.basename(new URL(url).pathname) || undefined;
      } else {
        const resolved = path.resolve(args.source.path);
        const stat = await fs.stat(resolved).catch(() => null);
        if (!stat?.isFile()) throw new Error(`file not found: ${args.source.path}`);
        if (stat.size > MAX_ASSET_BYTES) throw new Error("image too large (max 10MB)");
        bytes = new Uint8Array(await fs.readFile(resolved));
        // Trust the bytes over the name: magic first, extension as a fallback.
        const detected = sniffImageMime(bytes) ?? mimeFromExtension(resolved);
        if (!detected || !isAcceptedImageMime(detected)) {
          throw new Error("unsupported image type (accepted: png, jpeg, webp, gif)");
        }
        mime = detected;
        originalName = path.basename(resolved);
      }

      const stored = await saveAsset(deck.id, bytes, mime, originalName);

      const block = {
        type: "image" as const,
        src: assetPublicUrl(deck.id, stored.assetId),
        layout: args.layout ?? ("full" as const),
        ...(args.caption ? { caption: args.caption } : {}),
      };
      const blocks = parseBlocks(target.blocks);
      blocks.push(block);
      const db = getDb();
      await db
        .update(t.card)
        .set({ blocks: JSON.stringify(blocks) })
        .where(eq(t.card.id, target.id));

      return envOk({
        deckId: deck.id,
        cardId: target.id,
        assetId: stored.assetId,
        url: block.src,
        bytes: stored.sizeBytes,
        block,
      });
    }),
  );

  server.registerTool(
    "export_deck",
    {
      title: "Export deck",
      description:
        "Render the deck to a file on disk: pptx (PowerPoint, with the deck's animations), pdf (headless Chromium), or potx (theme template). Returns the absolute output path.",
      inputSchema: exportDeckSchema.shape,
    },
    guarded(async (args: z.infer<typeof exportDeckSchema>) => {
      const data = await loadSlideInputs(args.deckId);
      if (!data) throw new Error(`deck not found: ${args.deckId}`);
      if (data.cards.length === 0) throw new Error("deck has no ready cards to export");

      const dir = args.outDir
        ? path.resolve(args.outDir)
        : path.join(resolveDataDir(), "exports");
      await fs.mkdir(dir, { recursive: true });
      const outPath = path.join(dir, exportFilename(data.title, args.format));

      let buffer: Uint8Array;
      if (args.format === "pptx") {
        // Images ride into pptxgenjs as bytes, so the slide HTML omits image
        // markup (same contract as the web route).
        const images = data.cards.map((card) => collectSlideImages(card.blocks));
        const hasImages = images.some((list) => list.length > 0);
        const slides = await renderSlidesHtml({ title: data.title, theme: data.theme }, data.cards, {
          imageMode: hasImages ? "omit" : "placeholder",
        });
        buffer = await buildPptxBuffer(slides, {
          resolveImage: createImageResolver(args.deckId),
          images,
          motion: motionForExport(data.motion, slides.length),
        });
      } else if (args.format === "pdf") {
        const { chromium } = await import("playwright");
        let browser: Awaited<ReturnType<typeof chromium.launch>>;
        try {
          browser = await chromium.launch();
        } catch (err) {
          throw new Error(
            `PDF export unavailable: ${firstLine(err)}. Run 'npx playwright install chromium'.`,
          );
        }
        try {
          const page = await browser.newPage();
          const html = await renderPrintHtml({ title: data.title, theme: data.theme }, data.cards, {
            format: (data.format === "document" ? "document" : "presentation") as PrintFormat,
            resolveImage: createImageResolver(args.deckId),
          });
          await page.setContent(html, { waitUntil: "load" });
          buffer = await page.pdf({ printBackground: true, preferCSSPageSize: true });
        } finally {
          await browser.close().catch(() => undefined);
        }
      } else {
        buffer = await buildThemePotxBuffer(data.theme);
      }

      await fs.writeFile(outPath, buffer);
      return envOk({ deckId: args.deckId, format: args.format, path: outPath, bytes: buffer.byteLength });
    }),
  );

  // Boot provisioning: fail fast on a broken data dir rather than on the
  // agent's first tool call.
  await ensureAgentUser();
  return server;
}

export { DEFAULT_WAIT_TIMEOUT_MS };
