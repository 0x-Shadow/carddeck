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

/**
 * Generic fallbacks appended to every emitted font stack.
 *
 * A `font-family` list that ends at a specific family has no safe landing spot:
 * if that family is missing, the browser substitutes its own *default* font
 * (Times New Roman on most systems) rather than the next generic. Terminating
 * with `sans-serif` guarantees a sane degradation instead of serif body copy.
 */
const FONT_FALLBACK = ", ui-sans-serif, system-ui, sans-serif";

/**
 * Append fallbacks to a theme's font, unless the theme already supplied its own
 * terminal generic (e.g. `"Inter, sans-serif"`).
 */
function withFallback(font: string): string {
  const value = font.trim();
  if (!value) return `ui-sans-serif, system-ui, sans-serif`;
  if (/(^|,)\s*(sans-serif|serif|monospace|system-ui)\s*$/i.test(value)) return value;
  return `${value}${FONT_FALLBACK}`;
}

/** CSS custom-property map derived from a theme. */
export function applyThemeTokens(theme: Theme): Record<string, string> {
  return {
    "--page": theme.colors.page,
    "--surface": theme.colors.surface,
    "--ink": theme.colors.ink,
    "--accent": theme.colors.accent,
    "--muted": theme.colors.muted,
    "--font-display": withFallback(theme.fonts.display),
    "--font-body": withFallback(theme.fonts.body),
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
    id: "brief",
    name: "Brief",
    isPreset: true,
    fonts: { display: "Georgia", body: "Calibri" },
    colors: { page: "#f4efe6", surface: "#fbf8f1", ink: "#171a1d", accent: "#8c1d2b", muted: "#5c5750" },
    radius: "2px",
    shadow: "none",
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
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    isPreset: true,
    fonts: { display: "Space Grotesk", body: "Inter" },
    colors: { page: "#05070f", surface: "#0d111d", ink: "#f1f5f9", accent: "#00f2fe", muted: "#818cf8" },
    radius: "14px",
    shadow: "0 10px 40px rgba(0, 242, 254, 0.2)",
  },
  {
    id: "aurora",
    name: "Aurora",
    isPreset: true,
    fonts: { display: "Poppins", body: "Inter" },
    colors: { page: "#0c0817", surface: "#17102b", ink: "#f8fafc", accent: "#c084fc", muted: "#a855f7" },
    radius: "16px",
    shadow: "0 12px 40px rgba(192, 132, 252, 0.25)",
  },
  {
    id: "luxe",
    name: "Luxe",
    isPreset: true,
    fonts: { display: "Cinzel", body: "Inter" },
    colors: { page: "#06120d", surface: "#0c2017", ink: "#f2fbf6", accent: "#10b981", muted: "#6ee7b7" },
    radius: "12px",
    shadow: "0 12px 36px rgba(16, 185, 129, 0.22)",
  },
  {
    id: "minimal",
    name: "Minimal",
    isPreset: true,
    fonts: { display: "Inter", body: "Inter" },
    colors: { page: "#f1f5f9", surface: "#ffffff", ink: "#0f172a", accent: "#6366f1", muted: "#64748b" },
    radius: "16px",
    shadow: "0 20px 40px -15px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)",
  },
];
