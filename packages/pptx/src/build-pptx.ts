/// <reference path="./html2pptx.d.ts" />
/**
 * Assemble rendered slide HTML into a real, editable .pptx.
 *
 * Pipeline per card: HTML → `html2pptx.htmlToPptxText` → PptxGenJS text items
 * → one slide. PptxGenJS measures nothing and needs no DOM, so the whole build
 * is deterministic and unit-testable; the converter is injectable so tests
 * can run without html2pptx's parser.
 *
 * The output opens in PowerPoint, Google Slides, and LibreOffice Impress as
 * native editable shapes (text boxes with runs), not a flat image.
 */
import PptxGenJS from "pptxgenjs";
import { htmlToPptxText } from "html2pptx";

/** One text run, mirroring html2pptx's `{ text, options }` shape. */
export interface PptxTextItem {
  text: string;
  options?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    breakLine?: boolean;
    color?: string;
    fontFace?: string;
    fontSize?: number;
    link?: { url: string; tooltip?: string };
    [key: string]: unknown;
  };
}

/** HTML → text items. Defaults to the real html2pptx converter. */
export type HtmlConverter = (html: string) => PptxTextItem[];

/** 16:9 slide geometry (PptxGenJS LAYOUT_WIDE = 13.333 x 7.5 inches). */
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN = 0.5;

const defaultConverter: HtmlConverter = (html) =>
  htmlToPptxText(html) as unknown as PptxTextItem[];

/**
 * Build a .pptx Buffer from rendered slides.
 *
 * @param slides one `{ html }` per card (from `renderSlidesHtml`)
 * @param converter injectable html→items fn; defaults to html2pptx
 */
export async function buildPptxBuffer(
  slides: { html: string }[],
  converter: HtmlConverter = defaultConverter,
): Promise<Buffer> {
  const pres = new PptxGenJS();
  // 16:9. `LAYOUT_WIDE` lives on the LAYOUTS map in pptxgenjs v4.
  pres.defineLayout({ name: "SLIDE_16x9", width: SLIDE_W, height: SLIDE_H });
  pres.layout = "SLIDE_16x9";
  pres.author = "Carddeck";
  pres.title = "Carddeck export";

  if (slides.length === 0) {
    // pptxgenjs refuses a presentation with no slides; emit one blank slide.
    pres.addSlide();
  }

  for (const { html } of slides) {
    const items = converter(html);
    const slide = pres.addSlide();
    slide.addText(items as never, {
      x: MARGIN,
      y: MARGIN,
      w: SLIDE_W - MARGIN * 2,
      h: SLIDE_H - MARGIN * 2,
      valign: "top",
      fontFace: "Arial",
      fontSize: 14,
      color: "000000",
    });
  }

  const out = await pres.write({ outputType: "nodebuffer" });
  return Buffer.from(out as ArrayBuffer);
}
