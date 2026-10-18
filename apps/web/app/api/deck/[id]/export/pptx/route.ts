import { NextResponse } from "next/server";
import {
  renderSlidesHtml,
  buildPptxBuffer,
  collectSlideImages,
} from "@carddeck/pptx";
import { loadExportableDeck, exportFilename } from "../load";
import { createImageResolver, motionForExport } from "@/lib/export-slides";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/deck/[id]/export/pptx -> .pptx attachment
 *
 * The headline export: every ready card becomes one editable slide, themed
 * via the deck's fonts/colors. Image blocks embed as real pictures (local
 * assets and remote URLs both resolve to bytes); anything unresolvable
 * degrades to a captioned placeholder instead of failing the export.
 * Allowed for the owner or anyone holding a share link to a public deck.
 */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const loaded = await loadExportableDeck(id);
  if (loaded.res) return loaded.res;
  const { title, theme, cards } = loaded.data;

  // Images ride into pptxgenjs as bytes, not as HTML — so the slide HTML
  // omits image markup entirely (no `[image: …]` text doubles next to the
  // embedded picture).
  const images = cards.map((card) => collectSlideImages(card.blocks));
  const hasImages = images.some((list) => list.length > 0);
  const slides = await renderSlidesHtml({ title, theme }, cards, {
    imageMode: hasImages ? "omit" : "placeholder",
  });
  const buffer = await buildPptxBuffer(slides, {
    resolveImage: createImageResolver(id),
    images,
    // Animations ride along by default; CARDDECK_MOTION=off is the kill
    // switch. The plan is sliced to the slides actually exported (unready
    // cards drop out), so injection never targets a slide that isn't there.
    motion: motionForExport(loaded.data.motion, slides.length),
  });

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
