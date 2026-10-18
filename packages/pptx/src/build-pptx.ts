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
import {
  nullResolver,
  type ImageResolver,
  type SlideImage,
  type ImageLayout,
} from "./images";

export type { ImageResolver, ImageLayout, SlideImage, ResolvedImage } from "./images";
export { collectSlideImages } from "./images";

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

/** Options for [`buildPptxBuffer`]. */
export interface BuildPptxOptions {
  /** Override the HTML → text converter (defaults to html2pptx). */
  converter?: HtmlConverter;
  /**
   * Map a block `src` to image bytes for embedding. Images are embedded as
   * native picture shapes so the .pptx carries real pictures; a resolver that
   * returns `null` (or an absent `src`) degrades to a captioned placeholder
   * rather than failing the export. Without a resolver, image blocks export as
   * the `[image: caption]` text that `renderSlidesHtml` already emits.
   */
  resolveImage?: ImageResolver;
  /** Images to embed on each slide, by slide index. Defaults to none. */
  images?: Array<SlideImage[] | undefined>;
}

/** Slide geometry in inches (PptxGenJS LAYOUT_WIDE = 13.333 x 7.5). */
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN = 0.5;

/**
 * Where an image sits on the slide, per layout hint. `sizing: contain`
 * preserves the picture's aspect ratio inside the box instead of stretching.
 */
function imageRect(layout: ImageLayout): {
  x: number;
  y: number;
  w: number;
  h: number;
  sizing: { type: "contain"; w: number; h: number };
} {
  const box = (() => {
    switch (layout) {
      // Full-bleed background, leaving the title band clear.
      case "behind":
        return { x: 0, y: 1.1, w: SLIDE_W, h: SLIDE_H - 1.1 };
      // Floated to the right of the text column.
      case "side":
        return { x: SLIDE_W - 4.5, y: 1.2, w: 4, h: 3 };
      // Stacked under the text, full column width.
      case "full":
      default:
        return { x: MARGIN, y: 4.6, w: SLIDE_W - MARGIN * 2, h: 2.4 };
    }
  })();
  return { ...box, sizing: { type: "contain", w: box.w, h: box.h } };
}

/**
 * Embed one image on a slide as a native picture shape.
 *
 * Returns false when the image could not be embedded, so the caller can fall
 * back to a captioned placeholder box. Every failure path is non-fatal: an
 * export must never die because one image 404'd.
 */
async function embedImage(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  image: SlideImage,
  resolveImage: ImageResolver,
): Promise<boolean> {
  const resolved = await resolveImage(image.src).catch(() => null);
  if (!resolved || !resolved.dataUrl) return false;
  const rect = imageRect(image.layout);
  try {
    slide.addImage({
      data: resolved.dataUrl,
      ...rect,
    } as never);
  } catch {
    return false;
  }
  // A side/behind caption is redundant once the picture is on the slide; a
  // full caption sits under the image as a credit line.
  return true;
}

const defaultConverter: HtmlConverter = (html) =>
  htmlToPptxText(html) as unknown as PptxTextItem[];

/**
 * Build a .pptx Buffer from rendered slides.
 *
 * @param slides one `{ html }` per card (from `renderSlidesHtml`)
 * @param options converter override, image resolver, and per-slide images;
 *   a bare function is still accepted as a converter for backward compat
 */
export async function buildPptxBuffer(
  slides: { html: string }[],
  options: BuildPptxOptions | HtmlConverter = {},
): Promise<Buffer> {
  // Accept a bare function as the converter so existing callers keep working.
  const opts: BuildPptxOptions =
    typeof options === "function" ? { converter: options } : options;
  const convert = opts.converter ?? defaultConverter;
  const resolveImage = opts.resolveImage ?? nullResolver;
  const images = opts.images ?? [];

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

  for (const [index, { html }] of slides.entries()) {
    const items = convert(html);
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

    for (const image of images[index] ?? []) {
      const embedded = await embedImage(slide, image, resolveImage);
      if (embedded) continue;
      // Degradation: a captioned placeholder box, same geometry as the image
      // would have had, so the slide keeps its shape and the reader knows an
      // image was intended here.
      const { sizing: _sizing, ...box } = imageRect(image.layout);
      slide.addText(image.caption ? `[image: ${image.caption}]` : "[image]", {
        ...box,
        fontFace: "Arial",
        fontSize: 12,
        color: "888888",
        align: "center",
        valign: "middle",
        line: { color: "cccccc", dashType: "dash", width: 1 },
      } as never);
    }
  }

  const out = await pres.write({ outputType: "nodebuffer" });
  return Buffer.from(out as ArrayBuffer);
}
