import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
// Relative imports, not the `@/` alias: the worker and MCP server reach this
// module from other workspaces (see their relative-import convention).
import { getDb, resolveDataDir } from "./db";
import * as t from "../drizzle/schema";

/**
 * Image asset storage.
 *
 * Bytes live on disk under `DATA_DIR/assets/<deckId>/<assetId>.<ext>`; the
 * `asset` table is the index + access record. Keeping blobs out of SQLite
 * keeps backups small and the DB fast; the row is what makes serving safe —
 * an id only ever resolves to a file after its row is confirmed, so a
 * traversal-shaped id is a failed lookup, not a file read.
 */

export const ACCEPTED_IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type AcceptedImageMime = (typeof ACCEPTED_IMAGE_MIMES)[number];

export const MAX_ASSET_BYTES = 10 * 1024 * 1024; // 10 MB

const EXT_BY_MIME: Record<AcceptedImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isAcceptedImageMime(mime: string): mime is AcceptedImageMime {
  return (ACCEPTED_IMAGE_MIMES as readonly string[]).includes(mime);
}

/**
 * Magic-byte sniffing for the accepted raster formats. The bytes are the
 * truth — a `.png`-declared upload that is really a GIF stores and serves as
 * a GIF — and a payload matching no accepted format is not an image at all.
 * Returns null when nothing matches.
 */
export function sniffImageMime(bytes: Uint8Array): AcceptedImageMime | null {
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

export interface StoredAsset {
  assetId: string;
  ext: string;
  mime: string;
  sizeBytes: number;
}

function assetsRoot(deckId: string): string {
  return path.join(resolveDataDir(), "assets", deckId);
}

/**
 * Persist uploaded image bytes + index row. Callers enforce MIME and size
 * policy before calling (routes and MCP tools share these constants).
 */
export async function saveAsset(
  deckId: string,
  bytes: Uint8Array,
  mime: string,
  originalName?: string,
): Promise<StoredAsset> {
  if (!isAcceptedImageMime(mime)) throw new Error(`unsupported image mime: ${mime}`);
  const ext = EXT_BY_MIME[mime];
  const assetId = randomUUID();
  const dir = assetsRoot(deckId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${assetId}.${ext}`), bytes);
  const db = getDb();
  await db.insert(t.asset).values({
    id: assetId,
    deckId,
    mime,
    sizeBytes: bytes.byteLength,
    originalName: originalName ?? null,
  });
  return { assetId, ext, mime, sizeBytes: bytes.byteLength };
}

/** Public URL path for an asset (owner- or public-deck-gated on GET). */
export function assetPublicUrl(deckId: string, assetId: string): string {
  return `/api/deck/${deckId}/assets/${assetId}`;
}

/**
 * Absolute on-disk path for an asset — but ONLY after the (deckId, assetId)
 * row is confirmed in the DB. Returns null when the row doesn't exist, so
 * hostile ids never touch the filesystem.
 */
export async function assetFilePath(
  deckId: string,
  assetId: string,
): Promise<string | null> {
  const db = getDb();
  const row = await db.query.asset.findFirst({
    where: (a, { and, eq }) => and(eq(a.id, assetId), eq(a.deckId, deckId)),
  });
  if (!row) return null;
  const ext = EXT_BY_MIME[row.mime as AcceptedImageMime] ?? "bin";
  return path.join(assetsRoot(deckId), `${assetId}.${ext}`);
}

/**
 * Read an asset as a base64 data URL (deck-scoped, row-validated like
 * `assetFilePath`). Returns null when the row or the file is missing — this
 * is what the exporters' image resolvers use to inline bytes.
 */
export async function readAssetDataUrl(
  deckId: string,
  assetId: string,
): Promise<string | null> {
  const filePath = await assetFilePath(deckId, assetId);
  if (!filePath) return null;
  const db = getDb();
  const row = await db.query.asset.findFirst({
    where: (a, { and, eq }) => and(eq(a.id, assetId), eq(a.deckId, deckId)),
  });
  if (!row) return null;
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch {
    return null;
  }
  return `data:${row.mime};base64,${bytes.toString("base64")}`;
}
