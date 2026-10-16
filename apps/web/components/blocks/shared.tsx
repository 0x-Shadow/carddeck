import { Fragment, type ReactNode } from "react";
import type { Inline, Theme } from "@carddeck/core";
import { deckCssVars } from "@/lib/themes-presets";

/**
 * Shared helpers for block renderers.
 *
 * Every block wrapper carries the theme's CSS custom properties so a block
 * always resolves `var(--accent)` / `var(--font-display)` even when it renders
 * outside a themed deck (offscreen export, isolated test).
 */
export function blockStyle(theme?: Theme) {
  return deckCssVars(theme ?? null);
}

/** Render `Inline` runs as React nodes, honoring bold / italic / link. */
export function renderInline(inlines: Inline | Inline[]): ReactNode {
  const arr = Array.isArray(inlines) ? inlines : [inlines];
  return arr.map((part, i) => {
    if (typeof part === "string") return <Fragment key={i}>{part}</Fragment>;
    let node: ReactNode = part.text;
    if (part.link) node = <a href={part.link}>{node}</a>;
    if (part.italic) node = <em>{node}</em>;
    if (part.bold) node = <strong>{node}</strong>;
    return <Fragment key={i}>{node}</Fragment>;
  });
}
