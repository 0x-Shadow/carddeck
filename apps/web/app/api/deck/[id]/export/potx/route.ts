import { NextResponse } from "next/server";
import { buildThemePotxBuffer } from "@carddeck/pptx";
import { loadExportableDeck, exportFilename } from "../load";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/deck/[id]/export/potx -> .potx attachment
 *
 * The deck's theme as a PowerPoint template, so a deck reopens with the right
 * fonts/colors as its master. Same access rules as the .pptx export.
 */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const loaded = await loadExportableDeck(id);
  if (loaded.res) return loaded.res;
  const { title, theme } = loaded.data;

  const buffer = await buildThemePotxBuffer(theme);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.presentationml.template",
      "content-disposition": `attachment; filename="${exportFilename(title, "potx")}"`,
      "cache-control": "no-store",
    },
  });
}
