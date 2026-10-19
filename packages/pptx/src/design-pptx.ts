/**
 * Designed PowerPoint renderer.
 *
 * The original exporter converts semantic HTML to text runs, which is faithful
 * for long-form text but flattens Gamma's defining visual language: card grids,
 * KPI tiles, cover photography, and charts all collapse into a text column.
 *
 * This renderer builds the slide directly with PptxGenJS shapes instead. Every
 * object stays native and editable in PowerPoint, while the composition follows
 * the same design system as the web reader:
 *
 *   theme page → editorial header → body blocks → card surfaces → accent line
 *
 * Charts are real OOXML charts (editable data), images are embedded pictures,
 * and the deck's motion plan is injected over the generated shapes exactly like
 * the HTML path. `buildPptxBuffer` remains the text-first fallback.
 */
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import {
  planMotion,
  type Block,
  type Inline,
  type MotionPlan,
  type Theme,
} from "@carddeck/core";
import { injectMotion } from "./motion-xml";
import type { ImageResolver, ResolvedImage } from "./images";
import type { SlideInput } from "./render-slides";

export interface DesignedDeck {
  id: string;
  title: string;
  theme: Theme;
  cards: SlideInput[];
}

export interface DesignedPptxOptions {
  resolveImage?: ImageResolver;
  motion?: MotionPlan | null;
  /** Stable seed for motion; defaults to the deck id. */
  seed?: string;
}

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const M = 0.65;
const CONTENT_W = SLIDE_W - M * 2;
const BODY_BOTTOM = 6.8;

/**
 * Type scale. Every text element picks one of these steps — the deck reads as
 * one system instead of 19 ad-hoc point sizes, and the ratio between steps
 * (1.15–1.4×) keeps hierarchy visible from the back of a room.
 */
const TYPE = {
  micro: 7, // footers, slide numbers
  label: 9.5, // kickers, uppercase labels, captions, chart axes
  chip: 13, // pills, list rows, card copy
  body: 15, // paragraphs, supporting copy
  h3: 20, // sub-heads, cover subtitle, long metrics
  h2: 24, // section heads, pull quotes
  h1: 30, // slide titles, headline metrics
  h1Md: 26, // wrapped slide titles
  display: 42, // closing statement
  hero: 50, // cover title
} as const;

/**
 * Content scale. A slide that overflows its body area is rendered twice: once
 * measured on a probe context, then again at a reduced scale so the last block
 * still lands above the footer instead of being dropped.
 */
const SCALE_TIGHT = 0.86;
const SCALE_COMPACT = 0.76;

type Slide = ReturnType<PptxGenJS["addSlide"]>;

interface Palette {
  page: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  display: string;
  body: string;
}

function hex(color: string): string {
  return color.replace("#", "").toUpperCase();
}

function palette(theme: Theme): Palette {
  return {
    page: hex(theme.colors.page),
    surface: hex(theme.colors.surface),
    ink: hex(theme.colors.ink),
    muted: hex(theme.colors.muted),
    accent: hex(theme.colors.accent),
    display: theme.fonts.display,
    body: theme.fonts.body,
  };
}

function plain(runs: Inline[] | string): string {
  if (typeof runs === "string") return runs;
  return runs.map((run) => (typeof run === "string" ? run : run.text)).join("");
}

/**
 * Estimate wrapped line count from the box width and font size. PptxGenJS has
 * no text measurement pass, so the renderer needs a reasonable approximation;
 * 0.5em average advance tracks Inter/Space Grotesk closely enough for layout.
 */
function estimateLines(value: string, width: number, fontSize: number): number {
  const charsPerLine = Math.max(8, Math.floor((width * 72) / (fontSize * 0.5)));
  return Math.max(1, Math.ceil(value.length / charsPerLine));
}

function visibleText(blocks: Block[]): string {
  for (const block of blocks) {
    if (block.type === "paragraph") {
      const text = plain(block.text).trim();
      if (text) return text;
    }
    if (block.type === "quote") {
      const text = plain(block.text).trim();
      if (text) return text;
    }
  }
  return "";
}

interface SlideCtx {
  slide: Slide;
  shapes: number;
  pal: Palette;
  /** Multiplier applied to every type size and measured block height. */
  scale: number;
}

/** A context that runs the layout pass without emitting anything to the file. */
function probeCtx(ctx: SlideCtx): SlideCtx {
  const sink = new Proxy({} as Record<string, unknown>, {
    get: (_target, prop) => {
      if (typeof prop === "symbol") return undefined;
      return () => undefined;
    },
  });
  return { ...ctx, slide: sink as unknown as Slide, shapes: 0 };
}

function text(
  ctx: SlideCtx,
  value: string | Inline[],
  options: Record<string, unknown>,
): void {
  const scale = ctx.scale;
  // Micro copy (footers, kickers, captions) is already at the floor of the
  // scale — shrinking it further produces 5pt labels nobody can read.
  const sized = (size: number) =>
    size <= TYPE.label ? size : Math.round(size * scale * 2) / 2;
  // Run-level options carry emphasis only. Size, colour, and face live on the
  // shape options, so no run default can override the size the layout chose.
  const content =
    typeof value === "string"
      ? value
      : value.map((run) =>
          typeof run === "string"
            ? { text: run }
            : {
                text: run.text,
                options: {
                  ...(run.bold ? { bold: true } : {}),
                  ...(run.italic ? { italic: true } : {}),
                  ...(run.link ? { hyperlink: { url: run.link } } : {}),
                },
              },
        );
  const scaledOptions: Record<string, unknown> = { ...options };
  if (typeof scaledOptions.fontSize === "number") {
    scaledOptions.fontSize = sized(scaledOptions.fontSize);
  }
  if (typeof scaledOptions.charSpacing === "number") {
    scaledOptions.charSpacing = scaledOptions.charSpacing * scale;
  }
  ctx.slide.addText(content as never, { margin: 0, ...scaledOptions } as never);
  ctx.shapes += 1;
}

function shape(ctx: SlideCtx, kind: string, options: Record<string, unknown>): void {
  ctx.slide.addShape(kind as never, options as never);
  ctx.shapes += 1;
}

function cardSurface(
  ctx: SlideCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  options: { accent?: boolean; radius?: number; fillTransparency?: number } = {},
): void {
  const accent = options.accent ?? false;
  shape(ctx, "roundRect", {
    x,
    y,
    w,
    h,
    rectRadius: options.radius ?? 0.07,
    fill: { color: ctx.pal.surface, transparency: options.fillTransparency ?? 12 },
    line: {
      color: accent ? ctx.pal.accent : ctx.pal.muted,
      width: accent ? 1.25 : 0.75,
      transparency: accent ? 10 : 72,
    },
    shadow: {
      type: "outer",
      color: "000000",
      blur: 12,
      angle: 45,
      distance: 3,
      opacity: 0.16,
    },
  });
}

function addAccentLine(ctx: SlideCtx, x: number, y: number, w: number, h = 0.045): void {
  shape(ctx, "rect", {
    x,
    y,
    w,
    h,
    fill: { color: ctx.pal.accent },
    line: { color: ctx.pal.accent, width: 0 },
  });
}

function addHeader(
  ctx: SlideCtx,
  deck: DesignedDeck,
  card: SlideInput,
  index: number,
  total: number,
): number {
  const pal = ctx.pal;
  const title = card.title;
  const lines = estimateLines(title, CONTENT_W, TYPE.h1);
  // A wrapped title must grow its own header instead of shrinking into a
  // single cramped line: hierarchy is what the slide is for.
  const titleSize = lines > 1 ? TYPE.h1Md : TYPE.h1;
  const titleH = lines > 1 ? 1.08 : 0.66;
  const titleY = 0.62;
  const ruleY = titleY + titleH + 0.14;
  text(ctx, deck.title.toUpperCase(), {
    x: M,
    y: 0.36,
    w: CONTENT_W - 1.6,
    h: 0.22,
    fontFace: pal.body,
    fontSize: TYPE.label,
    bold: true,
    color: pal.muted,
    charSpacing: 1.6,
    fit: "shrink",
  });
  text(ctx, `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, {
    x: SLIDE_W - M - 1.15,
    y: 0.36,
    w: 1.15,
    h: 0.22,
    fontFace: pal.body,
    fontSize: TYPE.label,
    bold: true,
    color: pal.accent,
    align: "right",
  });
  text(ctx, title, {
    x: M,
    y: titleY,
    w: CONTENT_W,
    h: titleH,
    fontFace: pal.display,
    fontSize: titleSize,
    bold: true,
    color: pal.ink,
    valign: "top",
    fit: "shrink",
    lineSpacingMultiple: 1.0,
  });
  addAccentLine(ctx, M, ruleY, 0.92);
  return ruleY + 0.31;
}

function addFooter(ctx: SlideCtx, deck: DesignedDeck, index: number, total: number): void {
  const pal = ctx.pal;
  shape(ctx, "rect", {
    x: M,
    y: 7.06,
    w: CONTENT_W,
    h: 0.012,
    fill: { color: pal.muted, transparency: 72 },
    line: { color: pal.muted, width: 0, transparency: 100 },
  });
  text(ctx, deck.title.toUpperCase(), {
    x: M,
    y: 7.14,
    w: CONTENT_W - 2,
    h: 0.18,
    fontFace: pal.body,
    fontSize: TYPE.micro,
    bold: true,
    color: pal.muted,
    charSpacing: 1.1,
  });
  text(ctx, `${index + 1} / ${total}`, {
    x: SLIDE_W - M - 1.2,
    y: 7.14,
    w: 1.2,
    h: 0.18,
    fontFace: pal.body,
    fontSize: TYPE.micro,
    bold: true,
    color: pal.muted,
    align: "right",
  });
}

function titleOf(card: SlideInput): string {
  const first = card.blocks.find((block) => block.type === "heading");
  if (first && first.type === "heading") {
    const value = plain(first.text).trim();
    if (value) return value;
  }
  return card.title;
}

function firstBlock<T extends Block["type"]>(
  blocks: Block[],
  type: T,
): Extract<Block, { type: T }> | undefined {
  return blocks.find((block) => block.type === type) as Extract<Block, { type: T }> | undefined;
}

function isDuplicateTitle(block: Block, card: SlideInput): boolean {
  if (block.type !== "heading") return false;
  return plain(block.text).trim().toLowerCase() === card.title.trim().toLowerCase();
}

function walkImageBlocks(blocks: Block[], out: Extract<Block, { type: "image" }>[] = []) {
  for (const block of blocks) {
    if (block.type === "image") out.push(block);
    else if (block.type === "columns") {
      for (const column of block.columns) walkImageBlocks(column, out);
    }
  }
  return out;
}

async function resolveImages(
  card: SlideInput,
  resolve: ImageResolver | undefined,
): Promise<Map<Block, ResolvedImage | null>> {
  const map = new Map<Block, ResolvedImage | null>();
  if (!resolve) return map;
  const images = walkImageBlocks(card.blocks);
  const unique = new Map<string, Promise<ResolvedImage | null>>();
  for (const image of images) {
    const src = image.src.trim();
    if (!src) continue;
    if (!unique.has(src)) unique.set(src, resolve(src).catch(() => null));
  }
  for (const image of images) {
    const src = image.src.trim();
    const entry = src ? unique.get(src) : undefined;
    map.set(image, entry ? await entry : null);
  }
  return map;
}

function addImage(
  ctx: SlideCtx,
  resolved: ResolvedImage | null | undefined,
  rect: { x: number; y: number; w: number; h: number },
  options: { transparency?: number; caption?: string } = {},
): boolean {
  if (!resolved?.dataUrl) return false;
  try {
    ctx.slide.addImage({
      data: resolved.dataUrl,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      sizing: { type: "cover", w: rect.w, h: rect.h },
      ...(options.transparency ? { transparency: options.transparency } : {}),
    } as never);
    return true;
  } catch {
    return false;
  }
}

function renderCover(
  ctx: SlideCtx,
  deck: DesignedDeck,
  card: SlideInput,
  images: Map<Block, ResolvedImage | null>,
  total: number,
): void {
  const pal = ctx.pal;
  const behind = card.blocks.find(
    (block): block is Extract<Block, { type: "image" }> =>
      block.type === "image" && block.layout === "behind",
  );
  const resolved = behind ? images.get(behind) : null;

  if (resolved && addImage(ctx, resolved, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H })) {
    shape(ctx, "rect", {
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H,
      fill: { color: pal.page, transparency: 38 },
      line: { color: pal.page, width: 0, transparency: 100 },
    });
    shape(ctx, "rect", {
      x: 0,
      y: 0,
      w: 7.55,
      h: SLIDE_H,
      fill: { color: pal.page, transparency: 4 },
      line: { color: pal.page, width: 0, transparency: 100 },
    });
    shape(ctx, "rect", {
      x: 7.55,
      y: 0,
      w: 0.035,
      h: SLIDE_H,
      fill: { color: pal.accent, transparency: 15 },
      line: { color: pal.accent, width: 0, transparency: 100 },
    });
  } else {
    shape(ctx, "ellipse", {
      x: 8.7,
      y: 0.35,
      w: 4.1,
      h: 4.1,
      fill: { color: pal.accent, transparency: 88 },
      line: { color: pal.accent, width: 1, transparency: 55 },
    });
    shape(ctx, "ellipse", {
      x: 10.4,
      y: 3.4,
      w: 2.5,
      h: 2.5,
      fill: { color: pal.ink, transparency: 93 },
      line: { color: pal.ink, width: 0.75, transparency: 78 },
    });
    shape(ctx, "roundRect", {
      x: 9.1,
      y: 1.25,
      w: 2.8,
      h: 2.8,
      rectRadius: 0.18,
      rotate: 18,
      fill: { color: pal.surface, transparency: 20 },
      line: { color: pal.accent, width: 1, transparency: 35 },
    });
  }

  addAccentLine(ctx, M - 0.18, 1.15, 0.055, 4.55);

  // The cover speaks in the deck's own words: a second heading becomes the
  // kicker and the card's callout becomes the pill — never a fixed marketing
  // string borrowed from another topic.
  const kicker = card.blocks.find(
    (block, index) => index > 0 && block.type === "heading",
  );
  if (kicker && kicker.type === "heading" && plain(kicker.text).trim()) {
    text(ctx, plain(kicker.text).trim().toUpperCase(), {
      x: M,
      y: 0.78,
      w: 5.8,
      h: 0.24,
      fontFace: pal.body,
      fontSize: TYPE.label,
      bold: true,
      color: pal.accent,
      charSpacing: 2.1,
      fit: "shrink",
    });
  }

  const title = titleOf(card);
  text(ctx, title, {
    x: M,
    y: 1.32,
    w: 6.35,
    h: 2.05,
    fontFace: pal.display,
    fontSize: title.length > 30 ? TYPE.display : TYPE.hero,
    bold: true,
    color: pal.ink,
    valign: "top",
    fit: "shrink",
    lineSpacingMultiple: 0.92,
  });

  const subtitle = visibleText(card.blocks);
  if (subtitle) {
    text(ctx, subtitle, {
      x: M,
      y: 3.95,
      w: 5.95,
      h: 0.9,
      fontFace: pal.body,
      fontSize: TYPE.h3,
      color: pal.muted,
      valign: "top",
      fit: "shrink",
      lineSpacingMultiple: 1.18,
    });
  }

  const callout = firstBlock(card.blocks, "callout");
  if (callout && plain(callout.text).trim()) {
    const chip = plain(callout.text).trim();
    text(ctx, chip.toUpperCase(), {
      x: M,
      y: 5.35,
      w: Math.min(6.4, 0.3 + chip.length * TYPE.chip * 0.0098),
      h: 0.46,
    shape: "roundRect",
    rectRadius: 0.18,
    fill: { color: pal.accent, transparency: 84 },
    line: { color: pal.accent, width: 1, transparency: 20 },
    fontFace: pal.body,
    fontSize: TYPE.chip,
    bold: true,
    color: pal.ink,
    align: "center",
    valign: "middle",
    charSpacing: 0.8,
    margin: [0, 10, 0, 10],
    });
  }

  const meta = `${deck.title.toUpperCase()}  ·  ${total} SLIDES  ·  16:9 PPTX`;
  text(ctx, meta, {
    x: M,
    y: 6.72,
    w: 7.4,
    h: 0.24,
    fontFace: pal.body,
    fontSize: TYPE.micro,
    bold: true,
    color: pal.muted,
    charSpacing: 1.2,
    fit: "shrink",
  });

  if (behind?.caption) {
    text(ctx, behind.caption, {
      x: SLIDE_W - 4.8,
      y: 7.12,
      w: 4.15,
      h: 0.2,
      fontFace: pal.body,
      fontSize: TYPE.micro,
      italic: true,
      color: pal.muted,
      align: "right",
    });
  }
  text(ctx, "01", {
    x: SLIDE_W - M - 0.6,
    y: 0.78,
    w: 0.6,
    h: 0.24,
    fontFace: pal.body,
    fontSize: TYPE.label,
    bold: true,
    color: pal.muted,
    align: "right",
  });
}

function renderClosing(
  ctx: SlideCtx,
  deck: DesignedDeck,
  card: SlideInput,
  images: Map<Block, ResolvedImage | null>,
  index: number,
  total: number,
): void {
  const pal = ctx.pal;
  const behind = card.blocks.find(
    (block): block is Extract<Block, { type: "image" }> =>
      block.type === "image" && block.layout === "behind",
  );
  const resolved = behind ? images.get(behind) : null;
  if (resolved && addImage(ctx, resolved, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H })) {
    shape(ctx, "rect", {
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H,
      fill: { color: pal.page, transparency: 42 },
      line: { color: pal.page, width: 0, transparency: 100 },
    });
    shape(ctx, "rect", {
      x: 0,
      y: 0,
      w: 8.4,
      h: SLIDE_H,
      fill: { color: pal.page, transparency: 8 },
      line: { color: pal.page, width: 0, transparency: 100 },
    });
  } else {
    shape(ctx, "ellipse", {
      x: 8.75,
      y: 1.2,
      w: 4.55,
      h: 4.55,
      fill: { color: pal.accent, transparency: 90 },
      line: { color: pal.accent, width: 1, transparency: 55 },
    });
    shape(ctx, "ellipse", {
      x: 10.7,
      y: 3.0,
      w: 2.2,
      h: 2.2,
      fill: { color: pal.surface, transparency: 30 },
      line: { color: pal.ink, width: 0.75, transparency: 72 },
    });
  }

  text(ctx, `${deck.title.toUpperCase()}  ·  CLOSE`, {
    x: M,
    y: 0.85,
    w: 6,
    h: 0.24,
    fontFace: pal.body,
    fontSize: TYPE.label,
    bold: true,
    color: pal.accent,
    charSpacing: 2.1,
    fit: "shrink",
  });
  text(ctx, titleOf(card), {
    x: M,
    y: 1.35,
    w: 8.3,
    h: 1.5,
    fontFace: pal.display,
    fontSize: TYPE.display,
    bold: true,
    color: pal.ink,
    valign: "top",
    fit: "shrink",
    lineSpacingMultiple: 0.94,
  });

  const quote = firstBlock(card.blocks, "quote");
  if (quote) {
    addAccentLine(ctx, M - 0.02, 3.28, 0.055, 1.1);
    text(ctx, quote.text, {
      x: M + 0.2,
      y: 3.2,
      w: 7.2,
      h: 1.2,
      fontFace: pal.body,
      fontSize: TYPE.h2,
      italic: true,
      color: pal.ink,
      valign: "top",
      fit: "shrink",
      lineSpacingMultiple: 1.12,
    });
    if (quote.attribution) {
      text(ctx, quote.attribution.toUpperCase(), {
        x: M + 0.2,
        y: 4.48,
        w: 6,
        h: 0.22,
        fontFace: pal.body,
        fontSize: TYPE.label,
        bold: true,
        color: pal.accent,
        charSpacing: 1.4,
      });
    }
  }

  const callout = firstBlock(card.blocks, "callout");
  const cta = callout ? plain(callout.text) : `${deck.title} — presented in 16:9`;
  text(ctx, cta.toUpperCase(), {
    x: M,
    y: 5.55,
    w: Math.min(7.6, (0.35 + cta.length * TYPE.chip * 0.0104) * ctx.scale),
    h: 0.52 * ctx.scale,
    shape: "roundRect",
    rectRadius: 0.18,
    fill: { color: pal.accent, transparency: 82 },
    line: { color: pal.accent, width: 1.25, transparency: 10 },
    fontFace: pal.body,
    fontSize: TYPE.chip,
    bold: true,
    color: pal.ink,
    align: "center",
    valign: "middle",
    charSpacing: 0.8,
    margin: [0, 12, 0, 12],
  });

  const body = firstBlock(card.blocks, "paragraph");
  if (body) {
    text(ctx, body.text, {
      x: M,
      y: 6.2,
      w: 7.4,
      h: 0.62,
      fontFace: pal.body,
      fontSize: TYPE.body,
      color: pal.muted,
      fit: "shrink",
    });
  }
  if (behind?.caption) {
    text(ctx, behind.caption, {
      x: SLIDE_W - 4.8,
      y: 7.12,
      w: 4.15,
      h: 0.2,
      fontFace: pal.body,
      fontSize: TYPE.micro,
      italic: true,
      color: pal.muted,
      align: "right",
    });
  }
  addFooter(ctx, deck, index, total);
}

interface Cursor {
  x: number;
  y: number;
  w: number;
  bottom: number;
}

function renderParagraph(ctx: SlideCtx, cursor: Cursor, block: Extract<Block, { type: "paragraph" }>): number {
  const value = plain(block.text);
  const size = TYPE.body;
  const lines = estimateLines(value, cursor.w, size);
  // 15pt at 1.18 line spacing ≈ 0.30" per line; measure first so copy never
  // runs into the block below it.
  const h = Math.min(3, Math.max(0.36, ((lines * size * 1.3) / 72 + 0.06) * ctx.scale));
  text(ctx, block.text, {
    x: cursor.x,
    y: cursor.y,
    w: cursor.w,
    h,
    fontFace: ctx.pal.body,
    fontSize: size,
    color: ctx.pal.ink,
    valign: "top",
    fit: "shrink",
    lineSpacingMultiple: 1.18,
  });
  return h;
}

function renderHeading(
  ctx: SlideCtx,
  cursor: Cursor,
  block: Extract<Block, { type: "heading" }>,
): number {
  const value = plain(block.text);
  // Body headings sit between the 12pt copy and the 30pt slide title: three
  // steps, never a one-off size.
  const size = block.level === 3 ? TYPE.h3 : block.level === 2 ? TYPE.h2 : TYPE.h1;
  const lines = estimateLines(value, cursor.w, size);
  const h = Math.max(0.36, ((lines * size * 1.34) / 72 + 0.04) * ctx.scale);
  text(ctx, block.text, {
    x: cursor.x,
    y: cursor.y,
    w: cursor.w,
    h,
    fontFace: ctx.pal.display,
    fontSize: size,
    bold: true,
    color: ctx.pal.ink,
    valign: "top",
    fit: "shrink",
  });
  return h;
}

function renderList(
  ctx: SlideCtx,
  cursor: Cursor,
  block: Extract<Block, { type: "bulletList" | "numberedList" }>,
): number {
  const numbered = block.type === "numberedList";
  // Row heights follow each row's wrapped length instead of splitting the box
  // evenly, so a long bullet never gets clipped by a short sibling.
  const itemLines = block.items.map((item) => estimateLines(plain(item), cursor.w, TYPE.chip));
  const totalLines = Math.max(1, itemLines.reduce((sum, n) => sum + n, 0));
  const h = Math.min(4, Math.max(0.5, (totalLines * 0.3 + 0.14) * ctx.scale));
  const rowTops: number[] = [];
  let offset = 0;
  for (const n of itemLines) {
    rowTops.push(offset);
    offset += (h * n) / totalLines;
  }
  block.items.forEach((item, index) => {
    const rowH = (h * itemLines[index]) / totalLines;
    const rowFont = Math.round(TYPE.chip * ctx.scale * 2) / 2;
    const runs: { text: string; options: Record<string, unknown> }[] = [
      {
        text: numbered ? `${String(index + 1).padStart(2, "0")}   ` : "•   ",
        options: {
          fontFace: ctx.pal.body,
          fontSize: rowFont,
          bold: true,
          color: ctx.pal.accent,
        },
      },
    ];
    item.forEach((part) => {
      runs.push({
        text: typeof part === "string" ? part : part.text,
        options: {
          fontFace: ctx.pal.body,
          fontSize: rowFont,
          color: ctx.pal.ink,
          ...(typeof part !== "string" && part.bold ? { bold: true } : {}),
          ...(typeof part !== "string" && part.italic ? { italic: true } : {}),
        },
      });
    });
    ctx.slide.addText(runs as never, {
      x: cursor.x,
      y: cursor.y + rowTops[index],
      w: cursor.w,
      h: rowH,
      margin: 0,
      valign: "top",
      fit: "shrink",
      lineSpacingMultiple: 1.12,
    } as never);
    ctx.shapes += 1;
  });
  return h;
}

function toneColor(ctx: SlideCtx, tone: "info" | "warn" | "success"): string {
  if (tone === "warn") return "F59E0B";
  if (tone === "success") return "22C55E";
  return ctx.pal.accent;
}

function renderCallout(
  ctx: SlideCtx,
  cursor: Cursor,
  block: Extract<Block, { type: "callout" }>,
): number {
  const tone = toneColor(ctx, block.tone);
  const value = plain(block.text);
  // Pill width tracks the type size so 13pt caps never crowd the rounded ends.
  const w = Math.min(cursor.w, (0.6 + value.length * TYPE.chip * 0.0098) * ctx.scale);
  const h = 0.46 * ctx.scale;
  text(ctx, value, {
    x: cursor.x,
    y: cursor.y,
    w,
    h,
    shape: "roundRect",
    rectRadius: 0.16,
    fill: { color: tone, transparency: 84 },
    line: { color: tone, width: 1, transparency: 22 },
    fontFace: ctx.pal.body,
    fontSize: TYPE.chip,
    bold: true,
    color: ctx.pal.ink,
    align: "center",
    valign: "middle",
    margin: [0, 12, 0, 12],
    fit: "shrink",
  });
  return h;
}

function renderQuote(
  ctx: SlideCtx,
  cursor: Cursor,
  block: Extract<Block, { type: "quote" }>,
): number {
  const value = plain(block.text);
  // Size the block to the copy: a one-line quote should not hold a 1-inch
  // empty accent bar while the attribution floats a line below the words.
  const charsPerLine = Math.max(24, ((cursor.w - 0.2) * 72) / (TYPE.h2 * 0.52));
  const lines = Math.max(1, Math.ceil(value.length / charsPerLine));
  const quoteH = Math.min(1.6, (0.46 + (lines - 1) * 0.42) * ctx.scale);
  addAccentLine(ctx, cursor.x, cursor.y + 0.05, 0.055, quoteH);
  text(ctx, block.text, {
    x: cursor.x + 0.2,
    y: cursor.y,
    w: cursor.w - 0.2,
    h: quoteH,
    fontFace: ctx.pal.body,
    fontSize: TYPE.h2,
    italic: true,
    color: ctx.pal.ink,
    valign: "top",
    fit: "shrink",
    lineSpacingMultiple: 1.12,
  });
  let h = quoteH;
  if (block.attribution) {
    text(ctx, block.attribution.toUpperCase(), {
      x: cursor.x + 0.2,
      y: cursor.y + quoteH + 0.08,
      w: cursor.w - 0.2,
      h: 0.22,
      fontFace: ctx.pal.body,
      fontSize: TYPE.label,
      bold: true,
      color: ctx.pal.accent,
      charSpacing: 1.2,
    });
    h = quoteH + 0.3;
  }
  return h;
}

function columnStat(blocks: Block[]): { metric: string; label: string; body: string } {
  let metric = "";
  let label = "";
  const body: string[] = [];
  for (const block of blocks) {
    if (block.type === "heading" && !metric) {
      metric = plain(block.text).trim();
    } else if (block.type === "callout" && !label) {
      label = plain(block.text).trim();
    } else if (block.type === "paragraph" || block.type === "quote") {
      body.push(plain(block.text).trim());
    } else if (block.type === "bulletList" || block.type === "numberedList") {
      for (const item of block.items) body.push(plain(item).trim());
    } else if (block.type === "heading") {
      body.push(plain(block.text).trim());
    }
  }
  return { metric, label, body: body.filter(Boolean).join("  ·  ") };
}

function renderColumns(
  ctx: SlideCtx,
  cursor: Cursor,
  block: Extract<Block, { type: "columns" }>,
  images: Map<Block, ResolvedImage | null>,
  maxHeight?: number,
): number {
  const pal = ctx.pal;
  const n = Math.max(1, block.columns.length);
  const gap = 0.28;
  const cardW = (cursor.w - gap * (n - 1)) / n;
  const bodyW = cardW - 0.48;
  const s = ctx.scale;
  const stats = block.columns.map((column) => columnStat(column));
  // How tall the tallest card's content actually is, top rule to last line.
  const contentNeed = stats.reduce((need, stat) => {
    const top = (stat.label ? 1.62 : 1.2) * s;
    if (!stat.body) return Math.max(need, top + 0.28);
    const lines = estimateLines(stat.body, bodyW, TYPE.chip);
    return Math.max(need, top + ((lines * TYPE.chip * 1.32) / 72) * s + 0.28);
  }, 0);
  // Cards hug their content plus comfortable padding instead of stretching to
  // a fixed height that leaves half the card empty.
  const base = maxHeight ? maxHeight * s : (n >= 4 ? 2.45 : 2.6) * s;
  const target = maxHeight ? Math.max(base, contentNeed + 0.3) : Math.max(base, contentNeed + 0.85);
  const cardH = Math.max(1.7, Math.min(target, cursor.bottom - cursor.y));
  // With spare height, the content block sits centred in every card of the row
  // so metrics, labels, and copy stay aligned across the grid.
  const off = Math.max(0, Math.min(1.1, (cardH - contentNeed) / 2));
  if (process.env.CARDECK_LAYOUT_DEBUG) {
    // eslint-disable-next-line no-console
    console.error(
      `[cols] n=${n} max=${maxHeight?.toFixed(2) ?? "-"} content=${contentNeed.toFixed(2)} ` +
        `scale=${ctx.scale} cardH=${cardH.toFixed(2)} off=${off.toFixed(2)}`,
    );
  }
  block.columns.forEach((column, index) => {
    const x = cursor.x + index * (cardW + gap);
    const image = column.find(
      (entry): entry is Extract<Block, { type: "image" }> => entry.type === "image",
    );
    const resolved = image ? images.get(image) : null;
    const hasImage = resolved ? addImage(ctx, resolved, { x, y: cursor.y, w: cardW, h: cardH }) : false;
    cardSurface(ctx, x, cursor.y, cardW, cardH, {
      accent: index === 0,
      fillTransparency: hasImage ? 18 : 10,
    });
    if (hasImage) {
      shape(ctx, "rect", {
        x,
        y: cursor.y,
        w: cardW,
        h: cardH,
        fill: { color: pal.surface, transparency: 55 },
        line: { color: pal.surface, width: 0, transparency: 100 },
      });
    }
    const stat = stats[index];
    const metric = stat.metric || stat.body.split("  ·  ")[0] || "";
    const metricIsLong = metric.length > 18;
    const tightFit = cardW < 3 && metric.length > 8;
    text(ctx, metric, {
      x: x + 0.24,
      y: cursor.y + 0.28 * s + off,
      w: cardW - 0.48,
      h: (metricIsLong ? 0.7 : 0.86) * s,
      fontFace: pal.display,
      fontSize: metricIsLong ? TYPE.h3 : tightFit ? TYPE.h2 : TYPE.h1,
      bold: true,
      color: index === 0 ? pal.accent : pal.ink,
      valign: "top",
      fit: "shrink",
      lineSpacingMultiple: 0.9,
    });
    if (stat.label) {
      text(ctx, stat.label.toUpperCase(), {
        x: x + 0.24,
        y: cursor.y + 1.2 * s + off,
        w: cardW - 0.48,
        h: 0.3 * s,
        fontFace: pal.body,
        fontSize: TYPE.label,
        bold: true,
        color: index === 0 ? pal.accent : pal.muted,
        charSpacing: 1.1,
        fit: "shrink",
      });
    }
    if (stat.body) {
      text(ctx, stat.body, {
        x: x + 0.24,
        y: cursor.y + (stat.label ? 1.62 : 1.2) * s + off,
        w: cardW - 0.48,
        h: Math.max(
          0.3,
          cardH - (stat.label ? 1.62 : 1.2) * s - off - 0.26,
        ),
        fontFace: pal.body,
        fontSize: TYPE.chip,
        color: pal.muted,
        valign: "top",
        fit: "shrink",
        lineSpacingMultiple: 1.16,
      });
    }
    text(ctx, String(index + 1).padStart(2, "0"), {
      x: x + cardW - 0.6,
      y: cursor.y + 0.22 * s + off,
      w: 0.36,
      h: 0.2,
      fontFace: pal.body,
      fontSize: TYPE.micro,
      bold: true,
      color: pal.muted,
      align: "right",
    });
    addAccentLine(ctx, x + 0.24, cursor.y + 0.12 * s + off, 0.38, 0.028);
  });
  return cardH;
}

function renderChart(
  ctx: SlideCtx,
  cursor: Cursor,
  block: Extract<Block, { type: "chart" }>,
): number {
  const pal = ctx.pal;
  const available = cursor.bottom - cursor.y;
  if (available < 1.6) return 0;
  const h = Math.min(3.5, available);
  cardSurface(ctx, cursor.x, cursor.y, cursor.w, h, { accent: true, fillTransparency: 8 });
  const seriesNames = block.data.series.map((series) => series.name).join("  ·  ");
  text(ctx, `${block.kind.toUpperCase()}  /  ${seriesNames}`.toUpperCase(), {
    x: cursor.x + 0.3,
    y: cursor.y + 0.2,
    w: cursor.w - 0.6,
    h: 0.22,
    fontFace: pal.body,
    fontSize: TYPE.label,
    bold: true,
    color: pal.accent,
    charSpacing: 1.2,
    fit: "shrink",
  });

  const chartData = block.data.series.map((series) => ({
    name: series.name,
    labels: block.data.labels,
    values: series.values,
  }));
  const chartType = block.kind === "donut" ? "doughnut" : block.kind;
  // Multi-series charts need distinct hues; a single-series chart reads as one
  // argument, so keep it monochrome with the largest value carrying the accent.
  let chartColors: string[];
  if (block.data.series.length === 1) {
    const values = block.data.series[0].values;
    const maxIndex = values.indexOf(Math.max(...values));
    chartColors = block.data.labels.map((_, index) =>
      index === maxIndex ? pal.accent : pal.muted,
    );
  } else {
    chartColors = [pal.accent, "22C55E", "F59E0B", pal.muted, pal.ink];
  }
  const options: Record<string, unknown> = {
    x: cursor.x + 0.3,
    y: cursor.y + 0.54,
    w: cursor.w - 0.6,
    h: h - 0.78,
    chartColors,
    chartColorsOpacity: 94,
    showLegend: true,
    legendPos: "b",
    legendColor: pal.muted,
    legendFontFace: pal.body,
    legendFontSize: 9,
    showTitle: false,
    showValue: block.kind !== "donut",
    dataLabelColor: pal.ink,
    dataLabelFontFace: pal.body,
    dataLabelFontSize: 9,
    dataLabelFontBold: true,
    catAxisLabelColor: pal.muted,
    catAxisLabelFontFace: pal.body,
    catAxisLabelFontSize: 9,
    catAxisLineShow: false,
    catAxisMajorTickMark: "none",
    valAxisLabelColor: pal.muted,
    valAxisLabelFontFace: pal.body,
    valAxisLabelFontSize: 9,
    valAxisLineShow: false,
    valAxisMajorTickMark: "none",
    valGridLine: { color: pal.muted, style: "dash", size: 0.5 },
    chartArea: { fill: { color: pal.surface, transparency: 100 }, border: { color: pal.surface, pt: 0 } },
    plotArea: { fill: { color: pal.surface, transparency: 100 } },
    border: { color: pal.surface, pt: 0 },
  };
  if (block.kind === "bar") {
    options.barDir = "col";
    options.barGapWidthPct = 45;
    options.showValue = true;
  } else if (block.kind === "line") {
    options.lineSize = 2.5;
    options.lineSmooth = true;
    options.lineDataSymbol = "circle";
    options.lineDataSymbolSize = 7;
    options.showValue = false;
  } else {
    options.holeSize = 58;
    options.showPercent = true;
    options.showValue = false;
    options.showLegend = true;
  }
  try {
    ctx.slide.addChart(chartType as never, chartData as never, options as never);
  } catch {
    const summary = block.data.labels
      .map((label, index) => {
        const values = block.data.series
          .map((series) => `${series.name}: ${series.values[index] ?? 0}`)
          .join("  ·  ");
        return `${label}  —  ${values}`;
      })
      .join("\n");
    text(ctx, summary, {
      x: cursor.x + 0.35,
      y: cursor.y + 0.65,
      w: cursor.w - 0.7,
      h: h - 1.0,
      fontFace: pal.body,
      fontSize: TYPE.chip,
      color: pal.ink,
      valign: "top",
    });
  }
  return h;
}

function renderFullImage(
  ctx: SlideCtx,
  cursor: Cursor,
  block: Extract<Block, { type: "image" }>,
  images: Map<Block, ResolvedImage | null>,
): number {
  const h = Math.max(1.8, Math.min(2.7, cursor.bottom - cursor.y));
  const resolved = images.get(block);
  if (!resolved || !addImage(ctx, resolved, { x: cursor.x, y: cursor.y, w: cursor.w, h })) {
    shape(ctx, "roundRect", {
      x: cursor.x,
      y: cursor.y,
      w: cursor.w,
      h,
      rectRadius: 0.06,
      fill: { color: ctx.pal.surface, transparency: 20 },
      line: { color: ctx.pal.muted, width: 0.75, transparency: 50, dashType: "dash" },
    });
    text(ctx, block.caption ?? "Image unavailable", {
      x: cursor.x + 0.3,
      y: cursor.y + h / 2 - 0.15,
      w: cursor.w - 0.6,
      h: 0.3,
      fontFace: ctx.pal.body,
      fontSize: TYPE.chip,
      color: ctx.pal.muted,
      align: "center",
    });
    return h;
  }
  if (block.caption) {
    text(ctx, block.caption, {
      x: cursor.x,
      y: cursor.y + h + 0.06,
      w: cursor.w,
      h: 0.2,
      fontFace: ctx.pal.body,
      fontSize: TYPE.label,
      italic: true,
      color: ctx.pal.muted,
    });
    return h + 0.26;
  }
  return h;
}

function renderContent(
  ctx: SlideCtx,
  deck: DesignedDeck,
  card: SlideInput,
  images: Map<Block, ResolvedImage | null>,
  index: number,
  total: number,
): void {
  const pal = ctx.pal;
  // A quiet geometric watermark keeps flat backgrounds from feeling empty.
  // Kept fully inside the canvas so no element renders past the slide edge.
  shape(ctx, "ellipse", {
    x: 9.55,
    y: 0.18,
    w: 3.45,
    h: 3.45,
    fill: { color: pal.accent, transparency: 96 },
    line: { color: pal.accent, width: 0.75, transparency: 86 },
  });
  // The header owns its height (wrapped titles grow it), so the body starts
  // where the title rule ends rather than at a fixed y that clips it.
  const bodyTop = addHeader(ctx, deck, card, index, total);

  const sideImage = card.blocks.find(
    (block): block is Extract<Block, { type: "image" }> =>
      block.type === "image" && block.layout === "side",
  );
  const hasSideImage = sideImage ? Boolean(images.get(sideImage)?.dataUrl) : false;
  if (sideImage && hasSideImage) {
    const rect = { x: 8.55, y: bodyTop, w: 4.1, h: BODY_BOTTOM - bodyTop };
    addImage(ctx, images.get(sideImage), rect);
    shape(ctx, "rect", {
      x: rect.x,
      y: rect.y,
      w: 0.035,
      h: rect.h,
      fill: { color: pal.accent, transparency: 15 },
      line: { color: pal.accent, width: 0, transparency: 100 },
    });
    if (sideImage.caption) {
      text(ctx, sideImage.caption, {
        x: rect.x,
        y: rect.y + rect.h + 0.08,
        w: rect.w,
        h: 0.22,
        fontFace: pal.body,
        fontSize: TYPE.label,
        italic: true,
        color: pal.muted,
        align: "right",
        fit: "shrink",
      });
    }
  }

  const cursor: Cursor = {
    x: M,
    y: bodyTop,
    w: hasSideImage ? 7.35 : CONTENT_W,
    bottom: BODY_BOTTOM,
  };

  // Pass 1 measures on a throwaway context so the slide can be sized to fit:
  // dense cards drop to a tighter type scale instead of losing the final block,
  // and airy cards spend their slack on breathing room between blocks.
  const baseGap = 0.26;
  const tightGap = 0.14;
  let scale = 1;
  let gap = baseGap;
  let measured = layoutBlocks(probeCtx(ctx), card, images, { ...cursor }, baseGap);
  if (measured.endY > cursor.bottom + 0.02) {
    // Prefer spending the slack between blocks before spending type size:
    // readable 15pt copy beats a comfortable 0.26" gutter.
    const tightGapped = layoutBlocks(
      probeCtx(ctx),
      card,
      images,
      { ...cursor },
      tightGap,
    );
    if (tightGapped.endY <= cursor.bottom + 0.02) {
      gap = tightGap;
      measured = tightGapped;
    } else {
      const tight = layoutBlocks(
        probeCtx({ ...ctx, scale: SCALE_TIGHT }),
        card,
        images,
        { ...cursor },
        tightGap,
      );
      scale = tight.endY > cursor.bottom + 0.02 ? SCALE_COMPACT : SCALE_TIGHT;
      gap = tightGap;
      measured = layoutBlocks(
        probeCtx({ ...ctx, scale }),
        card,
        images,
        { ...cursor },
        tightGap,
      );
    }
  } else if (measured.used > 1) {
    const slack = cursor.bottom - measured.endY;
    if (slack > 0.55) {
      gap = Math.min(baseGap + (slack * 0.6) / (measured.used - 1), 0.62);
    }
  }

  ctx.scale = scale;
  if (process.env.CARDECK_LAYOUT_DEBUG) {
    // eslint-disable-next-line no-console
    console.error(
      `[layout] ${index + 1}/${total} "${card.title.slice(0, 40)}" ` +
        `top=${bodyTop.toFixed(2)} measured=${measured.endY.toFixed(2)} ` +
        `used=${measured.used} scale=${scale} gap=${gap.toFixed(2)}`,
    );
  }
  layoutBlocks(ctx, card, images, cursor, gap);

  addFooter(ctx, deck, index, total);
}

/**
 * Rough height of a block when it follows a card row — used only to reserve
 * space while sizing the row above it.
 */
function trailingHeight(block: Block): number {
  switch (block.type) {
    case "paragraph":
      return 0.6;
    case "callout":
      return 0.46;
    case "quote":
      return 0.85;
    case "bulletList":
    case "numberedList":
      return Math.min(2.4, block.items.length * 0.34 + 0.14);
    case "heading":
      return 0.44;
    case "chart":
      return 2.6;
    case "image":
      return 2.2;
    default:
      return 0.1;
  }
}

/**
 * Walk a card's blocks down the body column, returning where the content ends
 * and how many real blocks were placed. Used both to measure (on a probe
 * context) and to render.
 */
function layoutBlocks(
  ctx: SlideCtx,
  card: SlideInput,
  images: Map<Block, ResolvedImage | null>,
  cursor: Cursor,
  gap: number,
): { endY: number; used: number } {
  const pal = ctx.pal;
  let used = 0;
  // `endY` is where the last *content* stops; the trailing gap after it is not
  // content and must not push a slide into a smaller type scale.
  let endY = cursor.y;
  for (const [blockIndex, block] of card.blocks.entries()) {
    if (
      block.type === "image" &&
      (block.layout === "side" || block.layout === "behind")
    ) {
      continue;
    }
    if (blockIndex === 0 && isDuplicateTitle(block, card)) continue;
    if (cursor.y >= cursor.bottom) break;

    let taken = 0;
    switch (block.type) {
      case "heading":
        taken = renderHeading(ctx, cursor, block);
        break;
      case "paragraph":
        taken = renderParagraph(ctx, cursor, block);
        break;
      case "bulletList":
      case "numberedList":
        taken = renderList(ctx, cursor, block);
        break;
      case "callout":
        taken = renderCallout(ctx, cursor, block);
        break;
      case "quote":
        taken = renderQuote(ctx, cursor, block);
        break;
      case "divider":
        shape(ctx, "rect", {
          x: cursor.x,
          y: cursor.y + 0.1,
          w: cursor.w,
          h: 0.01,
          fill: { color: pal.muted, transparency: 60 },
          line: { color: pal.muted, width: 0, transparency: 100 },
        });
        taken = 0.2;
        break;
      case "columns": {
        // Columns get every inch they can use: a four-up row is the slide's
        // main event, so it absorbs the remaining height instead of leaving a
        // dead band under the cards — while still reserving room for whatever
        // the card wants to say afterwards.
        const rest = card.blocks
          .slice(blockIndex + 1)
          .filter((entry) => entry.type !== "divider");
        const chartBelow = rest.some((entry) => entry.type === "chart");
        let maxHeight: number | undefined;
        if (chartBelow) {
          maxHeight = 2.35 * ctx.scale;
        } else {
          const reserve =
            rest.reduce((sum, entry) => sum + trailingHeight(entry), 0) +
            0.26 * rest.length;
          const room = cursor.bottom - cursor.y - reserve;
          maxHeight = room >= 2.3 ? Math.min(4.4, room) : undefined;
        }
        taken = renderColumns(ctx, cursor, block, images, maxHeight);
        break;
      }
      case "chart":
        taken = renderChart(ctx, cursor, block);
        break;
      case "image":
        taken = renderFullImage(ctx, cursor, block, images);
        break;
      default:
        taken = 0;
    }
    if (taken > 0) {
      used += 1;
      endY = cursor.y + taken;
    }
    cursor.y += taken + (taken > 0 ? gap : 0);
  }
  return { endY, used };
}

/**
 * The designed renderer emits many more shapes per slide than the text-first
 * exporter (card surfaces, accent rules, captions, chart frames). Re-derive
 * build counts from those shapes, but keep the deck's chosen transition and
 * entrances so a stored motion plan still determines *how* the deck moves.
 * Without a stored plan the generated plan is used verbatim.
 */
function mergeMotion(generated: MotionPlan, stored: MotionPlan | null | undefined): MotionPlan {
  if (!stored || stored.slides.length === 0) return generated;
  return {
    preset: stored.preset,
    slides: generated.slides.map((slide, index) => {
      const source = stored.slides[index];
      if (!source) return slide;
      const builds =
        source.builds.length === 0
          ? slide.builds
          : slide.builds.map((build, buildIndex) => ({
              effect: source.builds[buildIndex % source.builds.length].effect,
              delayMs: build.delayMs,
            }));
      return { transition: source.transition, builds };
    }),
  };
}

/**
 * Build a designed .pptx from parsed cards. All text, charts, and pictures are
 * native PowerPoint objects; motion transitions/builds are injected after the
 * file is assembled.
 */
export async function buildDesignedPptxBuffer(
  deck: DesignedDeck,
  options: DesignedPptxOptions = {},
): Promise<Buffer> {
  const pal = palette(deck.theme);
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "CARDDECK_16x9", width: SLIDE_W, height: SLIDE_H });
  pres.layout = "CARDDECK_16x9";
  pres.author = "Carddeck";
  pres.subject = deck.title;
  pres.title = deck.title;
  pres.company = "Carddeck";

  const shapeCounts: number[] = [];
  for (const [index, card] of deck.cards.entries()) {
    const slide = pres.addSlide();
    slide.background = { color: pal.page };
    const ctx: SlideCtx = { slide, shapes: 0, pal, scale: 1 };
    const images = await resolveImages(card, options.resolveImage);

    if (index === 0) {
      renderCover(ctx, deck, card, images, deck.cards.length);
    } else if (index === deck.cards.length - 1 && deck.cards.length > 1) {
      renderClosing(ctx, deck, card, images, index, deck.cards.length);
    } else {
      renderContent(ctx, deck, card, images, index, deck.cards.length);
    }
    shapeCounts.push(ctx.shapes);
  }

  if (deck.cards.length === 0) {
    const slide = pres.addSlide();
    slide.background = { color: pal.page };
    slide.addText(deck.title, {
      x: M,
      y: 2.4,
      w: CONTENT_W,
      h: 1.2,
      fontFace: pal.display,
      fontSize: TYPE.display,
      bold: true,
      color: pal.ink,
      align: "center",
    } as never);
  }

  const out = await pres.write({ outputType: "nodebuffer" });
  let buffer = Buffer.from(out as ArrayBuffer);

  const preset = options.motion?.preset;
  if (preset && preset !== "none" && deck.cards.length > 0) {
    const generated = planMotion(
      preset,
      { slides: deck.cards.length, shapes: shapeCounts },
      options.seed ?? deck.id,
    );
    const plan = mergeMotion(generated, options.motion);
    const zip = await JSZip.loadAsync(buffer);
    await injectMotion(zip, plan);
    const regenerated = await zip.generateAsync({ type: "nodebuffer" });
    buffer = Buffer.from(
      regenerated.buffer.slice(
        regenerated.byteOffset,
        regenerated.byteOffset + regenerated.byteLength,
      ) as ArrayBuffer,
    );
  }

  return buffer;
}
