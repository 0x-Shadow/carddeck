/**
 * Image resolution for the PowerPoint exporter.
 *
 * The PPTX pipeline is DOM-free and deterministic, so it cannot fetch URLs or
 * touch the filesystem on its own. Instead the caller injects a resolver that
 * turns a block's `src` into a base64 data URL. This keeps the exporter
 * unit-testable (tests pass a fake resolver) and keeps all network and disk
 * access in the caller, which already knows its own asset store and access
 * rules.
 */

import type { Block } from "@carddeck/core";

/** A data URL (`data:image/png;base64,…`), optionally with its MIME type. */
export interface ResolvedImage {
  dataUrl: string;
  mime?: string;
}

/** Map a block `src` to image bytes, or to `null` when it cannot be resolved. */
export type ImageResolver = (src: string) => Promise<ResolvedImage | null>;

/** Layout hints that survive from the block into the slide geometry. */
export type ImageLayout = "full" | "side" | "behind";

/** An image the exporter should try to embed on one slide. */
export interface SlideImage {
  src: string;
  layout: ImageLayout;
  caption?: string;
}

/** Extract the image blocks from one card, in order, skipping empty `src`. */
export function collectSlideImages(
  blocks: Array<{ type: string; src?: string; layout?: string; caption?: string }>,
): SlideImage[] {
  const out: SlideImage[] = [];
  for (const block of blocks) {
    if (block.type !== "image") continue;
    const src = typeof block.src === "string" ? block.src.trim() : "";
    if (!src) continue;
    const layout: ImageLayout =
      block.layout === "side" || block.layout === "behind" ? block.layout : "full";
    out.push({ src, layout, ...(block.caption ? { caption: block.caption } : {}) });
  }
  return out;
}

/**
 * A resolver that always fails. Exporters use it as the default so an
 * unresolved image degrades to a captioned placeholder instead of crashing a
 * whole export.
 */
export const nullResolver: ImageResolver = async () => null;

/** src → data URL (or null when resolution failed). */
export type ImageMap = ReadonlyMap<string, string | null>;

/**
 * Resolve every image src across the deck's cards, once per unique src, for
 * the print/PDF pipeline (which inlines images into the HTML because its
 * headless browser has no session and no base URL for relative paths).
 */
export async function resolveBlockImages(
  cards: Array<{ blocks: Block[] }>,
  resolve: ImageResolver,
): Promise<ImageMap> {
  const srcs = new Set<string>();
  for (const card of cards) {
    for (const block of card.blocks) {
      if (block.type === "image" && block.src.trim()) srcs.add(block.src.trim());
    }
  }
  const entries = await Promise.all(
    [...srcs].map(async (src): Promise<[string, string | null]> => {
      const resolved = await resolve(src).catch(() => null);
      return [src, resolved?.dataUrl ?? null];
    }),
  );
  return new Map(entries);
}
