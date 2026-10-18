import { NextResponse } from "next/server";
import { resolveOwnedDeck } from "@/lib/deck-access";
import {
  MAX_ASSET_BYTES,
  isAcceptedImageMime,
  saveAsset,
  assetPublicUrl,
  sniffImageMime,
} from "@/lib/assets";

type Params = { params: Promise<{ id: string }> };

/** Multipart framing overhead the cap allows beyond the file bytes. */
const FORM_SLACK_BYTES = 64 * 1024;

/**
 * Wrap a request body so reads abort once `cap` bytes have been consumed.
 * `req.formData()` would otherwise buffer the *entire* body before
 * `file.size` gets a chance to reject it — an authenticated but cheap
 * memory-exhaustion vector.
 */
function cappedBody(
  body: ReadableStream<Uint8Array>,
  cap: number,
  onOverflow: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let seen = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      seen += value.byteLength;
      if (seen > cap) {
        // Stop reading and error the *consumer*; the upstream source is left
        // uncanceled on purpose. Backpressure already halts it (no reads, no
        // pulls), and canceling a stream this machinery may still be pumping
        // races a scheduled enqueue into a closed controller. An unconsumed
        // request body is fine — the early Content-Length bounce above never
        // reads the body either.
        onOverflow();
        controller.error(new Error("body too large"));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason).catch(() => {});
    },
  });
}

/**
 * POST /api/deck/[id]/assets (multipart, field "file") -> 201 { asset: { id, url } }
 *
 * Owner-gated upload for image blocks. Accepts raster images only (PNG,
 * JPEG, WebP, GIF — no SVG: it would be served from our origin and is an
 * XSS surface). The stored extension and served Content-Type come from the
 * bytes' magic-byte sniff — not the declared type and not the filename — so
 * a hostile `.svg`/`.html` name or a lying multipart part can't change what
 * we serve.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const owned = await resolveOwnedDeck(id);
  if (owned.res) return owned.res;

  const cap = MAX_ASSET_BYTES + FORM_SLACK_BYTES;
  // Declared size first: the common oversized POST never gets read at all.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > cap) {
    return NextResponse.json({ error: "file too large (max 10MB)" }, { status: 413 });
  }

  let overCap = false;
  const headers = new Headers(req.headers);
  // The reconstructed request frames its own streamed body; a stale
  // Content-Length would lie about it.
  headers.delete("content-length");

  let form: FormData;
  try {
    form = await new Request(req.url, {
      method: "POST",
      headers,
      body: req.body ? cappedBody(req.body, cap, () => (overCap = true)) : null,
      // Node needs an explicit half-duplex marker for streamed bodies.
      duplex: "half",
    } as RequestInit & { duplex: "half" }).formData();
  } catch {
    // A body cut off at the cap can't parse as multipart — that's the cap
    // talking, not a malformed request.
    if (overCap) {
      return NextResponse.json({ error: "file too large (max 10MB)" }, { status: 413 });
    }
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
  // Bytes are the truth: what they sniff as is what gets stored and served.
  const mime = sniffImageMime(bytes);
  if (!mime) {
    return NextResponse.json({ error: "unsupported image type" }, { status: 400 });
  }
  const stored = await saveAsset(id, bytes, mime, file.name);
  return NextResponse.json(
    { asset: { id: stored.assetId, url: assetPublicUrl(id, stored.assetId) } },
    { status: 201 },
  );
}
