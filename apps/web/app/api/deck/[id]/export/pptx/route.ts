import { NextResponse } from "next/server";
import {
  buildDesignedPptxBuffer,
  buildPptagentPptxBuffer,
  isPptagentAvailable,
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
 *
 * `?engine=pptagent` selects the vendored PPTAgent html2pptx converter: the
 * designed 1280×720 slides are read from the browser's computed layout and
 * emitted as positioned PowerPoint shapes. The default `native` engine keeps
 * charts as editable chart parts and injects the deck's motion plan; the
 * pptagent engine trades both for HTML-faithful composition.
 */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const engine = new URL(req.url).searchParams.get("engine") === "pptagent" ? "pptagent" : "native";
  const loaded = await loadExportableDeck(id);
  if (loaded.res) return loaded.res;
  const { title, theme, cards } = loaded.data;

  if (engine === "pptagent" && !isPptagentAvailable()) {
    return NextResponse.json(
      { error: "pptAgent engine unavailable: converter or its node dependencies are missing" },
      { status: 503 },
    );
  }

  const buffer =
    engine === "pptagent"
      ? await buildPptagentPptxBuffer(
          { title, theme },
          cards,
          { resolveImage: createImageResolver(id) },
        )
      : await buildDesignedPptxBuffer(
          { id, title, theme, cards },
          {
            resolveImage: createImageResolver(id),
            // Animations ride along by default; CARDDECK_MOTION=off is the kill
            // switch. The plan is sliced to the slides actually exported (unready
            // cards drop out), so injection never targets a slide that isn't there.
            motion: motionForExport(loaded.data.motion, cards.length),
            seed: id,
          },
        );

  const filename = exportFilename(
    engine === "pptagent" ? `${title} (PPTAgent)` : title,
    "pptx",
  );

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-carddeck-engine": engine,
      "cache-control": "no-store",
    },
  });
}
