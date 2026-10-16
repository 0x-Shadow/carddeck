import { describe, it, expect } from "vitest";
import { PRESET_THEMES, applyThemeTokens } from "../src/theme";

describe("theme tokens", () => {
  it("maps a theme to CSS custom properties", () => {
    const t = PRESET_THEMES.find((x) => x.name === "Midnight")!;
    const vars = applyThemeTokens(t);
    expect(vars["--page"]).toBe(t.colors.page);
    expect(vars["--surface"]).toBe(t.colors.surface);
    expect(vars["--ink"]).toBe(t.colors.ink);
    expect(vars["--accent"]).toBe(t.colors.accent);
    expect(vars["--font-display"]).toBe(t.fonts.display);
    expect(vars["--font-body"]).toBe(t.fonts.body);
  });
  it("ships at least 8 presets", () => {
    expect(PRESET_THEMES.length).toBeGreaterThanOrEqual(8);
  });
});
