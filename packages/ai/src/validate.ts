import type { Block } from "@carddeck/core";

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

function isBlockLike(value: unknown): value is Block {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && BLOCK_TYPES.has(type);
}

/** Validate + normalize a block array. Throws on non-array or unknown block type. */
export function validateBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) {
    throw new AIValidationError(`blocks must be an array, got ${typeof raw}`);
  }
  for (const [i, b] of raw.entries()) {
    if (!isBlockLike(b)) {
      throw new AIValidationError(`block[${i}] is not a recognized block`);
    }
  }
  return raw as Block[];
}
