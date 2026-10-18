import type { CSSProperties } from "react";
import { applyThemeTokens, type Theme } from "@carddeck/core";

/** A React style object carrying the deck's CSS custom properties. */
export type DeckCssVars = CSSProperties & Record<`--${string}`, string | undefined>;

/** Convert a theme into CSS variables, or return an empty object when absent. */
export function deckCssVars(theme: Theme | null | undefined): DeckCssVars {
  if (!theme) return {};
  return applyThemeTokens(theme) as DeckCssVars;
}