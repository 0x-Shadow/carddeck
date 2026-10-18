import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as t from "@/drizzle/schema";
import { requireUser } from "@/lib/guard";
import { assetFilePath } from "@/lib/assets";

type Params = { params: Promise<{ id: string; assetId: string }> };

/**
 * GET /api/deck/[id]/assets/[assetId] -> image bytes.
 *
 * Access: the deck's owner, or anyone when the deck is public (public
 * readers and PDF export need the bytes). Unknown ids — including
 * traversal-shaped ones — are a plain 404: `assetFilePath` only resolves a
 * path for a row that exists, so an id never reaches the filesystem
 * unvalidated. Responses are immutable-cached (asset ids are UUIDs; content
 * never changes in place).
 */
export async function GET(_req: Request, { params }: Params) {
  const { id, assetId } = await params;
  const db = getDb();
  const row = await db.query.asset.findFirst({
    where: (a, { and, eq }) => and(eq(a.id, assetId), eq(a.deckId, id)),
  });
  if (!row) return new NextResponse(null, { status: 404 });

  const deck = await db.query.deck.findFirst({ where: (d, { eq }) => eq(d.id, id) });
  if (!deck) return new NextResponse(null, { status: 404 });

  let allowed = deck.isPublic === 1;
  if (!allowed) {
    const auth = await requireUser();
    allowed = !auth.res && auth.user.id === deck.userId;
  }
  if (!allowed) return new NextResponse(null, { status: 404 });

  const filePath = await assetFilePath(id, assetId);
  if (!filePath) return new NextResponse(null, { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": row.mime,
      "content-length": String(bytes.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
      // The stored type was sniffed from the bytes; never let a browser
      // second-guess it into rendering something executable.
      "x-content-type-options": "nosniff",
    },
  });
}
