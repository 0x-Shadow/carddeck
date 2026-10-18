/**
 * Theme model + presets + token mapping.
 *
 * A theme is a flat token object. `applyThemeTokens` turns it into CSS custom
 * properties so a deck re-skins instantly (no re-render of block content) by
 * swapping a style attribute on the document root. The exporters read the same
 * token fields to build the PowerPoint theme.
 */
export interface Theme {
  id: string;
  name: string;
  isPreset: boolean;
  fonts: { display: string; body: string };
  colors: {
    page: string;
    surface: string;
    ink: string;
    accent: string;
    muted: string;
  };
  radius: string;
  shadow: string;
}

/** CSS custom-property map derived from a theme. */
export function applyThemeTokens(theme: Theme): Record<string, string> {
  return {
    "--page": theme.colors.page,
    "--surface": theme.colors.surface,
    "--ink": theme.colors.ink,
    "--accent": theme.colors.accent,
    "--muted": theme.colors.muted,
    "--font-display": theme.fonts.display,
    "--font-body": theme.fonts.body,
    "--radius": theme.radius,
    "--shadow": theme.shadow,
  };
}

/** The eight shipped preset themes. */
export const PRESET_THEMES: Theme[] = [
  {
    id: "light",
    name: "Light",
    isPreset: true,
    fonts: { display: "Inter", body: "Inter" },
    colors: { page: "#f6f7f9", surface: "#ffffff", ink: "#14181f", accent: "#3b6ef6", muted: "#5b6472" },
    radius: "14px",
    shadow: "0 1px 3px rgba(0,0,0,0.08)",
  },
  {
    id: "dark",
    name: "Dark",
    isPreset: true,
    fonts: { display: "Inter", body: "Inter" },
    colors: { page: "#0d1017", surface: "#161b24", ink: "#eef1f6", accent: "#7aa2ff", muted: "#9aa4b2" },
    radius: "14px",
    shadow: "0 1px 3px rgba(0,0,0,0.5)",
  },
  {
    id: "midnight",
    name: "Midnight",
    isPreset: true,
    fonts: { display: "Poppins", body: "Inter" },
    colors: { page: "#7ba7f5", surface: "#101a44", ink: "#dbe6ff", accent: "#8fc0ff", muted: "#a9bce8" },
    radius: "12px",
    shadow: "0 10px 40px rgba(6,12,40,0.35)",
  },
  {
    id: "sunset",
    name: "Sunset",
    isPreset: true,
    fonts: { display: "Sora", body: "Inter" },
    colors: { page: "#ffd9c0", surface: "#2a1420", ink: "#ffe9dd", accent: "#ff8a5b", muted: "#e7b9a8" },
    radius: "16px",
    shadow: "0 10px 30px rgba(60,20,10,0.25)",
  },
  {
    id: "forest",
    name: "Forest",
    isPreset: true,
    fonts: { display: "Lora", body: "Inter" },
    colors: { page: "#cfe6d4", surface: "#0f241a", ink: "#e7f5ea", accent: "#7fd1a0", muted: "#a9c9b4" },
    radius: "10px",
    shadow: "0 8px 24px rgba(10,40,25,0.25)",
  },
  {
    id: "mono",
    name: "Mono",
    isPreset: true,
    fonts: { display: "JetBrains Mono", body: "JetBrains Mono" },
    colors: { page: "#111111", surface: "#1b1b1b", ink: "#f2f2f2", accent: "#c8c8c8", muted: "#9a9a9a" },
    radius: "4px",
    shadow: "none",
  },
  {
    id: "paper",
    name: "Paper",
    isPreset: true,
    fonts: { display: "Merriweather", body: "Georgia" },
    colors: { page: "#efe9dc", surface: "#fbf7ee", ink: "#2b2620", accent: "#8a6d3b", muted: "#6b6154" },
    radius: "6px",
    shadow: "0 2px 8px rgba(60,45,20,0.12)",
  },
  {
    id: "neon",
    name: "Neon",
    isPreset: true,
    fonts: { display: "Space Grotesk", body: "Inter" },
    colors: { page: "#0a0a12", surface: "#12121f", ink: "#f0f0ff", accent: "#00e5ff", muted: "#8f8fb0" },
    radius: "8px",
    shadow: "0 0 24px rgba(0,229,255,0.25)",
  },
];
