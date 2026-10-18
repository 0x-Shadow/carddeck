// Relative imports, not the `@/` alias: the worker and MCP server reach this
// module from other workspaces (see their relative-import convention).
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { getDb } from "./db";
import * as t from "../drizzle/schema";
import { rowToTheme } from "./themes-presets";
import { readAssetDataUrl, MAX_ASSET_BYTES, sniffImageMime } from "./assets";
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
const MAX_REDIRECTS = 3;

function isPublicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

async function publicAddressFor(url: URL): Promise<string | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== defaultPort) return null;
  if (url.username || url.password) return null;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPublicIpv4(host) ? host : null;
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return null;
  }
  const addresses = await lookup(host, { all: true, verbatim: true }).catch(() => []);
  const ipv4 = addresses.filter((entry) => entry.family === 4);
  if (!ipv4.length || ipv4.some((entry) => !isPublicIpv4(entry.address))) return null;
  return ipv4[0].address;
}

/** Fetch remote image bytes only after validating and pinning a public IPv4. */
function fetchRemoteImage(src: string, address: string): Promise<ResolvedImage | null> {
  return (async () => {
    const deadline = Date.now() + REMOTE_IMAGE_TIMEOUT_MS;
    const fetchAt = async (
      url: URL,
      pinnedAddress: string,
      redirects: number,
    ): Promise<ResolvedImage | null> => {
      if (Date.now() >= deadline) return null;
      const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
      return new Promise((resolve) => {
        const req = transport({
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          headers: { accept: "image/png,image/jpeg,image/webp,image/gif" },
          agent: false,
          servername: isIP(url.hostname) ? undefined : url.hostname,
          lookup: (_hostname, _options, callback) => callback(null, pinnedAddress, 4),
        }, (res) => {
          const status = res.statusCode ?? 0;
          const location = res.headers.location;
          if (status >= 300 && status < 400 && location && redirects < MAX_REDIRECTS) {
            res.resume();
            const nextUrl = new URL(location, url);
            void publicAddressFor(nextUrl)
              .then((nextAddress) => nextAddress
                ? fetchAt(nextUrl, nextAddress, redirects + 1)
                : null)
              .then(resolve, () => resolve(null));
            return;
          }
          if (status < 200 || status >= 300) {
            res.resume();
            resolve(null);
            return;
          }
          const declared = Number(res.headers["content-length"] ?? 0);
          if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES) {
            res.destroy();
            resolve(null);
            return;
          }
          const parts: Buffer[] = [];
          let total = 0;
          res.on("data", (part: Buffer) => {
            total += part.byteLength;
            if (total > MAX_ASSET_BYTES) {
              res.destroy(new Error("image too large"));
              return;
            }
            parts.push(part);
          });
          res.on("end", () => {
            const bytes = Buffer.concat(parts, total);
            const mime = sniffImageMime(bytes);
            if (!mime) {
              resolve(null);
              return;
            }
            resolve({ dataUrl: `data:${mime};base64,${bytes.toString("base64")}`, mime });
          });
          res.on("error", () => resolve(null));
        });
        const remaining = Math.max(1, deadline - Date.now());
        req.setTimeout(remaining, () => req.destroy(new Error("image request timed out")));
        req.on("error", () => resolve(null));
        req.end();
      });
    };
    return await fetchAt(new URL(src), address, 0);
  })().catch(() => null);
}

/**
 * An image resolver for a deck.
 *
 * - Local assets (`/api/deck/<deckId>/assets/<assetId>`) are read from disk —
 *   cross-deck ids resolve to null.
 * - http(s) URLs are fetched once, pinned to a validated public IPv4, capped
 *   at 5 s / 10 MB, and redirects are revalidated.
 * - Every other scheme (`file:`, `data:`, `javascript:`, …) returns null
 *   without a network call.
 *
 * Null flows into the exporters' captioned-placeholder fallback, so an
 * export never fails because of one bad image.
 */
export function createImageResolver(
  deckId: string,
  fetchRemote: (src: string, address: string) => Promise<ResolvedImage | null> = fetchRemoteImage,
  resolvePublicAddress: (url: URL) => Promise<string | null> = publicAddressFor,
): ImageResolver {
  return async (src: string): Promise<ResolvedImage | null> => {
    const local = /^\/api\/deck\/([^/]+)\/assets\/([A-Za-z0-9-]+)$/.exec(src);
    if (local) {
      if (local[1] !== deckId) return null;
      const dataUrl = await readAssetDataUrl(local[1], local[2]);
      if (!dataUrl) return null;
      const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
      return { dataUrl, mime };
    }
    if (/^https?:\/\//i.test(src)) {
      const url = new URL(src);
      const address = await resolvePublicAddress(url).catch(() => null);
      if (!address) return null;
      return fetchRemote(src, address);
    }
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
