import { describe, it, expect } from "vitest";
import { deckCssVars, seedPresetThemes, listThemes } from "../lib/themes-presets";
import { PRESET_THEMES, applyThemeTokens } from "@carddeck/core";

describe("deckCssVars", () => {
  it("produces a style object of custom properties", () => {
    const style = deckCssVars(PRESET_THEMES[0]);
    expect(style["--page"]).toBeDefined();
    expect(style["--font-display"]).toBeDefined();
  });

  it("maps every theme token to a CSS variable", () => {
    const theme = PRESET_THEMES.find((t) => t.name === "Midnight")!;
    const style = deckCssVars(theme);
    const tokens = applyThemeTokens(theme);
    const asMap = style as Record<string, string>;
    for (const [key, value] of Object.entries(tokens)) {
      expect(asMap[key]).toBe(value);
    }
  });

  it("returns an empty style object for a missing theme", () => {
    expect(deckCssVars(null)).toEqual({});
    expect(deckCssVars(undefined)).toEqual({});
  });
});

describe("preset theme seeding", () => {
  it("seeds every preset theme exactly once", async () => {
    const { makeTestDb, setTestDb } = await import("@/lib/db");
    setTestDb(makeTestDb());
    const first = await seedPresetThemes();
    expect(first).toHaveLength(PRESET_THEMES.length);
    const second = await seedPresetThemes(); // idempotent: no duplicates
    expect(second).toHaveLength(0);

    const themes = await listThemes();
    expect(themes).toHaveLength(PRESET_THEMES.length);
    for (const t of themes) expect(t.isPreset).toBe(true);
  });
});
