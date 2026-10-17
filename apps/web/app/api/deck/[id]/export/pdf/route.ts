import { NextResponse } from "next/server";
import { chromium } from "playwright";
import { renderPrintHtml, type PrintFormat } from "@carddeck/pptx";
import { loadExportableDeck, exportFilename } from "../load";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/deck/[id]/export/pdf -> .pdf attachment
 *
 * Prints the themed deck with headless Chromium's print-to-PDF. The slide
 * HTML comes from `renderPrintHtml` (CSS paged media), so presentation decks
 * land as one exact 16:9 page per card and document decks flow on A4 — the
 * same renderer the .pptx export uses, so both formats agree on layout.
 *
 * Access matches the other exporters (owner or share-link holder via
 * `loadExportableDeck`). If Chromium isn't installed we fail with 503 and a
 * message that says exactly what to install rather than a stack trace.
 */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const loaded = await loadExportableDeck(id);
  if (loaded.res) return loaded.res;
  const { title, theme, cards, format } = loaded.data;

  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch();
  } catch (err) {
    const line = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return NextResponse.json(
      { error: `PDF export unavailable: ${line}. Run 'npx playwright install chromium'.` },
      { status: 503 },
    );
  }

  try {
    const page = await browser.newPage();
    const html = await renderPrintHtml(
      { title, theme },
      cards,
      { format: (format === "document" ? "document" : "presentation") as PrintFormat },
    );
    await page.setContent(html, { waitUntil: "load" });
    const buffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${exportFilename(title, "pdf")}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const line = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return NextResponse.json({ error: `PDF render failed: ${line}` }, { status: 500 });
  } finally {
    await browser.close().catch(() => undefined);
  }
}
