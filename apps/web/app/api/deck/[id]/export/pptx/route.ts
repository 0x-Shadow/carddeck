import { NextResponse } from "next/server";
import { renderSlidesHtml, buildPptxBuffer } from "@carddeck/pptx";
import { loadExportableDeck, exportFilename } from "../load";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/deck/[id]/export/pptx -> .pptx attachment
 *
 * The headline export: every ready card becomes one editable slide, themed
 * via the deck's fonts/colors. Allowed for the owner or anyone holding a
 * share link to a public deck.
 */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const loaded = await loadExportableDeck(id);
  if (loaded.res) return loaded.res;
  const { title, theme, cards } = loaded.data;

  const slides = await renderSlidesHtml({ title, theme }, cards);
  const buffer = await buildPptxBuffer(slides);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "content-disposition": `attachment; filename="${exportFilename(title, "pptx")}"`,
      "cache-control": "no-store",
    },
  });
}
