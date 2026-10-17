import type { Block, Inline } from "@carddeck/core";

const BLOCK_TYPES = new Set([
  "heading",
  "paragraph",
  "bulletList",
  "numberedList",
  "image",
  "quote",
  "divider",
  "columns",
  "callout",
  "chart",
]);

/** Thrown when a model's JSON output does not match the expected shape. */
export class AIValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIValidationError";
  }
}

interface RawOutlineItem {
  title?: unknown;
  intent?: unknown;
}

/**
 * Validate + normalize an outline the model produced. Assigns stable `card-<n>`
 * ids and coerces missing fields to safe defaults. Throws AIValidationError on
 * a non-array or empty result.
 */
export function validateOutline(raw: unknown, numCards: number) {
  if (!Array.isArray(raw)) {
    throw new AIValidationError(`outline must be an array, got ${typeof raw}`);
  }
  const items = raw as RawOutlineItem[];
  if (items.length === 0) {
    throw new AIValidationError("outline must contain at least one card");
  }
  const capped = items.slice(0, numCards);
  return capped.map((item, i) => ({
    id: `card-${i}`,
    title: typeof item?.title === "string" && item.title.trim() ? item.title : `Card ${i + 1}`,
    intent: typeof item?.intent === "string" ? item.intent : "",
  }));
}

function isBlockLike(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && BLOCK_TYPES.has(type);
}

/**
 * Coerce arbitrary model output into `Inline[]`, dropping malformed parts.
 * A bare string becomes a single run; object runs keep only their known,
 * correctly-typed fields.
 */
function normalizeInline(raw: unknown): Inline[] {
  if (typeof raw === "string") return [raw];
  if (!Array.isArray(raw)) return [];
  const out: Inline[] = [];
  for (const part of raw) {
    if (typeof part === "string") {
      out.push(part);
      continue;
    }
    if (
      part &&
      typeof part === "object" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      const p = part as { text: string; bold?: unknown; italic?: unknown; link?: unknown };
      out.push({
        text: p.text,
        ...(p.bold === true ? { bold: true } : {}),
        ...(p.italic === true ? { italic: true } : {}),
        ...(typeof p.link === "string" ? { link: p.link } : {}),
      });
    }
  }
  return out;
}

/** Coerce list rows into `Inline[][]`, keeping only non-empty rows. */
function normalizeRows(raw: unknown): Inline[][] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => normalizeInline(row)).filter((row) => row.length > 0);
}

/**
 * Coerce one type-valid block into its canonical shape.
 *
 * Payloads from a real model are untrusted JSON: a `chart` without `data`, a
 * `bulletList` whose `items` isn't an array, or a `columns` block with junk
 * columns would pass a type-only check and then throw a `TypeError` inside a
 * renderer — white-screening the editor or 500ing the public reader. Returns
 * null when the block has no salvageable content (callers drop it).
 */
function normalizeBlock(block: Record<string, unknown>): Block | null {
  const type = typeof block.type === "string" ? block.type : "";
  switch (type) {
    case "heading": {
      const level = block.level === 1 || block.level === 3 ? block.level : 2;
      const text = normalizeInline(block.text);
      return text.length ? { type: "heading", level, text } : null;
    }
    case "paragraph": {
      const text = normalizeInline(block.text);
      return text.length ? { type: "paragraph", text } : null;
    }
    case "quote": {
      const text = normalizeInline(block.text);
      if (!text.length) return null;
      return {
        type: "quote",
        text,
        ...(typeof block.attribution === "string" ? { attribution: block.attribution } : {}),
      };
    }
    case "callout": {
      const tone = block.tone === "warn" || block.tone === "success" ? block.tone : "info";
      const text = normalizeInline(block.text);
      return text.length ? { type: "callout", tone, text } : null;
    }
    case "bulletList":
    case "numberedList": {
      const items = normalizeRows(block.items);
      return items.length ? { type, items } : null;
    }
    case "image":
      return {
        type: "image",
        src: typeof block.src === "string" ? block.src : "",
        layout: block.layout === "side" || block.layout === "behind" ? block.layout : "full",
        ...(typeof block.caption === "string" ? { caption: block.caption } : {}),
      };
    case "divider":
      return { type: "divider" };
    case "columns": {
      if (!Array.isArray(block.columns)) return null;
      const columns: Block[][] = [];
      for (const column of block.columns) {
        if (!Array.isArray(column)) continue;
        columns.push(
          column
            .filter(isBlockLike)
            .map((b) => normalizeBlock(b))
            .filter((b): b is Block => b !== null),
        );
      }
      return columns.length ? { type: "columns", columns } : null;
    }
    case "chart": {
      const data = block.data as { labels?: unknown; series?: unknown } | null | undefined;
      if (!data || !Array.isArray(data.labels) || !Array.isArray(data.series)) return null;
      const series = data.series
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const s = entry as { name?: unknown; values?: unknown };
          if (!Array.isArray(s.values)) return null;
          return {
            name: typeof s.name === "string" ? s.name : "Series",
            values: s.values.map((v) => Number(v)).filter((n) => Number.isFinite(n)),
          };
        })
        .filter((s): s is { name: string; values: number[] } => s !== null);
      if (series.length === 0) return null;
      return {
        type: "chart",
        kind: block.kind === "line" || block.kind === "donut" ? block.kind : "bar",
        data: { labels: data.labels.map((l) => String(l)), series },
      };
    }
    default:
      return null;
  }
}

/**
 * Validate + normalize a block array.
 *
 * Throws on a non-array or an unknown block *type* (the model must follow the
 * schema), but salvages payload-level mistakes by coercion — and drops blocks
 * whose payload can't be salvaged — so one malformed block never takes a whole
 * page down.
 */
export function validateBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) {
    throw new AIValidationError(`blocks must be an array, got ${typeof raw}`);
  }
  const out: Block[] = [];
  for (const [i, b] of raw.entries()) {
    if (!isBlockLike(b)) {
      throw new AIValidationError(`block[${i}] is not a recognized block`);
    }
    const normalized = normalizeBlock(b);
    if (normalized) out.push(normalized);
  }
  return out;
}
