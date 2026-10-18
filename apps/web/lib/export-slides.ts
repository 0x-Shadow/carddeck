// Relative imports, not the `@/` alias: the worker and MCP server reach this
// module from other workspaces (see their relative-import convention).
import { getDb } from "./db";
import * as t from "../drizzle/schema";
import { asc, eq } from "drizzle-orm";
import { rowToTheme } from "./themes-presets";
import { readAssetDataUrl, MAX_ASSET_BYTES } from "./assets";
import { PRESET_THEMES, parseMotionPlan, type Block, type MotionPlan, type Theme } from "@carddeck/core";
import type { SlideInput, ImageResolver, ResolvedImage } from "@carddeck/pptx";

/**
 * Shared export data layer.
 *
 * The HTTP export routes and the MCP agent server both need the same two
 * things: a deck's ready cards as slide inputs, and an image resolver that
 * turns block `src` values into bytes. This module is the single home for
 * both, so the two front doors into the product cannot drift.
 */

export interface ExportDeckData {
  id: string;
  title: string;
  /** "presentation" | "document" — selects the PDF page geometry. */
  format: string;
  theme: Theme;
  cards: SlideInput[];
  /** The deck's motion plan, when one is stored and valid. */
  motion: MotionPlan | null;
}

/**
 * Load a deck's ready cards + theme for export. Access control is the
 * caller's job: routes enforce it via `loadExportableDeck`, and the MCP
 * server is a trusted local process. Returns null for a missing deck.
 */
export async function loadSlideInputs(
  deckId: string,
): Promise<ExportDeckData | null> {
  const db = getDb();
  const deck = await db.query.deck.findFirst({ where: (d, { eq }) => eq(d.id, deckId) });
  if (!deck) return null;

  const [cards, themeRow] = await Promise.all([
    db.query.card.findMany({
      where: (c, { and, eq }) => and(eq(c.deckId, deckId), eq(c.status, "ready")),
      orderBy: (c, { asc }) => asc(c.position),
    }),
    db.query.theme.findFirst({ where: (th, { eq }) => eq(th.id, deck.themeId) }),
  ]);

  return {
    id: deck.id,
    title: deck.title,
    format: deck.format,
    theme: rowToTheme(themeRow) ?? PRESET_THEMES[0],
    cards: cards.map((c) => ({
      id: c.id,
      title: c.title,
      blocks: parseBlocks(c.blocks),
    })),
    motion: parseMotionPlan(deck.motion),
  };
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

/** Only these schemes are ever fetched; everything else (file:, data:, …) is refused. */
const REMOTE_IMAGE_TIMEOUT_MS = 5000;
const IMAGE_MIME_RE = /^image\/[a-z0-9.+-]+$/i;

/** Fetch a remote image into a data URL, with SSRF/size/time limits. */
function fetchRemoteImage(src: string): Promise<ResolvedImage | null> {
  return (async () => {
    const res = await fetch(src, {
      signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!IMAGE_MIME_RE.test(mime)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > MAX_ASSET_BYTES) return null;
    return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}`, mime };
  })().catch(() => null);
}

/**
 * An image resolver for a deck.
 *
 * - Local assets (`/api/deck/<deckId>/assets/<assetId>`) are read from disk —
 *   cross-deck ids resolve to null.
 * - http(s) URLs are fetched once, capped at 5 s / 10 MB / `image/*`.
 * - Every other scheme (`file:`, `data:`, `javascript:`, …) returns null
 *   without a network call.
 *
 * Null flows into the exporters' captioned-placeholder fallback, so an
 * export never fails because of one bad image.
 */
export function createImageResolver(deckId: string): ImageResolver {
  return async (src: string): Promise<ResolvedImage | null> => {
    const local = /^\/api\/deck\/([^/]+)\/assets\/([A-Za-z0-9-]+)$/.exec(src);
    if (local) {
      if (local[1] !== deckId) return null;
      const dataUrl = await readAssetDataUrl(local[1], local[2]);
      if (!dataUrl) return null;
      const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
      return { dataUrl, mime };
    }
    if (/^https?:\/\//i.test(src)) return fetchRemoteImage(src);
    return null;
  };
}

/**
 * The motion plan a renderer (HTTP route or MCP tool) should inject: the plan
 * sliced to the slides actually being exported (unready cards drop out), or
 * `undefined` when the deck has no plan or the operator disabled injection
 * via `CARDDECK_MOTION=off`. One home for this policy so both front doors
 * honor the same kill switch.
 */
export function motionForExport(
  motion: MotionPlan | null,
  slideCount: number,
): MotionPlan | undefined {
  if (process.env.CARDDECK_MOTION === "off" || !motion) return undefined;
  return { ...motion, slides: motion.slides.slice(0, slideCount) };
}

/** Filesystem/content-type-safe download or export name. */
export function exportFilename(title: string, ext: string): string {
  const clean = title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
  return `${clean || "deck"}.${ext}`;
}
