/**
 * Inline content model.
 *
 * An `Inline` is the smallest piece of styled text: either a bare string
 * (unstyled) or a run with optional bold/italic/link decoration. Blocks hold
 * `Inline[]` for their textual content so the editor and renderers share one
 * representation.
 */
export type Inline =
  | string
  | {
      text: string;
      bold?: boolean;
      italic?: boolean;
      link?: string;
    };

/** Chart data payload for `chart` blocks. */
export interface ChartData {
  labels: string[];
  series: { name: string; values: number[] }[];
}

/**
 * The typed block tree that makes up a card. This is the clone's analogue of
 * Gamma's renderer nodes: each card is a list of these, and the same tree
 * drives the editor, the reader, and the PowerPoint/PDF exporters.
 */
export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: Inline[] }
  | { type: "paragraph"; text: Inline[] }
  | { type: "bulletList"; items: Inline[][] }
  | { type: "numberedList"; items: Inline[][] }
  | { type: "image"; src: string; caption?: string; layout: "full" | "side" | "behind" }
  | { type: "quote"; text: Inline[]; attribution?: string }
  | { type: "divider" }
  | { type: "columns"; columns: Block[][] }
  | { type: "callout"; tone: "info" | "warn" | "success"; text: Inline[] }
  | { type: "chart"; kind: "bar" | "line" | "donut"; data: ChartData };

/**
 * Type guard: is a value an `Inline` (a bare string or a decorated run)?
 * A block object like `{ type: "paragraph", text: [] }` is NOT inline.
 */
export function isInline(value: unknown): value is Inline {
  if (typeof value === "string") return true;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return typeof (value as { text?: unknown }).text === "string";
  }
  return false;
}
