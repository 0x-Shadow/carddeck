import { Fragment, type ReactNode } from "react";
import type { Inline, Theme } from "@carddeck/core";
import { deckCssVars } from "@/lib/theme-styles";

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

/**
 * Allow only navigable, non-scripting link targets.
 *
 * Links can come from model output *and* from the owner-only card PATCH
 * endpoint, and a `javascript:`/`data:` href would execute in every viewer's
 * origin — including signed-out visitors of the public reader. Schemeless
 * (relative) URLs pass through untouched.
 */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  // No scheme at all → relative URL like "/view/x" or "#top".
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return null;
}

/** Render `Inline` runs as React nodes, honoring bold / italic / link. */
export function renderInline(inlines: Inline | Inline[]): ReactNode {
  const arr = Array.isArray(inlines) ? inlines : [inlines];
  return arr.map((part, i) => {
    if (typeof part === "string") return <Fragment key={i}>{part}</Fragment>;
    let node: ReactNode = part.text;
    // Unsafe schemes degrade to plain text rather than a live link.
    const href = part.link ? safeHref(part.link) : null;
    if (href) node = <a href={href}>{node}</a>;
    if (part.italic) node = <em>{node}</em>;
    if (part.bold) node = <strong>{node}</strong>;
    return <Fragment key={i}>{node}</Fragment>;
  });
}
