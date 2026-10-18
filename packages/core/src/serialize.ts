import type { Inline } from "./blocks";

/**
 * Flatten a run of `Inline` to plain text, stripping decoration. Used by the
 * outline/card previews, search, and the exporters' alt-text.
 */
export function inlineToPlainText(inline: Inline | Inline[]): string {
  const arr = Array.isArray(inline) ? inline : [inline];
  return arr.map((part) => (typeof part === "string" ? part : part.text)).join("");
}
