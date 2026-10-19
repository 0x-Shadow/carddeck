/**
 * Server-side slide renderer for the PowerPoint exporter.
 *
 * Produces one self-contained HTML document per card, with the deck theme
 * inlined as concrete hex colors and font faces. Every style is *inline*
 * (`style="..."`) because `html2pptx` reads only inline styles — it does not
 * resolve CSS classes or custom properties, so the reader's class-based markup
 * would export with default fonts and no colors.
 *
 * Font sizes are written in **points**: html2pptx converts `% / em / pt / rem`
 * but silently ignores `px`, so `pt` is the only unit that survives the trip
 * into the .pptx.
 *
 * Deliberately DOM-free: this is plain string building, so the whole exporter
 * is deterministic and unit-testable without a browser or a running server
 * (the brief's Playwright route-render approach would couple export to a live
 * server and is untestable in isolation; the output here is the same HTML
 * html2pptx consumes).
 */
import type { Block, Inline, Theme } from "@carddeck/core";
import { resolveBlockImages, type ImageMap, type ImageResolver } from "./images";

/** Slide reference box: 16:9, matching PptxGenJS's 13.333x7.5in wide layout. */
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;

/** pt font sizes per block role (html2pptx understands pt). */
const FONT_SIZE = {
  title: "32pt",
  heading1: "28pt",
  heading2: "24pt",
  heading3: "20pt",
  body: "14pt",
  small: "12pt",
} as const;

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hex(color: string): string {
  return color.replace("#", "");
}

/** Render an Inline[] run list to html2pptx-friendly inline HTML. */
function renderInlineHtml(runs: Inline[]): string {
  let out = "";
  for (const run of runs) {
    if (typeof run === "string") {
      out += esc(run);
      continue;
    }
    let text = esc(run.text);
    if (run.bold) text = `<b>${text}</b>`;
    if (run.italic) text = `<i>${text}</i>`;
    if (run.link) text = `<a href="${esc(run.link)}">${text}</a>`;
    out += text;
  }
  return out;
}

/** How image blocks render into slide HTML. */
export interface ImageRenderOptions {
  /**
   * Resolved image data (src → data URL). When the map has an entry for a
   * src, the print path emits a real `<img>`; a null entry (failed
   * resolution) or an absent map degrades to the `[image: caption]` text
   * placeholder.
   */
  images?: ImageMap;
  /** Render image blocks as nothing at all (their bytes ride in separately). */
  omitImages?: boolean;
}

/** Render a single block to inline-styled semantic HTML. */
function renderBlockHtml(
  block: Block,
  theme: Theme,
  index: number,
  opts: ImageRenderOptions = {},
): string {
  const ink = hex(theme.colors.ink);
  const muted = hex(theme.colors.muted);
  const accent = hex(theme.colors.accent);
  const page = hex(theme.colors.page);
  const surface = hex(theme.colors.surface);
  const display = theme.fonts.display;
  const body = theme.fonts.body;

  switch (block.type) {
    case "heading": {
      const tag = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3";
      const size =
        block.level === 1 ? FONT_SIZE.heading1 : block.level === 2 ? FONT_SIZE.heading2 : FONT_SIZE.heading3;
      return `<${tag} style="font-family:${display};font-size:${size};font-weight:bold;color:#${ink};margin:0 0 8pt 0;">${renderInlineHtml(block.text)}</${tag}>`;
    }
    case "paragraph":
      return `<p style="font-family:${body};font-size:${FONT_SIZE.body};color:#${ink};margin:0 0 8pt 0;">${renderInlineHtml(block.text)}</p>`;
    case "bulletList":
      return `<ul style="font-family:${body};font-size:${FONT_SIZE.body};color:#${ink};margin:0 0 8pt 0;">${block.items
        .map((item) => `<li>${renderInlineHtml(item)}</li>`)
        .join("")}</ul>`;
    case "numberedList":
      return `<ol style="font-family:${body};font-size:${FONT_SIZE.body};color:#${ink};margin:0 0 8pt 0;">${block.items
        .map((item) => `<li>${renderInlineHtml(item)}</li>`)
        .join("")}</ol>`;
    case "quote":
      return `<p style="font-family:${body};font-size:${FONT_SIZE.body};font-style:italic;color:#${muted};margin:0 0 8pt 0;">${renderInlineHtml(block.text)}</p>`;
    case "callout":
      return `<p style="font-family:${body};font-size:${FONT_SIZE.small};color:#${ink};background-color:#${accent};margin:0 0 8pt 0;padding:6pt 8pt;">${renderInlineHtml(block.text)}</p>`;
    case "divider":
      return `<p style="font-size:${FONT_SIZE.body};color:#${muted};margin:0 0 8pt 0;">———</p>`;
    case "image": {
      if (opts.omitImages) return "";
      if (opts.images && block.src) {
        const dataUrl = opts.images.get(block.src);
        if (dataUrl) {
          const captionHtml = block.caption
            ? `<figcaption style="font-family:${body};font-size:${FONT_SIZE.small};color:#${muted};margin:4pt 0 0 0;">${esc(block.caption)}</figcaption>`
            : "";
          return `<figure style="margin:0 0 8pt 0;"><img src="${esc(dataUrl)}" alt="${esc(block.caption ?? "")}" style="max-width:100%;max-height:300px;border-radius:6px;" />${captionHtml}</figure>`;
        }
      }
      const caption = block.caption ? esc(block.caption) : "image";
      return `<p style="font-family:${body};font-size:${FONT_SIZE.small};color:#${muted};margin:0 0 8pt 0;">[image: ${caption}]</p>`;
    }
    case "columns":
      // Flatten columns left-to-right; html2pptx has no column concept.
      return block.columns
        .map((col, ci) =>
          col.map((b, bi) => renderBlockHtml(b, theme, ci * 100 + bi, opts)).join(""),
        )
        .join("");
    case "chart": {
      const seriesNames = block.data.series.map((s) => s.name).join(" vs ");
      const allVals = block.data.series.flatMap((s) => s.values);
      const maxVal = Math.max(1, ...allVals);
      const rows = block.data.labels.map((l, i) => {
        const valRuns = block.data.series.map((s) => {
          const val = s.values[i] ?? 0;
          const pct = Math.round((val / maxVal) * 100);
          return `${esc(s.name)}: <b>${val}</b> (${pct}%)`;
        });
        return `• <b>${esc(l)}</b>: ${valRuns.join(" | ")}`;
      });
      return `<div style="border:1px solid #${accent};background-color:#${page};padding:8pt 12pt;margin:0 0 10pt 0;border-radius:6px;"><p style="font-family:${display};font-size:${FONT_SIZE.small};font-weight:bold;color:#${accent};margin:0 0 4pt 0;">◈ ${esc(block.kind.toUpperCase())} ANALYSIS: ${esc(seriesNames)}</p><p style="font-family:${body};font-size:${FONT_SIZE.small};color:#${ink};line-height:1.4;margin:0;">${rows.join("<br/>")}</p></div>`;
    }
    default: {
      // Exhaustiveness guard: a new block type without a renderer fails here.
      const _never: never = block;
      void _never;
      return "";
    }
  }
}

/** Minimal HTML document wrapper with the theme inlined on <body>. */
function wrapDocument(bodyHtml: string, title: string, theme: Theme): string {
  const ink = hex(theme.colors.ink);
  const page = hex(theme.colors.page);
  const body = theme.fonts.body;
  return [
    "<!DOCTYPE html>",
    `<html><head><meta charset="utf-8"><title>${esc(title)}</title>`,
    `<style>body{margin:0;padding:48px 56px;box-sizing:border-box;}</style>`,
    `</head>`,
    `<body style="width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;background-color:#${page};color:#${ink};font-family:${body};font-size:${FONT_SIZE.body};">`,
    bodyHtml,
    "</body></html>",
  ].join("");
}

export interface SlideInput {
  id: string;
  title: string;
  blocks: Block[];
}

export interface SlideHtml {
  title: string;
  html: string;
  backgroundColor: string;
}

/** The deck context a slide is rendered for: its title and active theme. */
export interface SlideDeck {
  title: string;
  theme: Theme;
}

/** Inner slide content (heading + blocks) without the document wrapper. */
function buildSlideBody(deck: SlideDeck, card: SlideInput, opts: ImageRenderOptions = {}): string {
  const theme = deck.theme;
  const title = card.title || deck.title;
  // Generated cards open with a heading block that repeats the card title —
  // prepending our own <h1> would print the title twice on every exported
  // slide. Only add the synthetic title when the content doesn't state it.
  const heading = startsWithTitleHeading(card.blocks, title)
    ? []
    : [
        `<h1 style="font-family:${theme.fonts.display};font-size:${FONT_SIZE.title};font-weight:bold;color:#${hex(theme.colors.ink)};margin:0 0 16pt 0;">${esc(title)}</h1>`,
      ];
  return [...heading, ...card.blocks.map((b, i) => renderBlockHtml(b, theme, i, opts))].join("");
}

/** Plain text of an inline run list (strings and formatted parts). */
function inlineText(inlines: Inline | Inline[]): string {
  const arr = Array.isArray(inlines) ? inlines : [inlines];
  return arr.map((part) => (typeof part === "string" ? part : part.text)).join("");
}

/**
 * True when the card already opens with a heading whose text *is* the card
 * title — the common shape for AI-generated cards.
 */
function startsWithTitleHeading(blocks: Block[], title: string): boolean {
  const first = blocks[0];
  if (!first || first.type !== "heading") return false;
  return inlineText(first.text).trim() === title.trim();
}

/**
 * Render one card to a standalone 16:9 HTML document. The card title becomes
 * the slide heading; each block follows as inline-styled semantic HTML.
 */
export async function renderSlideHtml(
  deck: SlideDeck,
  card: SlideInput,
  opts: ImageRenderOptions = {},
): Promise<string> {
  return wrapDocument(buildSlideBody(deck, card, opts), card.title || deck.title, deck.theme);
}

/** Render every card to a slide document, preserving order. */
export async function renderSlidesHtml(
  deck: SlideDeck,
  cards: SlideInput[],
  opts: { imageMode?: "placeholder" | "omit" } = {},
): Promise<SlideHtml[]> {
  // The .pptx path embeds images itself (via `buildPptxBuffer`'s resolver), so
  // callers that supply images pass `imageMode: "omit"` — the HTML then has no
  // image markup at all and nothing doubles up on the slide.
  const bodyOpts: ImageRenderOptions =
    opts.imageMode === "omit" ? { omitImages: true } : {};
  const out: SlideHtml[] = [];
  for (const card of cards) {
    out.push({
      title: card.title,
      html: await renderSlideHtml(deck, card, bodyOpts),
      backgroundColor: hex(deck.theme.colors.surface),
    });
  }
  return out;
}

export type PrintFormat = "presentation" | "document";

export interface PrintOptions {
  /** `presentation` → one 16:9 page per card; `document` → flowing A4 text. */
  format?: PrintFormat;
  /**
   * Resolve image blocks to data URLs that get inlined into the print HTML.
   * The PDF pipeline's headless browser has no session cookie and no base URL
   * for relative `/api/...` paths, so images must travel inside the document.
   * Unresolved images keep the `[image: caption]` placeholder.
   */
  resolveImage?: ImageResolver;
}

/**
 * Build one print document for a whole deck (PDF export).
 *
 * Uses CSS paged media: `@page` sets the page geometry and Chromium's
 * print-to-PDF (`page.pdf({ preferCSSPageSize: true })`) honours it, so
 * presentation decks come out one exact 16:9 slide per page and document
 * decks flow across A4 pages — no server round-trip, no browser navigation,
 * just `page.setContent` on this string.
 *
 * Themed colors/fonts are repeated on every slide section because element
 * backgrounds do not carry across print pages unless painted per page.
 */
export async function renderPrintHtml(
  deck: SlideDeck,
  cards: SlideInput[],
  opts: PrintOptions = {},
): Promise<string> {
  const format: PrintFormat = opts.format ?? "presentation";
  const images: ImageRenderOptions = opts.resolveImage
    ? { images: await resolveBlockImages(cards, opts.resolveImage) }
    : {};
  const theme = deck.theme;
  const ink = hex(theme.colors.ink);
  const page = hex(theme.colors.page);
  const docTitle = esc(deck.title);
  const bodyFont = theme.fonts.body;

  if (format === "document") {
    return [
      "<!DOCTYPE html>",
      `<html><head><meta charset="utf-8"><title>${docTitle}</title>`,
      `<style>` +
        `@page { size: A4; margin: 16mm 14mm; }` +
        `html,body{margin:0;padding:0;}` +
        `body{background-color:#${page};color:#${ink};font-family:${bodyFont};font-size:${FONT_SIZE.body};}` +
        `.print-doc>section{margin:0 0 14pt 0;}` +
        `</style></head>`,
      `<body><div class="print-doc">${cards
        .map((c) => `<section>${buildSlideBody(deck, c, images)}</section>`)
        .join("")}</div></body></html>`,
    ].join("");
  }

  // Presentation: exact 16:9 pages, one per card.
  const pageStyle =
    `width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;` +
    `background-color:#${page};color:#${ink};` +
    `font-family:${bodyFont};font-size:${FONT_SIZE.body};` +
    `padding:48px 56px;box-sizing:border-box;overflow:hidden;`;
  return [
    "<!DOCTYPE html>",
    `<html><head><meta charset="utf-8"><title>${docTitle}</title>`,
    `<style>` +
      `@page { size: ${SLIDE_WIDTH}px ${SLIDE_HEIGHT}px; margin: 0; }` +
      `html,body{margin:0;padding:0;}` +
      `.slide-page{${pageStyle}page-break-after:always;break-after:page;}` +
      `</style></head>`,
    `<body>${cards
      .map((c) => `<section class="slide-page" style="${pageStyle}">${buildSlideBody(deck, c, images)}</section>`)
      .join("")}</body></html>`,
  ].join("");
}
