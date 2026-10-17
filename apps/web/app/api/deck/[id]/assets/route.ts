import { NextResponse } from "next/server";
import { resolveOwnedDeck } from "@/lib/deck-access";
import {
  MAX_ASSET_BYTES,
  isAcceptedImageMime,
  saveAsset,
  assetPublicUrl,
} from "@/lib/assets";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/deck/[id]/assets (multipart, field "file") -> 201 { asset: { id, url } }
 *
 * Owner-gated upload for image blocks. Accepts raster images only (PNG,
 * JPEG, WebP, GIF — no SVG: it would be served from our origin and is an
 * XSS surface). The stored extension comes from the declared MIME type, not
 * the filename, so a hostile `.svg`/`.html` name can't change what we serve.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const owned = await resolveOwnedDeck(id);
  if (owned.res) return owned.res;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file field" }, { status: 400 });
  }
  if (!isAcceptedImageMime(file.type)) {
    return NextResponse.json({ error: "unsupported image type" }, { status: 400 });
  }
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: "file too large (max 10MB)" }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const stored = await saveAsset(id, bytes, file.type, file.name);
  return NextResponse.json(
    { asset: { id: stored.assetId, url: assetPublicUrl(id, stored.assetId) } },
    { status: 201 },
  );
}
