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
    // The theme's family name must still lead the stack, so the designed font
    // wins whenever it is present.
    expect(vars["--font-display"]).toBe(`${t.fonts.display}, ui-sans-serif, system-ui, sans-serif`);
    expect(vars["--font-body"]).toBe(`${t.fonts.body}, ui-sans-serif, system-ui, sans-serif`);
  });
  it("always terminates a font stack with a generic fallback", () => {
    // A stack ending at a specific family has no safe landing spot: when that
    // family is missing the browser substitutes its own default (Times), not
    // the next generic. Every emitted stack must reach a generic keyword.
    const t = PRESET_THEMES.find((x) => x.name === "Midnight")!;
    const vars = applyThemeTokens(t);
    for (const key of ["--font-display", "--font-body"] as const) {
      expect(vars[key]).toMatch(/(sans-serif|serif|monospace|system-ui)$/);
    }
  });
  it("does not double-append fallbacks a theme already supplied", () => {
    const t = PRESET_THEMES.find((x) => x.name === "Midnight")!;
    const custom = { ...t, fonts: { display: '"Fraunces", serif', body: "Inter, sans-serif" } };
    const vars = applyThemeTokens(custom);
    expect(vars["--font-display"]).toBe('"Fraunces", serif');
    expect(vars["--font-body"]).toBe("Inter, sans-serif");
  });
  it("ships at least 8 presets", () => {
    expect(PRESET_THEMES.length).toBeGreaterThanOrEqual(8);
  });
});
