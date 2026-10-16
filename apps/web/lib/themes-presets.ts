import type { CSSProperties } from "react";
import { PRESET_THEMES, applyThemeTokens, type Theme } from "@carddeck/core";
import { getDb } from "./db";
import * as t from "@/drizzle/schema";

/**
 * Theme helpers shared by the editor, reader, present view, and exporters.
 *
 * `deckCssVars` turns a theme into a React style object of CSS custom
 * properties, so a whole deck re-skins by swapping one style attribute (no
 * re-render of block content). `seedPresetThemes` lazily copies the shipped
 * presets into the `theme` table so decks have real theme rows to reference.
 */

/**
 * A style object that may carry CSS custom properties (`--page`, `--ink`, …)
 * alongside normal React CSS keys. React accepts custom properties at runtime;
 * this type just makes them visible to the type checker.
 */
export type DeckCssVars = CSSProperties & Record<`--${string}`, string | undefined>;

/**
 * Convert a theme (or theme JSON from the DB) to a CSS-custom-property style
 * object. Returns `{}` for a nullish/unparseable theme so callers can spread it
 * unconditionally.
 */
export function deckCssVars(theme: Theme | null | undefined): DeckCssVars {
  if (!theme) return {};
  return applyThemeTokens(theme) as DeckCssVars;
}

/** Parse a `theme.tokens` JSON string into a `Theme`, or null when invalid. */
export function parseThemeTokens(
  tokens: string,
  id: string,
  name: string,
  isPreset: boolean,
): Theme | null {
  try {
    const parsed = JSON.parse(tokens) as Partial<Theme>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.colors || !parsed.fonts) return null;
    return {
      id,
      name,
      isPreset,
      fonts: parsed.fonts,
      colors: parsed.colors,
      radius: parsed.radius ?? "0px",
      shadow: parsed.shadow ?? "none",
    };
  } catch {
    return null;
  }
}

type ThemeRow = typeof t.theme.$inferSelect;

/** Load a theme row by id and decode it into a `Theme` (null when missing). */
export function rowToTheme(row: ThemeRow | undefined | null): Theme | null {
  if (!row) return null;
  return parseThemeTokens(row.tokens, row.id, row.name, row.isPreset === 1);
}

/**
 * Insert any preset themes not yet present in the DB. Idempotent: a second
 * call inserts nothing. Returns the rows that were newly created.
 */
export async function seedPresetThemes(): Promise<ThemeRow[]> {
  const db = getDb();
  const existing = await db.query.theme.findMany({
    where: (th, { eq }) => eq(th.isPreset, 1),
  });
  const existingNames = new Set(existing.map((th) => th.name));
  const missing = PRESET_THEMES.filter((th) => !existingNames.has(th.name));
  if (missing.length === 0) return [];

  return db
    .insert(t.theme)
    .values(
      missing.map((th) => ({
        id: th.id,
        name: th.name,
        isPreset: 1,
        tokens: JSON.stringify(th),
      })),
    )
    .returning();
}

/**
 * List all themes (presets first, then custom), decoded for the picker.
 * Lazily seeds the preset themes first, so a fresh install always has them.
 */
export async function listThemes(): Promise<Theme[]> {
  await seedPresetThemes();
  const db = getDb();
  const rows = await db.query.theme.findMany({
    orderBy: (th, { desc, asc }) => [desc(th.isPreset), asc(th.name)],
  });
  return rows.map((row) => rowToTheme(row)).filter((th): th is Theme => th !== null);
}
